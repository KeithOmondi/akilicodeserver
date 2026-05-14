import Docker from 'dockerode';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs/promises';
import path from 'path';

export interface ExecutionOptions {
  timeout: number;        // Execution timeout in ms
  memoryLimit: number;    // Memory limit in MB
  cpuLimit: number;       // CPU limit (0.5 = 50% of one core)
  networkAccess: boolean; // Allow network access
  maxOutputSize: number;  // Maximum output in bytes
}

export interface ExecutionResult {
  success: boolean;
  output: string;
  error?: string;
  executionTimeMs: number;
  memoryUsed?: number;
}

export class DockerExecutionService extends EventEmitter {
  private docker: Docker;
  private tempDir: string;
  private activeContainers: Set<string>;

  constructor() {
    super();
    
    // Configure Docker for Windows/Linux/Mac with proper typing
    let dockerConfig: Docker.DockerOptions;
    
    if (process.platform === 'win32') {
      // Windows Docker Desktop configuration
      dockerConfig = { 
        host: 'localhost', 
        port: 2375,
        protocol: 'http' as const
      };
    } else {
      // Linux/Mac Docker socket configuration
      dockerConfig = { socketPath: '/var/run/docker.sock' };
    }
    
    this.docker = new Docker(dockerConfig);
    this.tempDir = path.join(__dirname, '../../temp');
    this.activeContainers = new Set();
    this.initialize();
  }

  private async initialize() {
    await fs.mkdir(this.tempDir, { recursive: true });
    this.cleanupStaleContainers();
  }

  private async cleanupStaleContainers() {
    try {
      const containers = await this.docker.listContainers({
        filters: { label: ['type=code-execution'] }
      });
      
      for (const container of containers) {
        const dockerContainer = this.docker.getContainer(container.Id);
        await dockerContainer.stop().catch(() => {});
        await dockerContainer.remove().catch(() => {});
      }
    } catch (error) {
      console.error('Cleanup error:', error);
    }
  }

  async executeCode(
    code: string,
    language: string,
    options: Partial<ExecutionOptions> = {}
  ): Promise<ExecutionResult> {
    const startTime = Date.now();
    const executionId = uuidv4();
    
    const defaults: ExecutionOptions = {
      timeout: 5000,           // 5 seconds
      memoryLimit: 128,        // 128 MB
      cpuLimit: 0.5,          // half a CPU core
      networkAccess: false,    // No network by default
      maxOutputSize: 1024 * 1024 // 1 MB max output
    };
    
    const config = { ...defaults, ...options };
    let container = null;
    let outputBuffer = '';
    
    try {
      // Create isolated container for execution
      container = await this.createExecutionContainer(
        code,
        language,
        config,
        executionId
      );
      
      this.activeContainers.add(executionId);
      this.emit('executionStart', { executionId, language });
      
      // Attach to container to capture output in real-time
      const stream = await container.attach({
        stream: true,
        stdout: true,
        stderr: true
      });
      
      // Collect output from stream
      stream.on('data', (chunk: Buffer) => {
        let chunkStr = chunk.toString('utf8');
        // Remove Docker's 8-byte header if present (type + size)
        if (chunkStr.length > 8 && (chunkStr.charCodeAt(0) === 1 || chunkStr.charCodeAt(0) === 2)) {
          chunkStr = chunkStr.substring(8);
        }
        
        if (outputBuffer.length + chunkStr.length <= config.maxOutputSize) {
          outputBuffer += chunkStr;
        } else if (outputBuffer.length < config.maxOutputSize) {
          const remaining = config.maxOutputSize - outputBuffer.length;
          outputBuffer += chunkStr.substring(0, remaining);
          outputBuffer += '\n... Output truncated (exceeded size limit) ...';
        }
      });
      
      // Start the container
      await container.start();
      
      // Wait for execution with timeout
      const result = await this.waitForExecution(container, config);
      
      // Give a moment for output to be captured
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Get resource usage
      let memoryUsed = 0;
      try {
        const stats = await container.stats({ stream: false });
        memoryUsed = Math.round(stats.memory_stats.usage / 1024 / 1024);
      } catch (statsError) {
        // Ignore stats errors
      }
      
      const executionTimeMs = Date.now() - startTime;
      
      this.emit('executionComplete', { 
        executionId, 
        language, 
        success: result.success,
        executionTimeMs 
      });
      
      const finalOutput = outputBuffer.trim();
      
      // Log output for debugging
      if (!result.success) {
        console.log(`[Docker] Error output: ${finalOutput}`);
      }
      
      return {
        success: result.success,
        output: finalOutput || (result.success ? '✅ Code ran successfully (no output)' : ''),
        error: result.error,
        executionTimeMs,
        memoryUsed
      };
      
    } catch (error) {
      const executionTimeMs = Date.now() - startTime;
      
      this.emit('executionError', { executionId, language, error });
      
      return {
        success: false,
        output: outputBuffer,
        error: error instanceof Error ? error.message : 'Execution failed',
        executionTimeMs
      };
    } finally {
      // Clean up container
      if (container) {
        await this.cleanupContainer(container, executionId);
      }
      this.activeContainers.delete(executionId);
    }
  }
  
  private async createExecutionContainer(
    code: string,
    language: string,
    config: ExecutionOptions,
    executionId: string
  ): Promise<Docker.Container> {
    
    // Create temporary file with code
    const fileName = this.getFileName(language);
    const filePath = path.join(this.tempDir, `${executionId}_${fileName}`);
    await fs.writeFile(filePath, code, 'utf-8');
    
    // Get Docker image and command based on language
    const { image, command, workDir } = this.getLanguageConfig(language, fileName);
    
    // Create bind mount for code file
    const binds = [`${filePath}:${workDir}/${fileName}:ro`];
    
    // Prepare environment variables
    const env = [
      'NODE_ENV=production',
      'PYTHONDONTWRITEBYTECODE=1',
      'PYTHONUNBUFFERED=1',
      'PYTHONIOENCODING=utf-8'
    ];
    
    if (!config.networkAccess) {
      env.push('NO_NETWORK=1');
    }
    
    // Create container with resource limits
    // IMPORTANT: Set ReadonlyRootfs to false for Python to work
    const container = await this.docker.createContainer({
      Image: image,
      Cmd: command,
      AttachStdout: true,
      AttachStderr: true,
      HostConfig: {
        Binds: binds,
        Memory: config.memoryLimit * 1024 * 1024,
        MemorySwap: config.memoryLimit * 1024 * 1024,
        NanoCpus: Math.floor(config.cpuLimit * 1e9),
        ReadonlyRootfs: false,  // Changed to false - Python needs to write temp files
        SecurityOpt: ['no-new-privileges:true'],
        CapDrop: ['ALL'],
        NetworkMode: config.networkAccess ? 'bridge' : 'none',
        AutoRemove: false,
        PidsLimit: 64,
        // Add a writable tmpfs for Python to use
        Tmpfs: {
          '/tmp': 'rw,noexec,nosuid,size=64M'
        }
      },
      Labels: {
        'type': 'code-execution',
        'language': language,
        'execution-id': executionId,
        'timestamp': Date.now().toString()
      },
      WorkingDir: workDir,
      Env: env
    });
    
    // Store file path for cleanup
    (container as any).codeFilePath = filePath;
    
    return container;
  }
  
  private getLanguageConfig(language: string, fileName: string = 'code.js'): { image: string; command: string[]; workDir: string } {
    const configs: Record<string, { image: string; command: string[]; workDir: string }> = {
      javascript: {
        image: 'node:18-alpine',
        command: ['node', '-e', `
          const fs = require('fs');
          const code = fs.readFileSync('/app/${fileName}', 'utf8');
          
          const blockedModules = ['fs', 'child_process', 'net', 'http', 'https', 'tls', 'crypto', 'os', 'path', 'process'];
          const originalRequire = module.constructor.prototype.require;
          
          module.constructor.prototype.require = function(moduleName) {
            if (blockedModules.includes(moduleName)) {
              throw new Error('Security Error: Module ' + moduleName + ' is blocked for security reasons');
            }
            if (moduleName === 'vm') {
              return originalRequire.call(this, moduleName);
            }
            return originalRequire.call(this, moduleName);
          };
          
          global.eval = function() { 
            throw new Error('eval() is blocked for security reasons'); 
          };
          global.Function = function() { 
            throw new Error('Function constructor is blocked for security reasons'); 
          };
          
          try {
            const vm = require('vm');
            const sandbox = {
              console: console,
              setTimeout: undefined,
              setInterval: undefined,
              require: function(moduleName) {
                throw new Error('require() is not available for security reasons');
              },
              module: { exports: {} },
              exports: {}
            };
            vm.createContext(sandbox);
            vm.runInContext(code, sandbox, { timeout: 5000 });
          } catch (err) {
            console.error(err.message);
            process.exit(1);
          }
        `],
        workDir: '/app'
      },
      python: {
  image: 'python:3.11-alpine',
  command: ['python', '-c', `
import builtins
import sys

# Block input() function
original_input = builtins.input
def blocked_input(prompt=''):
    raise Exception("Input is not supported in the playground. Please remove input() statements.")
builtins.input = blocked_input

# Execute the user's code
try:
    with open('/app/${fileName}', 'r') as f:
        code = f.read()
    exec(code)
except Exception as e:
    print(f"Error: {e}", file=sys.stderr)
    sys.exit(1)
`],
  workDir: '/app'
},
      html: {
        image: 'alpine:latest',
        command: ['cat', `/app/${fileName}`],
        workDir: '/app'
      },
      css: {
        image: 'alpine:latest',
        command: ['cat', `/app/${fileName}`],
        workDir: '/app'
      },
      cpp: {
        image: 'gcc:latest',
        command: ['sh', '-c', `g++ /app/${fileName} -o /tmp/program && /tmp/program`],
        workDir: '/app'
      },
      c: {
        image: 'gcc:latest',
        command: ['sh', '-c', `gcc /app/${fileName} -o /tmp/program && /tmp/program`],
        workDir: '/app'
      },
      java: {
        image: 'eclipse-temurin:17-jdk-alpine',
        command: ['sh', '-c', `javac /app/${fileName} && java -cp /app Main`],
        workDir: '/app'
      },
      typescript: {
        image: 'node:18-alpine',
        command: ['sh', '-c', `npm install -g typescript && tsc /app/${fileName} --outDir /tmp && node /tmp/${fileName.replace('.ts', '.js')}`],
        workDir: '/app'
      }
    };
    
    return configs[language] || configs.javascript;
  }
  
  private getFileName(language: string): string {
    const extensions: Record<string, string> = {
      javascript: 'code.js',
      python: 'code.py',
      html: 'code.html',
      css: 'code.css',
      cpp: 'code.cpp',
      c: 'code.c',
      java: 'Main.java',
      typescript: 'code.ts'
    };
    return extensions[language] || 'code.txt';
  }
  
  private async waitForExecution(
    container: Docker.Container,
    config: ExecutionOptions
  ): Promise<{ success: boolean; error?: string }> {
    
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        container.stop().catch(() => {});
        resolve({ 
          success: false, 
          error: `⏱ Execution timed out after ${config.timeout / 1000} seconds` 
        });
      }, config.timeout);
      
      container.wait((err: any, data: any) => {
        clearTimeout(timeout);
        
        if (err) {
          resolve({ success: false, error: err.message });
        } else {
          const exitCode = data.StatusCode;
          resolve({ 
            success: exitCode === 0,
            error: exitCode !== 0 ? `Process exited with code ${exitCode}` : undefined
          });
        }
      });
    });
  }
  
  private async cleanupContainer(container: Docker.Container, executionId: string) {
    try {
      // Stop container if still running
      await container.stop().catch(() => {});
      
      // Remove container
      await container.remove({ force: true }).catch(() => {});
      
      // Remove temp file
      if ((container as any).codeFilePath) {
        await fs.unlink((container as any).codeFilePath).catch(() => {});
      }
      
      this.emit('containerRemoved', { executionId });
    } catch (error) {
      console.error(`Failed to cleanup container ${executionId}:`, error);
    }
  }
  
  async getActiveExecutions(): Promise<number> {
    return this.activeContainers.size;
  }
  
  async killAllExecutions(): Promise<void> {
    try {
      const containers = await this.docker.listContainers({
        filters: { label: ['type=code-execution'] }
      });
      
      for (const containerInfo of containers) {
        const container = this.docker.getContainer(containerInfo.Id);
        await container.kill().catch(() => {});
        await container.remove({ force: true }).catch(() => {});
      }
      
      this.activeContainers.clear();
    } catch (error) {
      console.error('Failed to kill all executions:', error);
    }
  }

  async getDockerInfo(): Promise<any> {
    try {
      const info = await this.docker.info();
      return {
        containersRunning: info.ContainersRunning,
        containersStopped: info.ContainersStopped,
        containersPaused: info.ContainersPaused,
        images: info.Images,
        memoryLimit: info.MemTotal,
        cpus: info.NCPU,
        dockerVersion: info.ServerVersion,
        operatingSystem: info.OperatingSystem,
        kernelVersion: info.KernelVersion
      };
    } catch (error) {
      console.error('Failed to get Docker info:', error);
      return null;
    }
  }

  async listActiveContainers(): Promise<any[]> {
    try {
      const containers = await this.docker.listContainers({
        filters: { label: ['type=code-execution'] }
      });
      return containers.map(container => ({
        id: container.Id,
        name: container.Names[0],
        status: container.Status,
        created: container.Created,
        language: container.Labels?.language,
        executionId: container.Labels?.['execution-id']
      }));
    } catch (error) {
      console.error('Failed to list active containers:', error);
      return [];
    }
  }
}