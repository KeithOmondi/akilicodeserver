import { Request, Response, NextFunction } from "express";
import vm from "vm";
import { v4 as uuidv4 } from "uuid";
import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";
import os from "os";
import {
  CodeExecutionResult,
  CreateCodeSnippetDTO,
  UpdateCodeSnippetDTO,
} from "../interfaces/ICodePlayground";
import CodePlaygroundService from "../service/CodePlaygroundService";
import { AppError } from "../utils/appError";
import { catchAsync } from "../utils/catchAsync";
import { DockerExecutionService } from "../service/DockerExecutionService";

// ── Platform detection ─────────────────────────────────────────────────────────
const IS_WINDOWS = os.platform() === "win32";

// ── Sanitization helper ─────────────────────────────────────────────────────────
function sanitizeString(str: string | null | undefined): string | null {
  if (!str) return null;
  // Remove null bytes and other problematic control characters
  return str
    .replace(/\0/g, '')  // Remove null bytes
    .replace(/[^\x20-\x7E\n\t\r]/g, ''); // Remove non-printable chars (keep newlines, tabs, carriage returns)
}

// ── Spawn wrapper (cross-platform, handles timeouts + streaming) ───────────────
function spawnWithTimeout(
  cmd: string,
  args: string[],
  options: { cwd?: string; timeoutMs: number; env?: NodeJS.ProcessEnv },
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
      shell: IS_WINDOWS,
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr?.on("data", (d: Buffer) => (stderr += d.toString()));

    const timer = setTimeout(() => {
      if (IS_WINDOWS && child.pid) {
        spawn("taskkill", ["/pid", String(child.pid), "/f", "/t"], {
          shell: true,
        });
      } else {
        child.kill("SIGKILL");
      }
      reject(new Error(`TIMEOUT:${options.timeoutMs}`));
    }, options.timeoutMs);

    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0 && !stdout) {
        const err: any = new Error(
          stderr || `Process exited with code ${code}`,
        );
        err.stderr = stderr;
        reject(err);
      } else {
        // Sanitize stdout and stderr
        resolve({ 
          stdout: sanitizeString(stdout) || '', 
          stderr: sanitizeString(stderr) || '' 
        });
      }
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

// ── Temp directory ─────────────────────────────────────────────────────────────
const TEMP_DIR = path.join(os.tmpdir(), "code_playground");

async function ensureTemp(): Promise<void> {
  await fs.mkdir(TEMP_DIR, { recursive: true });
}

function tmpFile(ext: string): string {
  const uid = `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  return path.join(TEMP_DIR, `code_${uid}.${ext}`);
}

function timeoutResult(ms: number): CodeExecutionResult {
  return {
    success: false,
    error: `⏱ Timed out after ${ms / 1000}s — check for infinite loops.`,
  };
}

// ── Binary detection helpers (cached) ─────────────────────────────────────────
let _pythonBin: string | null = null;
async function getPythonBin(): Promise<string> {
  if (_pythonBin) return _pythonBin;
  for (const bin of ["python3", "python"]) {
    try {
      await spawnWithTimeout(bin, ["--version"], { timeoutMs: 3000 });
      return (_pythonBin = bin);
    } catch {}
  }
  throw new Error(
    'Python not found in PATH.\nDownload from https://python.org\nDuring install, check "Add Python to PATH".',
  );
}

let _tsRunner: string | null = null;
async function getTsRunner(): Promise<string> {
  if (_tsRunner) return _tsRunner;
  for (const bin of ["ts-node", "tsx"]) {
    try {
      await spawnWithTimeout(bin, ["--version"], { timeoutMs: 3000 });
      return (_tsRunner = bin);
    } catch {}
  }
  throw new Error(
    "TypeScript runner not found.\nRun one of:\n  npm i -g ts-node typescript\n  npm i -g tsx",
  );
}

async function isBinAvailable(bin: string): Promise<boolean> {
  try {
    await spawnWithTimeout(bin, ["--version"], { timeoutMs: 3000 });
    return true;
  } catch {
    try {
      await spawnWithTimeout(bin, ["-version"], { timeoutMs: 3000 });
      return true;
    } catch {
      return false;
    }
  }
}

// ── Formatting utilities ───────────────────────────────────────────────────────
function formatValue(v: unknown): string {
  if (v === null) return "null";
  if (v === undefined) return "undefined";
  if (typeof v === "string") return v;
  if (typeof v === "function")
    return `[Function: ${(v as Function).name || "anonymous"}]`;
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

function formatTable(data: unknown): string {
  if (!data || typeof data !== "object") return String(data);
  const rows = Array.isArray(data)
    ? data
    : Object.entries(data as object).map(([k, v]) => ({ key: k, value: v }));
  if (rows.length === 0) return "(empty table)";
  const keys = Array.from(
    new Set(rows.flatMap((r) => Object.keys(r as object))),
  );
  const cols = keys.map((k) =>
    Math.max(k.length, ...rows.map((r) => String((r as any)[k] ?? "").length)),
  );
  const sep = cols.map((w) => "-".repeat(w + 2)).join("+");
  const header = keys.map((k, i) => ` ${k.padEnd(cols[i])} `).join("|");
  const body = rows.map((r) =>
    keys
      .map((k, i) => ` ${String((r as any)[k] ?? "").padEnd(cols[i])} `)
      .join("|"),
  );
  return [header, sep, ...body].join("\n");
}

async function cleanup(...files: string[]): Promise<void> {
  await Promise.all(files.map((f) => fs.unlink(f).catch(() => {})));
}

// =============================================================================
export class CodePlaygroundController {
  private dockerService: DockerExecutionService | null = null;
  private rateLimitMap = new Map<string, number[]>();
  private useDocker: boolean;

  constructor() {
    // Check if Docker execution should be used
    this.useDocker = process.env.USE_DOCKER_EXECUTION === "true";

    if (this.useDocker) {
      try {
        this.dockerService = new DockerExecutionService();

        // Set up event monitoring
        this.dockerService.on("executionStart", ({ executionId, language }) => {
          console.log(
            `[Docker] Execution started: ${executionId} (${language})`,
          );
        });

        this.dockerService.on(
          "executionComplete",
          ({ executionId, success, executionTimeMs }) => {
            console.log(
              `[Docker] Execution completed: ${executionId} - Success: ${success} (${executionTimeMs}ms)`,
            );
          },
        );

        this.dockerService.on(
          "executionError",
          ({ executionId, language, error }) => {
            console.error(
              `[Docker] Execution error: ${executionId} (${language}) - ${error}`,
            );
          },
        );

        this.dockerService.on("containerRemoved", ({ executionId }) => {
          console.log(`[Docker] Container cleaned up: ${executionId}`);
        });

        console.log("[Docker] Docker execution service initialized");
      } catch (error) {
        console.error("[Docker] Failed to initialize Docker service:", error);
        this.useDocker = false;
        this.dockerService = null;
      }
    } else {
      console.log(
        "[Docker] Docker execution disabled, using local execution fallback",
      );
    }
  }

  // ==================== Snippet Controllers ====================

  createSnippet = catchAsync(
    async (req: Request, res: Response, next: NextFunction) => {
      const userId = (req as any).user?.id || null;
      const data: CreateCodeSnippetDTO = req.body;
      if (!data.name || !data.code || !data.language)
        return next(new AppError("Name, code, and language are required", 400));
      const snippet = await CodePlaygroundService.createSnippet(userId, data);
      res.status(201).json({ success: true, data: snippet });
    },
  );

  getSnippet = catchAsync(
    async (req: Request, res: Response, next: NextFunction) => {
      const snippetId = [req.params.id].flat()[0];
      const userId = (req as any).user?.id;
      const snippet = await CodePlaygroundService.getSnippetById(
        snippetId,
        userId,
      );
      if (!snippet) return next(new AppError("Snippet not found", 404));
      res.json({ success: true, data: snippet });
    },
  );

  getUserSnippets = catchAsync(
    async (req: Request, res: Response, next: NextFunction) => {
      const userId = (req as any).user?.id;
      if (!userId) return next(new AppError("Authentication required", 401));
      const { language, favorite, limit, offset } = req.query;
      const snippets = await CodePlaygroundService.getUserSnippets(userId, {
        language: language as string,
        favorite: favorite === "true",
        limit: limit ? parseInt(limit as string) : undefined,
        offset: offset ? parseInt(offset as string) : undefined,
      });
      res.json({ success: true, data: snippets });
    },
  );

  updateSnippet = catchAsync(
    async (req: Request, res: Response, next: NextFunction) => {
      const snippetId = [req.params.id].flat()[0];
      const userId = (req as any).user?.id;
      if (!userId) return next(new AppError("Authentication required", 401));
      const updated = await CodePlaygroundService.updateSnippet(
        snippetId,
        userId,
        req.body,
      );
      if (!updated)
        return next(new AppError("Snippet not found or unauthorized", 404));
      res.json({ success: true, data: updated });
    },
  );

  deleteSnippet = catchAsync(
    async (req: Request, res: Response, next: NextFunction) => {
      const snippetId = [req.params.id].flat()[0];
      const userId = (req as any).user?.id;
      if (!userId) return next(new AppError("Authentication required", 401));
      const deleted = await CodePlaygroundService.deleteSnippet(
        snippetId,
        userId,
      );
      if (!deleted)
        return next(new AppError("Snippet not found or unauthorized", 404));
      res.json({ success: true, message: "Snippet deleted successfully" });
    },
  );

  toggleFavorite = catchAsync(
    async (req: Request, res: Response, next: NextFunction) => {
      const snippetId = [req.params.id].flat()[0];
      const userId = (req as any).user?.id;
      if (!userId) return next(new AppError("Authentication required", 401));
      const updated = await CodePlaygroundService.toggleFavorite(
        snippetId,
        userId,
      );
      if (!updated)
        return next(new AppError("Snippet not found or unauthorized", 404));
      res.json({ success: true, data: updated });
    },
  );

  // ==================== Code Execution ====================

  executeCode = catchAsync(
    async (req: Request, res: Response, next: NextFunction) => {
      const { code, language, snippetId } = req.body;
      if (!code || !language)
        return next(new AppError("Code and language are required", 400));

      // Rate limiting check
      const userId = (req as any).user?.id || req.ip;
      const canExecute = await this.checkRateLimit(userId);
      if (!canExecute) {
        return next(
          new AppError("Rate limit exceeded. Please try again later.", 429),
        );
      }

      const startTime = Date.now();
      let result: CodeExecutionResult;

      try {
        // Use Docker for execution if available, fallback to local execution
        if (this.useDocker && this.dockerService) {
          // Execute using Docker isolation
          const dockerResult = await this.dockerService.executeCode(
            code,
            language,
            {
              timeout: 5000, // 5 seconds max
              memoryLimit: 128, // 128 MB max
              cpuLimit: 0.5, // Half a CPU core
              networkAccess: false, // No internet access
              maxOutputSize: 1024 * 1024, // 1MB max output
            },
          );

          result = {
            success: dockerResult.success,
            output: dockerResult.output,
            error: dockerResult.error,
            executionTimeMs: dockerResult.executionTimeMs,
            ...(dockerResult.memoryUsed && {
              memoryUsed: dockerResult.memoryUsed,
            }),
          };
        } else {
          // Fallback to local execution
          result = await this.runCode(code, language);
        }
      } catch (error) {
        result = {
          success: false,
          error: error instanceof Error ? error.message : "Execution failed",
          executionTimeMs: 0,
        };
      }

      result.executionTimeMs = Date.now() - startTime;
      
      // Sanitize result before saving to database
      const sanitizedResult = {
        ...result,
        output: sanitizeString(result.output) || undefined,
        error: sanitizeString(result.error) || undefined,
      };
      
      await CodePlaygroundService.saveExecution(
        snippetId || null,
        code,
        language,
        sanitizedResult,
      );
      
      // Return the original (non-sanitized) result to the client for proper rendering
      res.json({ success: true, data: result });
    },
  );

  private async checkRateLimit(userId: string): Promise<boolean> {
    const now = Date.now();
    const userLimit = this.rateLimitMap.get(userId) || [];
    const recent = userLimit.filter((time: number) => now - time < 60000);

    if (recent.length >= 10) {
      return false;
    }

    recent.push(now);
    this.rateLimitMap.set(userId, recent);

    // Clean up old entries periodically
    if (Math.random() < 0.01) {
      for (const [key, times] of this.rateLimitMap.entries()) {
        const fresh = times.filter((t) => now - t < 60000);
        if (fresh.length === 0) {
          this.rateLimitMap.delete(key);
        } else {
          this.rateLimitMap.set(key, fresh);
        }
      }
    }

    return true;
  }

  // Docker health check endpoint
  getDockerHealth = catchAsync(
    async (req: Request, res: Response, next: NextFunction) => {
      if (!this.dockerService) {
        return res.json({
          success: true,
          data: {
            status: "disabled",
            dockerEnabled: false,
            message: "Docker execution is not enabled",
          },
        });
      }

      const activeExecutions = await this.dockerService.getActiveExecutions();
      res.json({
        success: true,
        data: {
          status: "healthy",
          activeExecutions,
          dockerEnabled: true,
          timestamp: new Date().toISOString(),
        },
      });
    },
  );

  // Kill all running executions (admin only)
  killAllExecutions = catchAsync(
    async (req: Request, res: Response, next: NextFunction) => {
      const isAdmin = (req as any).user?.role === "admin";
      if (!isAdmin) return next(new AppError("Admin access required", 403));

      if (this.dockerService) {
        await this.dockerService.killAllExecutions();
      }
      res.json({ success: true, message: "All executions terminated" });
    },
  );

  private async runCode(
    code: string,
    language: string,
  ): Promise<CodeExecutionResult> {
    await ensureTemp();
    switch (language) {
      case "javascript":
        return this.runJavaScript(code);
      case "typescript":
        return this.runTypeScript(code);
      case "python":
        return this.runPython(code);
      case "html":
        return this.runHTML(code);
      case "css":
        return this.runCSS(code);
      case "cpp":
        return this.runCpp(code);
      case "c":
        return this.runC(code);
      case "java":
        return this.runJava(code);
      default:
        return {
          success: false,
          error: `Language "${language}" is not supported.`,
        };
    }
  }

  // ── JavaScript ─────────────────────────────────────────────────────────────
  private runJavaScript(code: string): Promise<CodeExecutionResult> {
    return new Promise((resolve) => {
      const logs: string[] = [];
      const sandbox = {
        console: {
          log: (...a: unknown[]) => logs.push(a.map(formatValue).join(" ")),
          error: (...a: unknown[]) =>
            logs.push("ERROR: " + a.map(formatValue).join(" ")),
          warn: (...a: unknown[]) =>
            logs.push("WARN: " + a.map(formatValue).join(" ")),
          info: (...a: unknown[]) =>
            logs.push("INFO: " + a.map(formatValue).join(" ")),
          table: (d: unknown) => logs.push(formatTable(d)),
          dir: (d: unknown) => logs.push(formatValue(d)),
        },
        Math,
        JSON,
        Array,
        Object,
        String,
        Number,
        Boolean,
        Symbol,
        BigInt,
        Map,
        Set,
        WeakMap,
        WeakSet,
        Promise,
        parseInt,
        parseFloat,
        isNaN,
        isFinite,
        encodeURIComponent,
        decodeURIComponent,
        Date,
        RegExp,
        Error,
        TypeError,
        RangeError,
        SyntaxError,
        process: undefined,
        require: undefined,
        fetch: undefined,
        setTimeout: undefined,
        setInterval: undefined,
        setImmediate: undefined,
        __dirname: undefined,
        __filename: undefined,
        global: undefined,
        Buffer: undefined,
      };
      try {
        vm.runInNewContext(code, sandbox, {
          timeout: 5000,
          displayErrors: true,
        });
        const output = logs.join("\n") || "(no output)";
        resolve({ success: true, output: sanitizeString(output) || "(no output)" });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        resolve({
          success: false,
          error: sanitizeString(
            msg.includes("timed out")
              ? "⏱ Timed out (5s) — check for infinite loops."
              : msg
          ) || "Unknown error",
        });
      }
    });
  }

  // ── TypeScript ─────────────────────────────────────────────────────────────
  private async runTypeScript(code: string): Promise<CodeExecutionResult> {
    let runner: string;
    try {
      runner = await getTsRunner();
    } catch (e: any) {
      return { success: false, error: sanitizeString(e.message) || "Runner not found" };
    }

    const file = tmpFile("ts");
    try {
      await fs.writeFile(file, code, "utf-8");
      const args =
        runner === "ts-node"
          ? [
              "--skip-project",
              "--compiler-options",
              '{"module":"commonjs"}',
              file,
            ]
          : [file];
      const { stdout, stderr } = await spawnWithTimeout(runner, args, {
        timeoutMs: 10_000,
      });
      await fs.unlink(file).catch(() => {});
      return {
        success: true,
        output: stdout.trim() || "(no output)",
        ...(stderr.trim() ? { warning: stderr.trim() } : {}),
      };
    } catch (err: any) {
      await fs.unlink(file).catch(() => {});
      if (err.message?.startsWith("TIMEOUT:")) return timeoutResult(10_000);
      return { success: false, error: sanitizeString(err.stderr?.trim() ?? err.message) || "Execution failed" };
    }
  }

  // ── Python ─────────────────────────────────────────────────────────────────
  private async runPython(code: string): Promise<CodeExecutionResult> {
    let pythonBin: string;
    try {
      pythonBin = await getPythonBin();
    } catch (e: any) {
      return { success: false, error: sanitizeString(e.message) || "Python not found" };
    }

    const file = tmpFile("py");
    try {
      await fs.writeFile(file, code, "utf-8");
      const { stdout, stderr } = await spawnWithTimeout(pythonBin, [file], {
        timeoutMs: 5_000,
      });
      await fs.unlink(file).catch(() => {});
      if (stderr && !stdout) return { success: false, error: sanitizeString(stderr.trim()) || "Python error" };
      return {
        success: true,
        output: stdout.trim() || "(no output)",
        ...(stderr.trim() ? { warning: stderr.trim() } : {}),
      };
    } catch (err: any) {
      await fs.unlink(file).catch(() => {});
      if (err.message?.startsWith("TIMEOUT:")) return timeoutResult(5_000);
      return { success: false, error: sanitizeString(err.stderr?.trim() ?? err.message) || "Execution failed" };
    }
  }

  // ── HTML ───────────────────────────────────────────────────────────────────
  private runHTML(code: string): Promise<CodeExecutionResult> {
    return Promise.resolve({
      success: true,
      output: code,
      type: "html",
    } as any);
  }

  // ── CSS ────────────────────────────────────────────────────────────────────
  private runCSS(code: string): Promise<CodeExecutionResult> {
    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <style>
    body { font-family: sans-serif; padding: 2rem; }
    ${code}
  </style>
</head>
<body>
  <h1>Heading 1</h1>
  <h2>Heading 2</h2>
  <h3>Heading 3</h3>
  <p>Paragraph with <a href="#">a link</a>, <strong>bold</strong>, and <em>italic</em> text.</p>
  <button>Button</button>
  <input type="text" placeholder="Input field" />
  <ul><li>List item one</li><li>List item two</li><li>List item three</li></ul>
  <div class="box">div.box</div>
  <div class="container"><div class="item">div.container > div.item</div></div>
  <table>
    <thead><tr><th>Header 1</th><th>Header 2</th></tr></thead>
    <tbody><tr><td>Cell 1</td><td>Cell 2</td></tr>
   </tbody>
  </table>
</body>
</html>`;
    return Promise.resolve({
      success: true,
      output: html,
      type: "html",
    } as any);
  }

  // ── C++ ────────────────────────────────────────────────────────────────────
  private async runCpp(code: string): Promise<CodeExecutionResult> {
    if (!(await isBinAvailable("g++"))) {
      return {
        success: false,
        error: [
          "g++ not found.",
          "On Windows, install MinGW-w64:",
          "  1. Download from https://winlibs.com (UCRT, 64-bit)",
          "  2. Extract to C:\\mingw64",
          "  3. Add C:\\mingw64\\bin to your PATH",
          "  4. Restart your terminal / Node process",
        ].join("\n"),
      };
    }
    const src = tmpFile("cpp");
    const bin = src.replace(".cpp", IS_WINDOWS ? ".exe" : ".out");
    try {
      await fs.writeFile(src, code, "utf-8");
      await spawnWithTimeout("g++", ["-std=c++17", "-Wall", "-o", bin, src], {
        timeoutMs: 15_000,
      });
      const { stdout, stderr } = await spawnWithTimeout(bin, [], {
        timeoutMs: 5_000,
      });
      await cleanup(src, bin);
      if (stderr && !stdout) return { success: false, error: sanitizeString(stderr.trim()) || "C++ error" };
      return { success: true, output: stdout.trim() || "(no output)" };
    } catch (err: any) {
      await cleanup(src, bin);
      if (err.message?.startsWith("TIMEOUT:")) return timeoutResult(5_000);
      return { success: false, error: sanitizeString(err.stderr?.trim() ?? err.message) || "Execution failed" };
    }
  }

  // ── C ──────────────────────────────────────────────────────────────────────
  private async runC(code: string): Promise<CodeExecutionResult> {
    if (!(await isBinAvailable("gcc"))) {
      return {
        success: false,
        error: [
          "gcc not found.",
          "On Windows, install MinGW-w64:",
          "  1. Download from https://winlibs.com (UCRT, 64-bit)",
          "  2. Extract to C:\\mingw64",
          "  3. Add C:\\mingw64\\bin to your PATH",
          "  4. Restart your terminal / Node process",
        ].join("\n"),
      };
    }
    const src = tmpFile("c");
    const bin = src.replace(".c", IS_WINDOWS ? ".exe" : ".out");
    try {
      await fs.writeFile(src, code, "utf-8");
      await spawnWithTimeout("gcc", ["-std=c17", "-Wall", "-o", bin, src], {
        timeoutMs: 15_000,
      });
      const { stdout, stderr } = await spawnWithTimeout(bin, [], {
        timeoutMs: 5_000,
      });
      await cleanup(src, bin);
      if (stderr && !stdout) return { success: false, error: sanitizeString(stderr.trim()) || "C error" };
      return { success: true, output: stdout.trim() || "(no output)" };
    } catch (err: any) {
      await cleanup(src, bin);
      if (err.message?.startsWith("TIMEOUT:")) return timeoutResult(5_000);
      return { success: false, error: sanitizeString(err.stderr?.trim() ?? err.message) || "Execution failed" };
    }
  }

  // ── Java ───────────────────────────────────────────────────────────────────
  private async runJava(code: string): Promise<CodeExecutionResult> {
    if (!(await isBinAvailable("javac"))) {
      return {
        success: false,
        error: [
          "Java not found.",
          "Install JDK from https://adoptium.net",
          "The .msi installer adds java/javac to PATH automatically.",
          "Restart your terminal / Node process after installing.",
        ].join("\n"),
      };
    }

    const className = this.extractJavaClassName(code);
    const dir = path.join(
      TEMP_DIR,
      `java_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    );
    const src = path.join(dir, `${className}.java`);

    try {
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(src, code, "utf-8");
      await spawnWithTimeout("javac", [src], {
        cwd: dir,
        timeoutMs: 15_000,
      }).catch((e) => e);
      const { stdout, stderr } = await spawnWithTimeout(
        "java",
        ["-cp", dir, className],
        { cwd: dir, timeoutMs: 5_000 },
      );
      await fs.rm(dir, { recursive: true, force: true });
      if (stderr && !stdout) return { success: false, error: sanitizeString(stderr.trim()) || "Java error" };
      return { success: true, output: stdout.trim() || "(no output)" };
    } catch (err: any) {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
      if (err.message?.startsWith("TIMEOUT:")) return timeoutResult(5_000);
      return { success: false, error: sanitizeString(err.stderr?.trim() ?? err.message) || "Execution failed" };
    }
  }

  private extractJavaClassName(code: string): string {
    const match = code.match(/public\s+class\s+(\w+)/);
    return match ? match[1] : "Main";
  }

  // ==================== Execution History ====================

  getExecutionHistory = catchAsync(
    async (req: Request, res: Response, next: NextFunction) => {
      const id = [req.params.snippetId].flat()[0];
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 10;
      const history = await CodePlaygroundService.getExecutionHistory(
        id,
        limit,
      );
      res.json({ success: true, data: history });
    },
  );

  // ==================== Session Controllers ====================

  saveSession = catchAsync(
    async (req: Request, res: Response, next: NextFunction) => {
      const userId = (req as any).user?.id || null;
      const sessionToken =
        req.cookies?.playground_session ||
        req.headers["x-session-token"] ||
        uuidv4();
      const {
        current_code,
        current_language,
        cursor_position,
        selected_lines,
        font_size,
        is_dark_mode,
      } = req.body;
      const session = await CodePlaygroundService.createOrUpdateSession(
        userId,
        sessionToken as string,
        {
          current_code,
          current_language,
          cursor_position,
          selected_lines,
          font_size,
          is_dark_mode,
        },
      );
      if (!req.cookies?.playground_session) {
        res.cookie("playground_session", sessionToken, {
          maxAge: 30 * 24 * 60 * 60 * 1000,
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "lax",
        });
      }
      res.json({ success: true, data: session, sessionToken });
    },
  );

  getSession = catchAsync(
    async (req: Request, res: Response, next: NextFunction) => {
      const sessionToken =
        req.cookies?.playground_session || req.headers["x-session-token"];
      if (!sessionToken) return res.json({ success: true, data: null });
      const session = await CodePlaygroundService.getSessionByToken(
        sessionToken as string,
      );
      res.json({ success: true, data: session });
    },
  );

  // ==================== Search & Analytics ====================

  searchSnippets = catchAsync(
    async (req: Request, res: Response, next: NextFunction) => {
      const userId = (req as any).user?.id;
      if (!userId) return next(new AppError("Authentication required", 401));
      const { q } = req.query;
      if (!q || typeof q !== "string")
        return next(new AppError("Search query required", 400));
      const results = await CodePlaygroundService.searchSnippets(userId, q);
      res.json({ success: true, data: results });
    },
  );

  getStats = catchAsync(
    async (req: Request, res: Response, next: NextFunction) => {
      const userId = (req as any).user?.id;
      if (!userId) return next(new AppError("Authentication required", 401));
      const stats = await CodePlaygroundService.getSnippetStats(userId);
      res.json({ success: true, data: stats });
    },
  );

  // ==================== Share Controllers ====================

  generateShareLink = catchAsync(
    async (req: Request, res: Response, next: NextFunction) => {
      const snippetId = [req.params.id].flat()[0];
      const userId = (req as any).user?.id;
      if (!userId) return next(new AppError("Authentication required", 401));
      const shareToken = await CodePlaygroundService.generateShareToken(
        snippetId,
        userId,
      );
      if (!shareToken)
        return next(new AppError("Snippet not found or unauthorized", 404));
      const shareUrl = `${req.protocol}://${req.get("host")}/api/v1/playground/shared/${shareToken}`;
      res.json({ success: true, data: { shareUrl, shareToken } });
    },
  );

  getSharedSnippet = catchAsync(
    async (req: Request, res: Response, next: NextFunction) => {
      const shareToken = [req.params.token].flat()[0];
      const snippet =
        await CodePlaygroundService.getSharedSnippetByToken(shareToken);
      if (!snippet) return next(new AppError("Shared snippet not found", 404));
      res.json({ success: true, data: snippet });
    },
  );
}


export default new CodePlaygroundController();