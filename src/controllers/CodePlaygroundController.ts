// src/controllers/codeExecutionController.ts
import { Request, Response, NextFunction } from "express";
import vm from "vm";
import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { AppError } from "../utils/appError";
import { catchAsync } from "../utils/catchAsync";
import { DockerExecutionService } from "../service/DockerExecutionService";

// ── Platform detection ─────────────────────────────────────────────────────────
const IS_WINDOWS = os.platform() === "win32";

// ── Sanitization helper ─────────────────────────────────────────────────────────
function sanitizeString(str: string | null | undefined): string | null {
  if (!str) return null;
  return str
    .replace(/\0/g, '')
    .replace(/[^\x20-\x7E\n\t\r]/g, '');
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
        spawn("taskkill", ["/pid", String(child.pid), "/f", "/t"], { shell: true });
      } else {
        child.kill("SIGKILL");
      }
      reject(new Error(`TIMEOUT:${options.timeoutMs}`));
    }, options.timeoutMs);

    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0 && !stdout) {
        const err: any = new Error(stderr || `Process exited with code ${code}`);
        err.stderr = stderr;
        reject(err);
      } else {
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
const TEMP_DIR = path.join(os.tmpdir(), "code_execution");

async function ensureTemp(): Promise<void> {
  await fs.mkdir(TEMP_DIR, { recursive: true });
}

function tmpFile(ext: string): string {
  const uid = `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  return path.join(TEMP_DIR, `code_${uid}.${ext}`);
}

function timeoutResult(ms: number) {
  return {
    success: false,
    error: `⏱ Timed out after ${ms / 1000}s — check for infinite loops.`,
  };
}

// ── Binary detection helpers ─────────────────────────────────────────────────
let _pythonBin: string | null = null;
async function getPythonBin(): Promise<string> {
  if (_pythonBin) return _pythonBin;
  for (const bin of ["python3", "python"]) {
    try {
      await spawnWithTimeout(bin, ["--version"], { timeoutMs: 3000 });
      return (_pythonBin = bin);
    } catch {}
  }
  throw new Error('Python not found in PATH.\nDownload from https://python.org');
}

// ── Formatting utilities ───────────────────────────────────────────────────────
function formatValue(v: unknown): string {
  if (v === null) return "null";
  if (v === undefined) return "undefined";
  if (typeof v === "string") return v;
  if (typeof v === "function") return `[Function: ${(v as Function).name || "anonymous"}]`;
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

function formatTable(data: unknown): string {
  if (!data || typeof data !== "object") return String(data);
  const rows = Array.isArray(data) ? data : Object.entries(data as object).map(([k, v]) => ({ key: k, value: v }));
  if (rows.length === 0) return "(empty table)";
  const keys = Array.from(new Set(rows.flatMap((r) => Object.keys(r as object))));
  const cols = keys.map((k) => Math.max(k.length, ...rows.map((r) => String((r as any)[k] ?? "").length)));
  const sep = cols.map((w) => "-".repeat(w + 2)).join("+");
  const header = keys.map((k, i) => ` ${k.padEnd(cols[i])} `).join("|");
  const body = rows.map((r) => keys.map((k, i) => ` ${String((r as any)[k] ?? "").padEnd(cols[i])} `).join("|"));
  return [header, sep, ...body].join("\n");
}

async function cleanup(...files: string[]): Promise<void> {
  await Promise.all(files.map((f) => fs.unlink(f).catch(() => {})));
}

// =============================================================================
export class CodeExecutionController {
  private dockerService: DockerExecutionService | null = null;
  private rateLimitMap = new Map<string, number[]>();
  private useDocker: boolean;

  constructor() {
    this.useDocker = process.env.USE_DOCKER_EXECUTION === "true";
    if (this.useDocker) {
      try {
        this.dockerService = new DockerExecutionService();
        this.dockerService.on("executionStart", ({ executionId, language }) => {
          console.log(`[Docker] Start: ${executionId} (${language})`);
        });
        this.dockerService.on("executionComplete", ({ executionId, success, executionTimeMs }) => {
          console.log(`[Docker] Complete: ${executionId} - Success:${success} (${executionTimeMs}ms)`);
        });
        this.dockerService.on("executionError", ({ executionId, error }) => {
          console.error(`[Docker] Error: ${executionId} - ${error}`);
        });
        console.log("[Docker] Execution service ready");
      } catch (error) {
        console.error("[Docker] Failed to init:", error);
        this.useDocker = false;
        this.dockerService = null;
      }
    } else {
      console.log("[Execution] Using local fallback (no Docker)");
    }
  }

  private async checkRateLimit(userId: string): Promise<boolean> {
    const now = Date.now();
    const userLimit = this.rateLimitMap.get(userId) || [];
    const recent = userLimit.filter((time: number) => now - time < 60000);
    if (recent.length >= 10) return false;
    recent.push(now);
    this.rateLimitMap.set(userId, recent);
    // cleanup old entries occasionally
    if (Math.random() < 0.01) {
      for (const [key, times] of this.rateLimitMap.entries()) {
        const fresh = times.filter((t) => now - t < 60000);
        if (fresh.length === 0) this.rateLimitMap.delete(key);
        else this.rateLimitMap.set(key, fresh);
      }
    }
    return true;
  }

  // ==================== Execution Endpoint ====================
  executeCode = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
    const { code, language } = req.body;
    if (!code || !language) {
      return next(new AppError("Code and language are required", 400));
    }

    // Only allow our four languages
    const allowedLanguages = ["javascript", "python", "html", "css"];
    if (!allowedLanguages.includes(language)) {
      return next(new AppError(`Language "${language}" is not supported. Allowed: ${allowedLanguages.join(", ")}`, 400));
    }

    const userId = (req as any).user?.id || req.ip;
    if (!(await this.checkRateLimit(userId))) {
      return next(new AppError("Rate limit exceeded. Try again later.", 429));
    }

    const startTime = Date.now();
    let result;

    try {
      if (this.useDocker && this.dockerService) {
        const dockerResult = await this.dockerService.executeCode(code, language, {
          timeout: 5000,
          memoryLimit: 128,
          cpuLimit: 0.5,
          networkAccess: false,
          maxOutputSize: 1024 * 1024,
        });
        result = {
          success: dockerResult.success,
          output: dockerResult.output,
          error: dockerResult.error,
          executionTimeMs: dockerResult.executionTimeMs,
          memoryUsed: dockerResult.memoryUsed,
        };
      } else {
        result = await this.runCodeLocally(code, language);
      }
    } catch (error: any) {
      result = {
        success: false,
        error: error.message || "Execution failed",
        executionTimeMs: Date.now() - startTime,
      };
    }

    result.executionTimeMs = Date.now() - startTime;
    res.json({ success: true, data: result });
  });

  private async runCodeLocally(code: string, language: string) {
    await ensureTemp();
    switch (language) {
      case "javascript": return this.runJavaScript(code);
      case "python": return this.runPython(code);
      case "html": return this.runHTML(code);
      case "css": return this.runCSS(code);
      default: return { success: false, error: `Language "${language}" not supported locally` };
    }
  }

  // ── JavaScript (sandboxed) ─────────────────────────────────────────────────
  private runJavaScript(code: string): Promise<any> {
    return new Promise((resolve) => {
      const logs: string[] = [];
      const sandbox = {
        console: {
          log: (...a: unknown[]) => logs.push(a.map(formatValue).join(" ")),
          error: (...a: unknown[]) => logs.push("ERROR: " + a.map(formatValue).join(" ")),
          warn: (...a: unknown[]) => logs.push("WARN: " + a.map(formatValue).join(" ")),
          info: (...a: unknown[]) => logs.push("INFO: " + a.map(formatValue).join(" ")),
          table: (d: unknown) => logs.push(formatTable(d)),
          dir: (d: unknown) => logs.push(formatValue(d)),
        },
        Math, JSON, Array, Object, String, Number, Boolean,
        Map, Set, WeakMap, WeakSet, Promise,
        parseInt, parseFloat, isNaN, isFinite,
        encodeURIComponent, decodeURIComponent,
        Date, RegExp, Error,
      };
      try {
        vm.runInNewContext(code, sandbox, { timeout: 5000, displayErrors: true });
        const output = logs.join("\n") || "(no output)";
        resolve({ success: true, output: sanitizeString(output) || "(no output)" });
      } catch (err: any) {
        const msg = err.message || String(err);
        resolve({
          success: false,
          error: msg.includes("timed out") ? "⏱ Timed out (5s)" : msg,
        });
      }
    });
  }

  // ── Python (local spawn) ─────────────────────────────────────────────────
  private async runPython(code: string): Promise<any> {
    let pythonBin: string;
    try {
      pythonBin = await getPythonBin();
    } catch (e: any) {
      return { success: false, error: sanitizeString(e.message) || "Python missing" };
    }
    const file = tmpFile("py");
    try {
      await fs.writeFile(file, code, "utf-8");
      const { stdout, stderr } = await spawnWithTimeout(pythonBin, [file], { timeoutMs: 5000 });
      await cleanup(file);
      if (stderr && !stdout) return { success: false, error: sanitizeString(stderr.trim()) || "Python error" };
      return {
        success: true,
        output: stdout.trim() || "(no output)",
        ...(stderr.trim() && { warning: stderr.trim() }),
      };
    } catch (err: any) {
      await cleanup(file);
      if (err.message?.startsWith("TIMEOUT:")) return timeoutResult(5000);
      return { success: false, error: sanitizeString(err.stderr?.trim() ?? err.message) };
    }
  }

  // ── HTML (just return code for frontend rendering) ────────────────────────
  private runHTML(code: string): Promise<any> {
    return Promise.resolve({ success: true, output: code, type: "html" });
  }

  // ── CSS (wrap in minimal HTML for preview) ────────────────────────────────
  private runCSS(code: string): Promise<any> {
    const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>CSS Preview</title>
<style>body{font-family:sans-serif;padding:2rem;} ${code}</style>
</head>
<body>
  <h1>Heading 1</h1>
  <p>Paragraph with <a href="#">link</a></p>
  <button>Button</button>
  <ul><li>List item</li></ul>
  <div class="demo">Demo div</div>
</body>
</html>`;
    return Promise.resolve({ success: true, output: html, type: "html" });
  }

  // ==================== Health Check ====================
  getDockerHealth = catchAsync(async (req: Request, res: Response) => {
    if (!this.dockerService) {
      return res.json({ success: true, data: { status: "disabled", dockerEnabled: false } });
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
  });

  // Admin only: kill all active executions
  killAllExecutions = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
    const isAdmin = (req as any).user?.role === "admin";
    if (!isAdmin) return next(new AppError("Admin access required", 403));
    if (this.dockerService) await this.dockerService.killAllExecutions();
    res.json({ success: true, message: "All executions terminated" });
  });
}

export default new CodeExecutionController();