import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export type LoggerLevel = "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent";

export interface LoggerOptions {
  directory: string;
  level?: LoggerLevel;
  bindings?: Record<string, unknown>;
}

export interface HostingLogger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
  debug(message: string, meta?: Record<string, unknown>): void;
  deploy(message: string, meta?: Record<string, unknown>): void;
  access(message: string, meta?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): HostingLogger;
  close(): void;
}

const LEVEL_ORDER: Record<LoggerLevel, number> = {
  fatal: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
  trace: 5,
  silent: 6,
};

function safeJson(value: unknown): string {
  if (typeof value === "undefined") return "undefined";
  try {
    return JSON.stringify(value);
  } catch {
    return `"[unserializable:${Object.prototype.toString.call(value)}]"`;
  }
}

function serialize(meta: Record<string, unknown> | undefined): string {
  if (!meta || Object.keys(meta).length === 0) return "";
  return ` ${safeJson(meta)}`;
}

function line(level: LoggerLevel, message: string, meta?: Record<string, unknown>): string {
  return `${new Date().toISOString()} [${level}] ${message}${serialize(meta)}`;
}

export function createLogger(options: LoggerOptions): HostingLogger {
  const directory = resolve(options.directory);
  const threshold = LEVEL_ORDER[options.level ?? "info"];
  const baseBindings = options.bindings ?? {};

  const appLog = join(directory, "app.log");
  const deployLog = join(directory, "deploy.log");
  const errorLog = join(directory, "error.log");
  const accessLog = join(directory, "access.log");

  function append(target: string, content: string): void {
    try {
      mkdirSync(dirname(target), { recursive: true });
      appendFileSync(target, `${content}\n`, { encoding: "utf8", flag: "a" });
    } catch (error) {
      console.error(`[logger] failed to write ${target}: ${String(error)}`);
    }
  }

  function write(level: LoggerLevel, message: string, meta?: Record<string, unknown>): void {
    const merged =
      Object.keys(baseBindings).length === 0 ? meta : { ...baseBindings, ...(meta ?? {}) };
    const content = line(level, message, merged);
    if (LEVEL_ORDER[level] <= threshold) {
      if (level === "error" || level === "fatal") {
        console.error(content);
      } else {
        console.log(content);
      }
    }
    if (level === "error" || level === "fatal") {
      append(errorLog, content);
    } else {
      append(appLog, content);
    }
  }

  const child = (bindings: Record<string, unknown>): HostingLogger =>
    createLogger({
      directory: options.directory,
      ...(options.level !== undefined ? { level: options.level } : {}),
      bindings: { ...baseBindings, ...bindings },
    });

  return {
    info: (message, meta) => write("info", message, meta),
    warn: (message, meta) => write("warn", message, meta),
    error: (message, meta) => write("error", message, meta),
    debug: (message, meta) => write("debug", message, meta),
    deploy: (message, meta) => {
      const merged =
        Object.keys(baseBindings).length === 0 ? meta : { ...baseBindings, ...(meta ?? {}) };
      const content = line("info", message, merged);
      console.log(content);
      append(deployLog, content);
    },
    access: (message, meta) => {
      const merged =
        Object.keys(baseBindings).length === 0 ? meta : { ...baseBindings, ...(meta ?? {}) };
      append(accessLog, line("info", message, merged));
    },
    child,
    close: () => {
      // File appenders are synchronous and require no flushing.
    },
  };
}
