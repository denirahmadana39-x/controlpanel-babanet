import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { createWriteStream, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const logDir = process.env.VERIFY_LOG_DIR ?? join(tmpdir(), "opencode");
mkdirSync(logDir, { recursive: true });

const PASS = "✔";
const FAIL = "✘";
const SKIP = "○";

const REQUIRED_ENV = [
  ["DATABASE_URL", "database connection string"],
  ["JWT_SECRET", "auth signing secret (>= 32 chars)"],
  ["JWT_REFRESH_SECRET", "auth refresh secret (>= 32 chars)"],
  ["UPLOAD_DIRECTORY", "UPLOAD_ROOT - upload root"],
  ["SITE_DIRECTORY", "WEBSITE_ROOT - live sites + version dirs"],
  ["TEMP_DIRECTORY", "DEPLOY_ROOT - deploy extraction temp"],
  ["BACKUP_DIRECTORY", "BACKUP_ROOT - backup root"],
  ["LOG_DIRECTORY", "LOG_ROOT - log root"],
];

const results = [];

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function loadDotEnv(filePath) {
  const values = {};
  try {
    const text = readFileSync(filePath, "utf8");
    for (const line of text.split("\n")) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!match) continue;
      values[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    return values;
  }
  return values;
}

function runCommand(cmd, args, options = {}) {
  const child = spawn(cmd, args, {
    cwd: options.cwd ?? root,
    env: { ...process.env, ...(options.env ?? {}) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk;
    if (options.passthrough) process.stdout.write(chunk);
  });
  child.stderr.on("data", (chunk) => {
    output += chunk;
    if (options.passthrough) process.stderr.write(chunk);
  });
  return new Promise((resolvePromise) => {
    child.on("error", (error) => resolvePromise({ ok: false, code: -1, output, error }));
    child.on("exit", (code) => resolvePromise({ ok: code === 0, code, output, error: null }));
  });
}

class StepError extends Error {
  constructor(reason, fix) {
    super(reason);
    this.fix = fix;
  }
}

async function assertCommand(label, cmd, args, fix, options = {}) {
  process.stdout.write(`  ${label} ...`);
  const result = await runCommand(cmd, args, options);
  if (result.ok) {
    process.stdout.write(` ${PASS}\n`);
    return result;
  }
  process.stdout.write(` ${FAIL}\n`);
  const lines = String(result.output ?? "")
    .split("\n")
    .filter(Boolean);
  if (lines.length > 0) {
    console.error(lines.slice(-60).join("\n"));
  }
  throw new StepError(`${label} failed`, fix);
}

function mark(label, ok, detail = "", reason = "", fix = "") {
  results.push({ label, ok, detail, reason, fix });
}

function loadEnvForReport() {
  const values = loadDotEnv(resolve(root, ".env"));
  return REQUIRED_ENV.map(([key, label]) => ({
    key,
    label,
    present: Boolean(values[key] && values[key].trim() !== ""),
  }));
}

async function getFreePort() {
  return new Promise((resolvePromise, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => resolvePromise(port));
    });
  });
}

async function getHealth(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`);
    if (response.status !== 200) return null;
    return await response.json();
  } catch {
    return null;
  }
}

function startServer(kind, port, onExit) {
  const script = kind === "api" ? "apps/api/dist/index.js" : "apps/worker/dist/index.js";
  const logPath = join(logDir, `verify-${kind}.log`);
  rmSync(logPath, { force: true });
  const env = { ...process.env, LOG_LEVEL: "warn" };
  if (kind === "api") {
    env.PORT = String(port);
  }
  const child = spawn(process.execPath, [script], {
    cwd: root,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const logStream = createWriteStream(logPath, { flags: "a" });
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk;
    logStream.write(chunk);
  });
  child.stderr.on("data", (chunk) => {
    output += chunk;
    logStream.write(chunk);
  });
  child.on("exit", (code, signal) => {
    logStream.end();
    onExit({ kind, code, signal, output });
  });
  return { child, logPath };
}

function logTail(server, maxLines = 40) {
  if (!server) return "";
  try {
    const text = readFileSync(server.logPath, "utf8");
    const lines = text.split("\n").filter(Boolean);
    return lines.slice(-maxLines).join("\n");
  } catch {
    return "";
  }
}

async function stopServer(server) {
  if (!server || server.stopped) return;
  server.stopped = true;
  const child = server.child;
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline && child.exitCode === null && child.signalCode === null) {
    await sleep(100);
  }
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
  }
}

async function waitForApi(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const health = await getHealth(port);
    if (health) return true;
    await sleep(500);
  }
  return false;
}

async function waitForComponents(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    const health = await getHealth(port);
    if (health) {
      last = health;
      if (
        health.database === "connected" &&
        health.worker === "initialized" &&
        health.queue === "ready"
      ) {
        return { ready: true, health };
      }
    }
    await sleep(500);
  }
  return { ready: false, health: last };
}

function printReport() {
  console.log("\nBabasti Hosting Verification\n");
  for (const result of results) {
    if (result.ok === true) {
      console.log(`${PASS} ${result.label}${result.detail ? ` (${result.detail})` : ""}`);
    } else if (result.ok === null) {
      console.log(`${SKIP} ${result.label} (skipped)`);
    } else {
      console.log(`${FAIL} ${result.label}`);
    }
  }
  const failed = results.find((result) => result.ok === false);
  if (failed) {
    console.log(`\nFAILED at step: ${failed.label}`);
    console.log(`  Step:    ${failed.label}`);
    console.log(`  Reason:  ${failed.reason}`);
    console.log(`  Suggested fix: ${failed.fix}`);
    process.exitCode = 1;
    return;
  }
  console.log("\nVerification completed successfully.\n");
  console.log("Safe to:");
  console.log("git add .");
  console.log("git commit");
  console.log("git push");
}

async function main() {
  let apiServer = null;
  let workerServer = null;
  const exited = [];

  try {
    await assertCommand(
      "Format",
      "pnpm",
      ["format:check"],
      "run `pnpm format` then re-run `pnpm verify`",
    );
    mark("Format", true);

    await assertCommand(
      "Lint",
      "pnpm",
      ["lint"],
      "run `pnpm lint -- --fix` then re-run `pnpm verify`",
    );
    mark("Lint", true);

    await assertCommand(
      "Typecheck",
      "pnpm",
      ["typecheck"],
      "fix the reported type errors then re-run `pnpm verify`",
    );
    mark("Typecheck", true);

    const tests = await assertCommand(
      "Tests",
      "pnpm",
      ["test"],
      "fix the failing tests then re-run `pnpm verify`",
    );
    const testMatch = String(tests.output ?? "").match(/\s+Tests\s+(\d+)\s+passed/i);
    mark("Tests", true, testMatch ? `${testMatch[1]} passed` : "");

    await assertCommand(
      "Build",
      "pnpm",
      ["build"],
      "fix the build errors then re-run `pnpm verify`",
    );
    mark("Build", true);

    await assertCommand(
      "Prisma",
      "pnpm",
      ["exec", "prisma", "validate"],
      "fix the schema errors reported by `prisma validate`",
    );
    await assertCommand(
      "Prisma",
      "pnpm",
      ["exec", "prisma", "migrate", "status"],
      "apply pending migrations with `pnpm db:deploy`",
    );
    mark("Prisma", true, "validate + migrate status");

    const envRows = loadEnvForReport();
    const missing = envRows.filter((row) => !row.present);
    if (missing.length > 0) {
      const list = missing.map((row) => row.key).join(", ");
      console.log(`  Environment ... ${FAIL}`);
      mark(
        "Environment",
        false,
        "",
        `missing required variables: ${list}`,
        "add the missing variables to .env",
      );
      return;
    }
    console.log(`  Environment ... ${PASS}`);
    for (const row of envRows) {
      console.log(`    ${row.key.padEnd(20)} ${row.label}`);
    }
    mark("Environment", true);

    const apiPort = await getFreePort();
    console.log(`  Starting temporary API on port ${apiPort}`);
    apiServer = startServer("api", apiPort, (info) => exited.push(info));
    const apiReady = await waitForApi(apiPort, 60_000);
    if (!apiReady) {
      console.log(`  API ... ${FAIL}`);
      const tail = logTail(apiServer);
      if (tail) console.log(tail);
      mark(
        "API",
        false,
        "",
        "API did not become healthy within 60s",
        `review ${apiServer.logPath}`,
      );
      return;
    }
    console.log(`  API ... ${PASS}`);
    mark("API", true);

    console.log("  Starting temporary Worker");
    workerServer = startServer("worker", null, (info) => exited.push(info));
    const componentState = await waitForComponents(apiPort, 120_000);
    if (!componentState.ready) {
      console.log(`  Worker ... ${FAIL}`);
      console.log(`  Health Checks ... ${FAIL}`);
      if (componentState.health) {
        console.log(
          `    database: ${componentState.health.database}  worker: ${componentState.health.worker}  queue: ${componentState.health.queue}`,
        );
      }
      const workerTail = logTail(workerServer);
      const apiTail = logTail(apiServer);
      if (workerTail) console.log(workerTail);
      if (apiTail) console.log(apiTail);
      const workerInitialized = componentState.health?.worker === "initialized";
      if (workerInitialized) {
        mark("Worker", true);
      } else {
        mark(
          "Worker",
          false,
          "",
          "no active worker detected (heartbeat stale or worker failed to start)",
          `review ${workerServer.logPath}`,
        );
      }
      mark(
        "Health Checks",
        false,
        "",
        "database, worker, or queue did not become healthy within 120s",
        "check that Postgres is reachable, a worker is running, and no deployment is stuck",
      );
      return;
    }
    console.log(`  Worker ... ${PASS}`);
    mark("Worker", true);
    console.log(`  Health Checks ... ${PASS}`);
    console.log(`    database: ${componentState.health.database}`);
    console.log(`    worker:   ${componentState.health.worker}`);
    console.log(`    queue:    ${componentState.health.queue}`);
    mark("Health Checks", true);

    const smoke = await runCommand(
      process.execPath,
      ["scripts/smoke.mjs", `http://127.0.0.1:${apiPort}`],
      {
        passthrough: true,
      },
    );
    if (smoke.ok) {
      console.log(`  Smoke Tests ... ${PASS}`);
      mark("Smoke Tests", true);
    } else {
      console.log(`  Smoke Tests ... ${FAIL}`);
      mark("Smoke Tests", false, "", "smoke tests failed", "see the smoke test output above");
    }
  } catch (error) {
    if (error instanceof StepError) {
      const failedLabel = error.message.replace(/ failed$/, "");
      const existing = results.find(
        (result) => result.label === failedLabel && result.ok === false,
      );
      if (!existing) {
        mark(failedLabel, false, "", error.message, error.fix);
      }
    } else {
      mark("Verification", false, "", String(error.message ?? error), "see the error above");
    }
  } finally {
    await stopServer(workerServer);
    await stopServer(apiServer);
    for (const info of exited) {
      if (
        info.code !== 0 &&
        info.code !== null &&
        info.signal !== "SIGTERM" &&
        info.signal !== "SIGKILL"
      ) {
        console.error(`  note: temporary ${info.kind} exited unexpectedly (code ${info.code})`);
      }
    }
  }
  printReport();
}

await main();
