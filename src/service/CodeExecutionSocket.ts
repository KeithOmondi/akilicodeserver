import { Server as SocketServer, Socket } from 'socket.io';
import { Server as HttpServer } from 'http';
import { DockerExecutionService } from './DockerExecutionService';
import path from 'path';
import fs from 'fs/promises';

interface ActiveSession {
  executionId: string;
  socketId: string;
  container: any;
  stdinStream: any;
  outputBuffer: string;
  finished: boolean;
  inputTimeoutHandle: NodeJS.Timeout | null;
}

const INPUT_RESPONSE_TIMEOUT_MS = 30_000;
const TOTAL_EXECUTION_TIMEOUT_MS = 120_000;

export class CodeExecutionSocket {
  private io: SocketServer;
  private dockerService: DockerExecutionService;
  private activeSessions: Map<string, ActiveSession> = new Map();

  constructor(server: HttpServer) {
    this.io = new SocketServer(server, {
      cors: {
        origin: process.env.FRONTEND_URL || '',
        credentials: true,
      },
    });
    this.dockerService = new DockerExecutionService();
    this.setupEventHandlers();
    console.log('🔌 WebSocket server initialized (HTML/CSS/JS/Python)');
  }

  private setupEventHandlers() {
    this.io.on('connection', (socket: Socket) => {
      console.log(`[Socket] Client connected: ${socket.id}`);

      socket.on('execute-code', async (data: { code: string; language: string }) => {
        await this.handleCodeExecution(socket, data.code, data.language);
      });

      socket.on('input-response', (data: { executionId: string; input: string }) => {
        this.handleInputResponse(socket, data.executionId, data.input);
      });

      socket.on('kill-execution', (data: { executionId: string }) => {
        this.cleanupContainer(data.executionId);
      });

      socket.on('disconnect', () => {
        console.log(`[Socket] Client disconnected: ${socket.id}`);
        this.cleanupSessionsForSocket(socket.id);
      });
    });
  }

  // Main entry point – decides between Docker, iframe render, or browser JS
  private async handleCodeExecution(socket: Socket, code: string, language: string) {
    const executionId = Math.random().toString(36).substring(7);
    console.log(`[Execution ${executionId}] Language: ${language}`);

    // 1) HTML/CSS → render directly in frontend iframe
    if (language === 'html' || language === 'css') {
      socket.emit('html-render', {
        executionId,
        code: code,
        language, // 'html' or 'css' – frontend can wrap in full document if needed
      });
      socket.emit('execution-complete', { executionId, exitCode: 0 });
      console.log(`[Execution ${executionId}] HTML/CSS sent to frontend for rendering`);
      return;
    }

    // 2) JavaScript – detect if it's a browser game (canvas, DOM, etc.)
    if (language === 'javascript') {
      const isBrowserGame = /(canvas|document\.|window\.|addEventListener|requestAnimationFrame)/i.test(code);
      
      if (isBrowserGame) {
        // Wrap code in a minimal HTML document and render in iframe
        const fullHtml = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>Game Preview</title></head>
<body>
<script>
${code}
</script>
</body>
</html>`;
        socket.emit('html-render', {
          executionId,
          code: fullHtml,
          language: 'html',
        });
        socket.emit('execution-complete', { executionId, exitCode: 0 });
        console.log(`[Execution ${executionId}] JS detected as browser game → iframe render`);
        return;
      } else {
        // Run in Node.js (Docker) for backend/text games
        console.log(`[Execution ${executionId}] JS will run in Node.js Docker container`);
        await this.runInDocker(socket, code, 'javascript', executionId);
        return;
      }
    }

    // 3) Python → run in Docker
    if (language === 'python') {
      await this.runInDocker(socket, code, 'python', executionId);
      return;
    }

    // Unsupported language
    socket.emit('execution-error', {
      executionId,
      error: `Unsupported language: ${language}. Only HTML, CSS, JavaScript, and Python are allowed.`,
    });
  }

  // Shared Docker execution logic (Python or Node.js)
  private async runInDocker(socket: Socket, code: string, language: string, executionId: string) {
    let totalTimeoutHandle: NodeJS.Timeout | null = null;

    try {
      const { container, stdinStream } = await this.createInteractiveContainer(code, language, executionId);

      this.activeSessions.set(executionId, {
        executionId,
        socketId: socket.id,
        container,
        stdinStream,
        outputBuffer: '',
        finished: false,
        inputTimeoutHandle: null,
      });

      totalTimeoutHandle = setTimeout(() => {
        const session = this.activeSessions.get(executionId);
        if (session && !session.finished) {
          socket.emit('execution-error', {
            executionId,
            error: `⏱ Execution exceeded the ${TOTAL_EXECUTION_TIMEOUT_MS / 1000}s total time limit.`,
          });
          this.cleanupContainer(executionId);
        }
      }, TOTAL_EXECUTION_TIMEOUT_MS);

      await container.start();
      console.log(`[Execution ${executionId}] Container started`);

      // Attach stdout/stderr with re‑attach logic
      const attachOutputStream = async () => {
        const session = this.activeSessions.get(executionId);
        if (!session || session.finished) return;

        const stream = await container.attach({
          stream: true,
          stdout: true,
          stderr: true,
          logs: false,
        });

        stream.on('data', (chunk: Buffer) => {
          this.handleOutputChunk(socket, executionId, chunk);
        });

        stream.on('error', (err: Error) => {
          console.error(`[Execution ${executionId}] Stream error:`, err);
          socket.emit('execution-error', { executionId, error: err.message });
        });

        stream.on('end', async () => {
          const s = this.activeSessions.get(executionId);
          if (!s || s.finished) return;
          try {
            const info = await container.inspect();
            if (info.State.Running) {
              console.log(`[Execution ${executionId}] Re‑attaching to stream...`);
              await attachOutputStream();
            }
          } catch {
            // Container gone, ignore
          }
        });
      };

      await attachOutputStream();

      // Wait for container exit
      container.wait()
        .then(async (exitData: { StatusCode: number }) => {
          if (totalTimeoutHandle) clearTimeout(totalTimeoutHandle);
          const session = this.activeSessions.get(executionId);
          if (session && !session.finished) {
            let actuallyExited = true;
            try {
              const info = await session.container.inspect();
              actuallyExited = !info.State.Running;
            } catch { /* container gone */ }
            if (actuallyExited) {
              console.log(`[Execution ${executionId}] Exited with code ${exitData.StatusCode}`);
              setTimeout(() => {
                socket.emit('execution-complete', { executionId, exitCode: exitData.StatusCode });
                this.cleanupContainer(executionId);
              }, 150);
            }
          }
        })
        .catch((err: Error) => {
          if (totalTimeoutHandle) clearTimeout(totalTimeoutHandle);
          console.error(`[Execution ${executionId}] Wait error:`, err);
          socket.emit('execution-error', { executionId, error: err.message });
          this.cleanupContainer(executionId);
        });
    } catch (error: any) {
      if (totalTimeoutHandle) clearTimeout(totalTimeoutHandle);
      console.error(`[Execution ${executionId}] Fatal error:`, error);
      socket.emit('execution-error', {
        executionId,
        error: error.message || 'Execution failed',
      });
      await this.cleanupContainer(executionId);
    }
  }

  private handleOutputChunk(socket: Socket, executionId: string, chunk: Buffer) {
    const session = this.activeSessions.get(executionId);
    if (!session || session.finished) return;

    // Strip Docker multiplex header (8 bytes) if present
    let text: string;
    let isError = false;
    if (chunk.length > 8 && (chunk[0] === 1 || chunk[0] === 2)) {
      isError = chunk[0] === 2;
      text = chunk.subarray(8).toString('utf8');
    } else {
      text = chunk.toString('utf8');
    }
    if (!text) return;

    session.outputBuffer += text;
    console.log(`[Execution ${executionId}] Output: ${text.replace(/\n/g, '\\n')}`);
    socket.emit('output', { executionId, output: text, isError });

    // Reset input timeout (Python input() detection)
    this.scheduleInputTimeout(socket, executionId);
  }

  private scheduleInputTimeout(socket: Socket, executionId: string) {
    const session = this.activeSessions.get(executionId);
    if (!session || session.finished) return;
    if (session.inputTimeoutHandle) clearTimeout(session.inputTimeoutHandle);
    session.inputTimeoutHandle = setTimeout(() => {
      const s = this.activeSessions.get(executionId);
      if (!s || s.finished) return;
      socket.emit('output', {
        executionId,
        output: '\n⚠ Execution timeout – no response after input\n',
        isError: true,
      });
      socket.emit('execution-complete', { executionId, exitCode: 1 });
      this.cleanupContainer(executionId);
    }, INPUT_RESPONSE_TIMEOUT_MS);
  }

  private handleInputResponse(socket: Socket, executionId: string, input: string) {
    const session = this.activeSessions.get(executionId);
    if (!session || session.finished) {
      console.warn(`[Execution ${executionId}] No active session for input`);
      return;
    }
    if (session.inputTimeoutHandle) {
      clearTimeout(session.inputTimeoutHandle);
      session.inputTimeoutHandle = null;
    }
    console.log(`[Execution ${executionId}] Sending input: "${input}"`);
    socket.emit('output', { executionId, output: input + '\n', isError: false, isEcho: true });
    try {
      session.stdinStream.write(input + '\n');
    } catch (err) {
      console.error(`[Execution ${executionId}] Failed to write to stdin:`, err);
      socket.emit('execution-error', { executionId, error: 'Failed to send input to process' });
    }
  }

  private async createInteractiveContainer(code: string, language: string, executionId: string) {
    const tempDir = path.join(process.cwd(), 'temp');
    await fs.mkdir(tempDir, { recursive: true });
    const extension = language === 'python' ? 'py' : 'js';
    const fileName = `code_${executionId}.${extension}`;
    const filePath = path.join(tempDir, fileName);
    await fs.writeFile(filePath, code, 'utf-8');

    let image: string, cmd: string[];
    if (language === 'python') {
      image = 'python:3.11-alpine';
      cmd = ['python', '-u', `/app/${fileName}`];
    } else { // javascript
      image = 'node:18-alpine';
      cmd = ['node', `/app/${fileName}`];
    }

    const container = await this.dockerService['docker'].createContainer({
      Image: image,
      Cmd: cmd,
      AttachStdout: true,
      AttachStderr: true,
      AttachStdin: true,
      OpenStdin: true,
      StdinOnce: false,
      Tty: false,
      HostConfig: {
        Binds: [`${filePath}:/app/${fileName}:ro`],
        Memory: 128 * 1024 * 1024,
        MemorySwap: 128 * 1024 * 1024,
        NanoCpus: Math.floor(0.5 * 1e9),
        ReadonlyRootfs: false,
        SecurityOpt: ['no-new-privileges:true'],
        CapDrop: ['ALL'],
        NetworkMode: 'none',
        PidsLimit: 64,
        Tmpfs: { '/tmp': 'rw,noexec,nosuid,size=64M' },
      },
      WorkingDir: '/app',
      Env: language === 'python'
        ? ['PYTHONUNBUFFERED=1', 'PYTHONIOENCODING=utf-8', 'PYTHONDONTWRITEBYTECODE=1']
        : [], // Node.js doesn't need special env for unbuffered
    });

    const stdinStream = await container.attach({ stream: true, stdin: true, stdout: false, stderr: false });
    (container as any).codeFilePath = filePath;
    return { container, stdinStream };
  }

  private async cleanupContainer(executionId: string) {
    const session = this.activeSessions.get(executionId);
    if (!session) return;
    session.finished = true;
    if (session.inputTimeoutHandle) clearTimeout(session.inputTimeoutHandle);
    try {
      if (session.stdinStream) session.stdinStream.end();
      await session.container.stop({ t: 2 }).catch(() => {});
      await session.container.remove({ force: true }).catch(() => {});
      if ((session.container as any).codeFilePath) {
        await fs.unlink((session.container as any).codeFilePath).catch(() => {});
      }
    } catch (err) {
      console.error(`[Execution ${executionId}] Cleanup error:`, err);
    } finally {
      this.activeSessions.delete(executionId);
      console.log(`[Execution ${executionId}] Cleaned up`);
    }
  }

  private cleanupSessionsForSocket(socketId: string) {
    for (const [execId, session] of this.activeSessions) {
      if (session.socketId === socketId) this.cleanupContainer(execId);
    }
  }

  public async cleanup(): Promise<void> {
    console.log('🧹 Cleaning up all WebSocket sessions...');
    const ids = Array.from(this.activeSessions.keys());
    for (const id of ids) await this.cleanupContainer(id);
    if (this.io) this.io.close();
  }
}