import { readFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const baseUrl = (process.argv[2] ?? "").replace(/\/$/, "");
if (!baseUrl) {
  console.error("Usage: node scripts/smoke.mjs <apiBaseUrl>");
  process.exit(1);
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

const env = { ...loadDotEnv(resolve(root, ".env")), ...process.env };
const ADMIN_EMAIL = env.VERIFY_ADMIN_EMAIL || env.ADMIN_EMAIL || "admin@hosting.local";
const ADMIN_PASSWORD = env.VERIFY_ADMIN_PASSWORD || env.ADMIN_PASSWORD || "Admin12345!";
const PUBLIC_BASE_DOMAIN = env.PUBLIC_BASE_DOMAIN || "localhost";
const NGINX_PORT = Number(env.NGINX_PORT || 80);
const SKIP_NGINX = env.VERIFY_SKIP_NGINX === "1";

const cookieJar = {};
let csrfToken = null;

function storeCookies(response) {
  const setCookies = response.headers.getSetCookie ? response.headers.getSetCookie() : [];
  for (const cookie of setCookies) {
    const pair = cookie.split(";")[0];
    const index = pair.indexOf("=");
    if (index === -1) continue;
    cookieJar[pair.slice(0, index).trim()] = pair.slice(index + 1).trim();
  }
}

function cookieHeader() {
  return Object.entries(cookieJar)
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

async function api(path, options = {}) {
  const headers = { ...(options.headers ?? {}) };
  if (Object.keys(cookieJar).length > 0) {
    headers.Cookie = cookieHeader();
  }
  const method = (options.method ?? "GET").toUpperCase();
  if (csrfToken && method !== "GET" && method !== "HEAD") {
    headers["x-csrf-token"] = csrfToken;
  }
  const response = await fetch(`${baseUrl}${path}`, { ...options, method, headers });
  storeCookies(response);
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: response.status, body };
}

function check(name, condition, detail = "") {
  if (!condition) {
    throw new Error(`${name}${detail ? ` — ${detail}` : ""}`);
  }
  console.log(`  ✔ ${name}`);
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

let crcTableCache = null;
function crcTable() {
  if (crcTableCache) return crcTableCache;
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  crcTableCache = table;
  return table;
}

function crc32(buf) {
  const table = crcTable();
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeStoredZip(entries) {
  const entryNames = Object.keys(entries);
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const nameBuf = Buffer.from(name, "utf8");
    const data = Buffer.from(content, "utf8");
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, nameBuf, data);

    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE(20, 4);
    record.writeUInt16LE(20, 6);
    record.writeUInt16LE(0, 8);
    record.writeUInt16LE(0, 10);
    record.writeUInt16LE(0, 12);
    record.writeUInt16LE(0, 14);
    record.writeUInt32LE(crc, 16);
    record.writeUInt32LE(data.length, 20);
    record.writeUInt32LE(data.length, 24);
    record.writeUInt16LE(nameBuf.length, 28);
    record.writeUInt16LE(0, 30);
    record.writeUInt16LE(0, 32);
    record.writeUInt16LE(0, 34);
    record.writeUInt16LE(0, 36);
    record.writeUInt32LE(0, 38);
    record.writeUInt32LE(offset, 42);
    central.push(record, nameBuf);
    offset += local.length + nameBuf.length + data.length;
  }
  const centralStart = offset;
  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entryNames.length, 8);
  eocd.writeUInt16LE(entryNames.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(centralStart, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...chunks, centralBuf, eocd]);
}

async function waitForDeployment(projectId, version, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  let lastStatus = null;
  while (Date.now() < deadline) {
    const { status, body } = await api(`/api/projects/${projectId}/deployments`);
    if (status === 200 && Array.isArray(body?.deployments)) {
      const deployment = body.deployments.find((entry) => entry.version === version);
      if (deployment) {
        lastStatus = deployment.status;
        if (deployment.status === "SUCCEEDED") {
          return deployment;
        }
        if (deployment.status === "FAILED" || deployment.status === "ROLLED_BACK") {
          throw new Error(`deployment v${version} ended with status ${deployment.status}`);
        }
      }
    }
    await sleep(1500);
  }
  throw new Error(
    `deployment v${version} did not reach SUCCEEDED in time (last status: ${lastStatus})`,
  );
}

let projectId = null;
let projectName = null;

function fetchSiteWithHost(hostname, port) {
  return new Promise((resolvePromise, reject) => {
    const request = httpRequest(
      { host: "127.0.0.1", port, path: "/", setHost: false, headers: { Host: hostname } },
      (response) => {
        let body = "";
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () => resolvePromise({ status: response.statusCode, body }));
      },
    );
    request.on("error", reject);
    request.end();
  });
}

async function runChecks() {
  const health = await api("/health");
  check(
    "Health endpoint reports components ready",
    health.status === 200 &&
      health.body?.database === "connected" &&
      health.body?.worker === "initialized" &&
      health.body?.queue === "ready",
    JSON.stringify(health.body ?? health.status),
  );

  const login = await api("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  check(
    "Login as admin returns user + CSRF token",
    login.status === 200 &&
      login.body?.user?.email === ADMIN_EMAIL &&
      typeof login.body?.csrfToken === "string",
    JSON.stringify(login.body ?? login.status),
  );
  csrfToken = login.body.csrfToken;

  const dashboard = await api("/api/dashboard");
  check("Dashboard endpoint accessible", dashboard.status === 200, String(dashboard.status));

  projectName = `verify-${Date.now().toString(36)}`;
  const created = await api("/api/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: projectName, storageQuotaMb: 100 }),
  });
  check("Create project returns 201", created.status === 201, String(created.status));
  projectId = created.body?.project?.id ?? null;
  if (!projectId) {
    throw new Error("create project response missing project id");
  }

  const list = await api("/api/projects");
  check(
    "Project appears in list",
    list.status === 200 && list.body?.projects?.some((project) => project.id === projectId),
    String(list.status),
  );

  const markerV1 = `<h1>verify-v1-${projectName}</h1>`;
  const markerV2 = `<h1>verify-v2-${projectName}</h1>`;

  const badForm = new FormData();
  badForm.append("file", new Blob(["not a zip"], { type: "text/plain" }), "notes.txt");
  const rejected = await api(`/api/projects/${projectId}/upload`, {
    method: "POST",
    body: badForm,
  });
  check("Upload rejects non-zip archive", rejected.status === 400, String(rejected.status));

  const v1Zip = makeStoredZip({ "index.html": markerV1, "style.css": "body{}" });
  const v1Form = new FormData();
  v1Form.append("file", new Blob([v1Zip], { type: "application/zip" }), "site-v1.zip");
  const v1 = await api(`/api/projects/${projectId}/upload`, { method: "POST", body: v1Form });
  check("Upload v1 accepted", v1.status === 201, String(v1.status));
  const v1Deployment = await waitForDeployment(projectId, v1.body?.deployment?.version);
  check("Deployment v1 SUCCEEDED", v1Deployment.status === "SUCCEEDED");

  const deployments = await api(`/api/projects/${projectId}/deployments`);
  check(
    "Deployments endpoint lists the deployment",
    deployments.status === 200 &&
      deployments.body?.deployments?.some((entry) => entry.id === v1Deployment.id),
    String(deployments.status),
  );

  const v2Zip = makeStoredZip({ "index.html": markerV2, "style.css": "body{}" });
  const v2Form = new FormData();
  v2Form.append("file", new Blob([v2Zip], { type: "application/zip" }), "site-v2.zip");
  const v2 = await api(`/api/projects/${projectId}/upload`, { method: "POST", body: v2Form });
  check("Upload v2 accepted", v2.status === 201, String(v2.status));
  const v2Deployment = await waitForDeployment(projectId, v2.body?.deployment?.version);
  check("Deployment v2 SUCCEEDED", v2Deployment.status === "SUCCEEDED");

  const rollback = await api(`/api/projects/${projectId}/rollback`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ version: v1.body.deployment.version }),
  });
  check("Rollback request accepted", rollback.status === 201, String(rollback.status));
  const rollbackDeployment = await waitForDeployment(projectId, rollback.body?.deployment?.version);
  check("Rollback deployment SUCCEEDED", rollbackDeployment.status === "SUCCEEDED");

  const site = await api(`/api/projects/${projectId}/site`);
  check(
    "Site endpoint reflects active version",
    site.status === 200 &&
      site.body?.activeVersion === rollbackDeployment.version &&
      site.body?.lastDeploymentStatus === "SUCCEEDED",
    JSON.stringify(site.body ?? site.status),
  );

  if (!SKIP_NGINX) {
    const hostname = `${projectName}.${PUBLIC_BASE_DOMAIN}`;
    try {
      const siteResponse = await fetchSiteWithHost(hostname, NGINX_PORT);
      check(
        "Nginx serves the rolled-back v1 site",
        siteResponse.status === 200 && siteResponse.body.includes(markerV1),
        `expected marker ${markerV1} at Host ${hostname}`,
      );
    } catch (error) {
      check("Nginx serves the rolled-back v1 site", false, String(error));
    }
  }

  const metrics = await api("/api/metrics");
  check("Metrics endpoint accessible", metrics.status === 200, String(metrics.status));
}

(async () => {
  console.log(`Running smoke tests against ${baseUrl}`);
  let failed = false;
  try {
    await runChecks();
  } catch (error) {
    failed = true;
    console.error(`  ✘ ${error.message}`);
  } finally {
    if (projectId) {
      try {
        const { status } = await api(`/api/projects/${projectId}`, { method: "DELETE" });
        if (status === 204) {
          console.log("  ✔ Cleanup: temporary project removed");
        } else {
          console.error(`  ⚠ Cleanup: DELETE /api/projects returned ${status}`);
        }
      } catch (error) {
        console.error(`  ⚠ Cleanup failed: ${error.message}`);
      }
    }
  }
  if (failed) {
    process.exit(1);
  }
  console.log("Smoke tests passed.");
})().catch((error) => {
  console.error(`  ✘ ${error.message}`);
  process.exit(1);
});
