import { Server as SocketServer, Socket } from 'socket.io';
import { Server as HttpServer } from 'http';
import { DockerExecutionService } from './DockerExecutionService';
import path from 'path';
import fs from 'fs/promises';

interface ActiveSession {
  executionId: string;
  socketId: string;
  container: any;
  stdinStream: any;  // Store stdin stream
  inputBuffer: string[];
  waitingForInput: boolean;
}

export class CodeExecutionSocket {
  private io: SocketServer;
  private dockerService: DockerExecutionService;
  private activeSessions: Map<string, ActiveSession> = new Map();

  constructor(server: HttpServer) {
    this.io = new SocketServer(server, {
      cors: {
        origin: process.env.FRONTEND_URL || 'http://localhost:3000',
        credentials: true
      }
    });
    
    this.dockerService = new DockerExecutionService();
    this.setupEventHandlers();
  }

  private setupEventHandlers() {
    this.io.on('connection', (socket: Socket) => {
      console.log(`[Socket] Client connected: ${socket.id}`);

      socket.on('execute-code', async (data: { code: string; language: string }) => {
        await this.handleCodeExecution(socket, data.code, data.language);
      });

      socket.on('input-response', (data: { executionId: string; input: string }) => {
        this.handleInputResponse(data.executionId, data.input);
      });

      socket.on('disconnect', () => {
        console.log(`[Socket] Client disconnected: ${socket.id}`);
        this.cleanupSessionsForSocket(socket.id);
      });
    });
  }

  private async handleCodeExecution(socket: Socket, code: string, language: string) {
    const executionId = Math.random().toString(36).substring(7);
    
    try {
      // Create a special container that supports input via stdin pipe
      const { container, stdinStream } = await this.createInteractiveContainer(code, language, executionId);
      
      // Store session info
      this.activeSessions.set(executionId, {
        executionId,
        socketId: socket.id,
        container,
        stdinStream,  // Store the stdin stream for later use
        inputBuffer: [],
        waitingForInput: false
      });
      
      // Start the container
      await container.start();
      
      // Attach to container streams for output
      const stream = await container.attach({
        stream: true,
        stdout: true,
        stderr: true
      });
      
      // Handle output streaming
      stream.on('data', (chunk: Buffer) => {
        let chunkStr = chunk.toString('utf8');
        // Remove Docker's 8-byte header if present (type + size)
        if (chunkStr.length > 8 && (chunkStr.charCodeAt(0) === 1 || chunkStr.charCodeAt(0) === 2)) {
          chunkStr = chunkStr.substring(8);
        }
        
        // Check if this is an input prompt
        const isPrompt = chunkStr.includes('input') || 
                        chunkStr.includes('Enter') || 
                        chunkStr.includes('?') ||
                        chunkStr.includes(':');
        
        const session = this.activeSessions.get(executionId);
        if (session) {
          if (isPrompt && !session.waitingForInput) {
            // This is an input prompt - wait for user input
            session.waitingForInput = true;
            socket.emit('input-requested', {
              executionId,
              prompt: chunkStr
            });
          } else {
            // Regular output
            socket.emit('output', {
              executionId,
              output: chunkStr,
              isError: false
            });
          }
        }
      });
      
      stream.on('error', (error) => {
        console.error(`[Socket] Stream error for ${executionId}:`, error);
        socket.emit('execution-error', {
          executionId,
          error: 'Stream error during execution'
        });
      });
      
      // Handle container exit
      const exitCode = await container.wait();
      socket.emit('execution-complete', {
        executionId,
        exitCode: exitCode.StatusCode
      });
      
      // Cleanup
      await this.cleanupContainer(executionId);
      
    } catch (error) {
      console.error(`[Socket] Execution error for ${executionId}:`, error);
      socket.emit('execution-error', {
        executionId,
        error: error instanceof Error ? error.message : 'Execution failed'
      });
      await this.cleanupContainer(executionId);
    }
  }

  private handleInputResponse(executionId: string, input: string) {
    const session = this.activeSessions.get(executionId);
    if (session && session.waitingForInput && session.stdinStream) {
      try {
        // Use the stored stdin stream
        session.stdinStream.write(input + '\n');
        session.waitingForInput = false;
      } catch (error) {
        console.error(`[Socket] Failed to send input to ${executionId}:`, error);
      }
    }
  }

  private async createInteractiveContainer(code: string, language: string, executionId: string) {
    // Create temp directory if it doesn't exist
    const tempDir = path.join(process.cwd(), 'temp');
    await fs.mkdir(tempDir, { recursive: true });
    
    // Determine file extension based on language
    const extension = this.getFileExtension(language);
    const fileName = `code_${executionId}.${extension}`;
    const filePath = path.join(tempDir, fileName);
    
    // Write code to file
    await fs.writeFile(filePath, code, 'utf-8');
    
    // Get Docker configuration based on language
    const { image, cmd } = this.getDockerConfig(language, fileName);
    
    // Create container with stdin support
    const container = await this.dockerService['docker'].createContainer({
      Image: image,
      Cmd: cmd,
      AttachStdout: true,
      AttachStderr: true,
      AttachStdin: true,
      OpenStdin: true,
      StdinOnce: false,
      HostConfig: {
        Binds: [`${filePath}:/app/${fileName}:ro`],
        Memory: 128 * 1024 * 1024, // 128MB
        NanoCpus: 0.5 * 1e9, // 0.5 CPU core
        ReadonlyRootfs: false,
        Tmpfs: { '/tmp': 'rw,noexec,nosuid,size=64M' }
      },
      WorkingDir: '/app'
    });
    
    // Attach to stdin BEFORE starting the container
    const stdinStream = await container.attach({
      stream: true,
      stdin: true
    });
    
    // Store file path for cleanup
    (container as any).codeFilePath = filePath;
    
    return { container, stdinStream };
  }

  private getFileExtension(language: string): string {
    const extensions: Record<string, string> = {
      javascript: 'js',
      python: 'py',
      html: 'html',
      css: 'css',
      cpp: 'cpp',
      c: 'c',
      java: 'java',
      typescript: 'ts'
    };
    return extensions[language] || 'txt';
  }

  private getDockerConfig(language: string, fileName: string): { image: string; cmd: string[] } {
    const configs: Record<string, { image: string; cmd: string[] }> = {
      python: {
        image: 'python:3.11-alpine',
        cmd: ['python', '-u', `/app/${fileName}`] // -u for unbuffered output
      },
      javascript: {
        image: 'node:18-alpine',
        cmd: ['node', `/app/${fileName}`]
      },
      html: {
        image: 'alpine:latest',
        cmd: ['cat', `/app/${fileName}`]
      },
      css: {
        image: 'alpine:latest',
        cmd: ['cat', `/app/${fileName}`]
      },
      cpp: {
        image: 'gcc:latest',
        cmd: ['sh', '-c', `g++ /app/${fileName} -o /tmp/program && /tmp/program`]
      },
      c: {
        image: 'gcc:latest',
        cmd: ['sh', '-c', `gcc /app/${fileName} -o /tmp/program && /tmp/program`]
      },
      java: {
        image: 'eclipse-temurin:17-jdk-alpine',
        cmd: ['sh', '-c', `javac /app/${fileName} && java -cp /app Main`]
      },
      typescript: {
        image: 'node:18-alpine',
        cmd: ['sh', '-c', `npm install -g typescript && tsc /app/${fileName} --outDir /tmp && node /tmp/${fileName.replace('.ts', '.js')}`]
      }
    };
    
    return configs[language] || configs.python;
  }

  private async cleanupContainer(executionId: string) {
    const session = this.activeSessions.get(executionId);
    if (session) {
      try {
        // Close stdin stream
        if (session.stdinStream) {
          try {
            session.stdinStream.end();
          } catch (e) {}
        }
        // Stop container if still running
        await session.container.stop().catch(() => {});
        // Remove container
        await session.container.remove({ force: true }).catch(() => {});
        // Remove temp file
        if ((session.container as any).codeFilePath) {
          await fs.unlink((session.container as any).codeFilePath).catch(() => {});
        }
      } catch (error) {
        console.error(`Failed to cleanup container ${executionId}:`, error);
      } finally {
        this.activeSessions.delete(executionId);
      }
    }
  }

  private cleanupSessionsForSocket(socketId: string) {
    for (const [executionId, session] of this.activeSessions) {
      if (session.socketId === socketId) {
        this.cleanupContainer(executionId);
      }
    }
  }

  // Public method for graceful shutdown
  public async cleanup(): Promise<void> {
    console.log('🧹 Cleaning up all WebSocket sessions...');
    const executionIds = Array.from(this.activeSessions.keys());
    for (const executionId of executionIds) {
      await this.cleanupContainer(executionId);
    }
    if (this.io) {
      this.io.close();
    }
  }
}