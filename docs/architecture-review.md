# Architecture Review

Phase 3.5 Part 2 — architecture refinement & production hardening. Reviewed `2026-08-03` against the running system (real PostgreSQL + system nginx + live API/worker).

## System overview

Self-hosted static-site hosting platform with an upload-and-deploy workflow. The system is a pnpm/Turbo monorepo: two Node services (`api`, `worker`) and two React frontends (`admin`, `client`) sharing libraries under `packages/*`.

```
                     ┌─────────────────────┐     ┌──────────────────────┐
  admin (5173) ──────┤        API          │────▶│      PostgreSQL      │
  client (5174) ─────┤  apps/api  (3000)   │     │  (hosting-pg, 5433)   │
                     │  auth, CRUD,        │     └──────────────────────┘
                     │  upload, rollback   │            ▲
                     └─────────┬───────────┘            │ heartbeat / claims
                               │ queue (Deployment rows │ FOR UPDATE SKIP LOCKED
                               │ status=QUEUED)         │
                     ┌─────────▼───────────┐            │
  system nginx ◀─────┤        WORKER       ├────────────┘
  (sites, port 80)   │  apps/worker         │
                     │  extract→swap→nginx │
                     └─────────────────────┘
```

## Component inventory

| Component                    | Role                                                                                           | Key interfaces                                                                                                                                              |
| ---------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api`                   | Fastify HTTP API; zod type provider; all mutations behind CSRF + permission guards             | `/api/auth/*`, `/api/projects/*`, `/api/deployments/*`, `/api/domains/*`, `/api/files/*`, `/api/dashboard/*`, `/api/users/*`, `/api/metrics`, `/api/health` |
| `apps/worker`                | Deployment executor; claims QUEUED jobs, runs deploy/rollback inside a per-project transaction | poll loop, `DeploymentJobProcessor`                                                                                                                         |
| `apps/admin` / `apps/client` | React operator/customer frontends (excluded from this hardening pass)                          | —                                                                                                                                                           |
| `packages/database`          | Prisma 7 client + repositories, advisory locks, transaction facade                             | `Database`, `withProjectTransaction`, `projectLockKeyPair`                                                                                                  |
| `packages/deploy`            | Extraction + live-symlink pipeline, quota/limits                                               | `DeployService` (uses `StorageManager`)                                                                                                                     |
| `packages/storage`           | Filesystem manager: uploads, version dirs, atomic symlink swap                                 | `activateVersion`, `restoreVersion`, `saveUpload`                                                                                                           |
| `packages/nginx`             | Engine config schema + per-site config generation + controller                                 | `NginxController` (file lock, 30 s command timeout)                                                                                                         |
| `packages/errors`            | Canonical error codes, typed domain errors, backward-compatible `AppError`                     | `ErrorCodes`, `HTTP_STATUS_BY_CODE`, `isDomainError`                                                                                                        |
| `packages/shared`            | Roles/permissions constants, engine defaults, domain events                                    | `ROLE_CODES`, `PERMISSION_CODES`, `ENGINE_DEFAULTS`, `createEventBus`                                                                                       |
| `packages/auth`              | Password hashing, JWT, session/refresh rotation, CSRF                                          | `AuthService`                                                                                                                                               |
| `packages/monitoring`        | In-process metrics registry                                                                    | counters/gauges/histograms                                                                                                                                  |
| `packages/logger`            | Structured pino logging + file access log                                                      | `child` bindings                                                                                                                                            |
| `packages/ui`                | Shared React components + `api()`/`ApiError` client                                            | —                                                                                                                                                           |

## Request lifecycle (API)

1. `onRequest` hooks set `x-request-id: request.id` and run `AuthService.authenticate` (JWT from cookie or Bearer; silently no-ops when absent).
2. Route `preHandler` guards: `requirePermissions(ROLE_CODES/PERMISSION_CODES)` then `requireCsrf` for mutating routes when cookie-authenticated.
3. Handler resolves typed DB/service calls; errors propagate to the unified error handler.
4. Error envelope (additive, backward compatible with the frontend `ApiError` contract):

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Project not found",
    "requestId": "req-i",
    "timestamp": "...",
    "details": {}
  }
}
```

Fastify validation failures keep `FST_ERR_VALIDATION` and include `details.validation`. All errors carry `x-request-id` on the response.

5. `onResponse` records metrics (`api_requests_total`, `api_request_duration_seconds`) and appends the access log.

**Fastify hook note (finding):** this Fastify 5.11.0 + Node 24.18 combination stalls any _synchronous_ lifecycle hook that returns `undefined` (the hook runner only advances via `result.then(...)`). All hooks in this codebase are `async` — this was an intentional constraint confirmed by the smoke test; keep it that way.

## Deployment pipeline

1. **Upload** (`POST /api/projects/:id/upload`): streams to `uploadDirectory` with `.part` + rename, verifies 4-byte zip signature, checks quota, inserts `Deployment{status:QUEUED}` with the next version (allocated under the 64-bit advisory lock pair).
2. **Claim** (worker): `FOR UPDATE SKIP LOCKED` on QUEUED/RUNNING; registers `workerId`, sets RUNNING.
3. **Deploy** (`DeployService`): extract to `versionDir.pending`, verify entries (traversal/NUL/dot-path/extension whitelist/limits), hash files, then atomically swap the `live` symlink (`activateVersion`).
4. **Finalize**: everything runs inside `withProjectTransaction(db, projectId, fn)` — a transaction-scoped `Database` under the project advisory lock. Files/nginx work happens first; all DB writes (deployment SUCCEEDED, active flags, `deactivateByProject`, files, storage usage, history) commit atomically or roll back.
5. **Rollback**: same flow with `restoreVersion` to a previous succeeded deployment; the superseded version is marked `ROLLED_BACK`.

## Concurrency model

| Layer                            | Mechanism                                                                                                                      |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Job claim                        | `SELECT ... FOR UPDATE SKIP LOCKED` (multiple workers)                                                                         |
| Version allocation / project ops | Postgres advisory xact locks, 64-bit pair (`pg_advisory_xact_lock(int4, int4)`) keyed by `projectLockKeyPair` (FNV-1a, salted) |
| Deploy fs + DB atomicity         | `withProjectTransaction` transaction facade                                                                                    |
| nginx mutations                  | Cross-process `FileLock` with 30 s stale takeover (PID-liveness checked)                                                       |
| nginx commands                   | 30 s timeout with SIGKILL on hung `nginx` binary                                                                               |

## Configuration

- Single source of truth `ENGINE_DEFAULTS` in `@hosting/shared`; API and worker zod env schemas default from it (nginx binary/ports/paths, upload/zip limits, retention, temp age, worker timings).
- `apps/api/nginx.config.ts` builds the API's own nginx config; the engine config is assembled by `loadNginxEngineConfig` with serve-root/temp-dir overrides.

## Observability

- Metrics registry (`@hosting/monitoring`) exposed at guarded `/api/metrics`.
- Structured logs: worker bindings (`workerId`, `hostname`, `pid`); request correlation via `requestId`/`x-request-id`; file access log; deploy error logs.
- Domain events (deployment.completed/failed/requeued, rollback.completed/failed) via in-process `EventBus` — subscriber-isolated, ready for Phase 4 notifications/webhooks.

## Security posture

- Password timing equalization, bcrypt hashing, JWT access/refresh rotation with token-reuse detection, CSRF tokens, HTTP-only cookies.
- Permission model centralized as `PERMISSION_CODES`/`ROLE_PERMISSIONS` in `@hosting/shared`; route guards reference constants, never string literals.
- Zip extraction hardening, upload quota checks, nginx dotfile/security-header rules.
- Error responses never leak stack traces or internals (500s collapse to `INTERNAL_ERROR`).

## Decision log (this phase)

1. **`@hosting/errors` package**: single error system (codes + HTTP map + typed errors) replacing ad-hoc `AppError` usage; kept backward-compatible constructor.
2. **Unified success envelope: POSTPONED** (Section 14). Frontends cast success payloads directly, so a `{success,data}` envelope would break them; only the error envelope was extended additively.
3. **64-bit advisory locks**: single 32-bit `int4` had collision risk; moved to the `(int4, int4)` pair form.
4. **Transactional worker completion**: fs/nginx + DB writes commit or roll back together.
5. **Storage symlink abstraction**: `packages/deploy` no longer touches raw `node:fs` symlink/stat logic; all live-version mutation lives in `StorageManager`.
6. **All Fastify hooks async**: required for the installed Fastify 5.11.0 + Node 24.18 combination (see finding above).
7. **Additive schema migrations deferred**: schema is already well-indexed; recommendations recorded in `technical-debt.md` rather than churning migrations.

## Risks & hotspots

- `copyTree`/extraction are synchronous and memory-bound per entry (see technical-debt.md).
- Worker fs work precedes the DB transaction, so a crash between fs mutation and commit can leave a `.pending`/version dir orphan; the cleanup sweep handles stale version/temp dirs.
- In-process EventBus is lost on worker restart — acceptable until a durable outbox is introduced (Phase 4).
- `admin`/`client` consume the API contract but are outside this hardening pass.
