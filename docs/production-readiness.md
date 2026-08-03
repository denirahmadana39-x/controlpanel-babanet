# Production Readiness Report

Phase 3.5 hardening — updated `2026-08-03` (Part 2 architecture refinement).

## What was done

### Concurrency

- Worker claims jobs with `SELECT ... FOR UPDATE SKIP LOCKED` so multiple workers never run the same deployment.
- Per-project Postgres advisory xact locks serialize version allocation (`createWithNextVersion`) and project operations. Lock keying moved to a **64-bit pair** `pg_advisory_xact_lock(int4, int4)` via `projectLockKeyPair` (FNV-1a, salted) to eliminate 32-bit collision surface. Raw lock queries cast to `::text` for Prisma 7 driver-adapter compatibility.
- nginx config mutations are serialized with a cross-process `FileLock`; `applySiteConfig` / `removeSite` are composite mutations. Lock takeover now verifies PID liveness before unlinking a stale lock; hung nginx commands are killed after a 30 s timeout.
- Live-site swap is atomic: symlink to `versionDir.pending` then `rename` over `liveDir` (`StorageManager.activateVersion` / `restoreVersion`); the deploy pipeline no longer touches raw fs symlink/stat logic.

### Worker reliability

- Self-registration with `randomUUID` + hostname + pid; periodic heartbeat (`Worker.lastHeartbeatAt`).
- Retry up to `MAX_ATTEMPTS` with dead-letter `FAILED` + history record; `requeueForRetry` guards on QUEUED/RUNNING and publishes `deployment.requeued`.
- **Transactional completion**: deploy/rollback finalization runs inside `withProjectTransaction(db, projectId, fn)` — a transaction-scoped `Database` under the project advisory lock — so fs/nginx work plus all DB writes (status, active flags, files, storage usage, history, backup row) commit atomically or roll back.
- Orphan recovery at startup and every 5 min (raw SQL rewritten to an `EXISTS` subquery after Postgres rejected `FOR UPDATE` on the nullable side of a LEFT JOIN).
- Graceful drain on SIGINT/SIGTERM; unhandled rejection/exception handlers; structured logs with `workerId`/`hostname`/`pid` bindings.
- **Domain events**: in-process `EventBus` (`@hosting/shared`) publishes `deployment.created/completed/failed/requeued` and `rollback.completed/failed`; subscriber-isolated (a throwing subscriber never breaks the publisher). Ready for Phase 4 notifications/webhooks.

### DB / FS / API

- Dashboard N+1 eliminated: batched `findActiveByProjects`, `latestByProjects`, `countByProjects`, `findByProjects`.
- Atomic uploads (`*.part` + `rename`), sha256 computed inline while streaming; zip extraction hashes inline and reports checksums.
- `isZipArchive` reads only the 4-byte signature instead of buffering the whole upload.
- Uploads stream to disk via `pipeline`; multipart limits enforce `fileSize`, 1 file, 1 field.
- `@hosting/errors`: canonical `ErrorCodes` + HTTP status map, typed domain errors (Validation/Auth/NotFound/Conflict/Quota/PayloadTooLarge/etc.), backward-compatible `AppError`.
- **Unified error envelope** (additive, frontend-compatible): `{ error: { code, message, requestId, timestamp, details? } }` plus `x-request-id` response header matching the `requestId`. Prisma P2002→409, P2025→404; Fastify validation errors include `details.validation`; 500s collapse to `INTERNAL_ERROR`. `requestId` embedded in audit metadata.
- Env defaults consolidated in `ENGINE_DEFAULTS` (`@hosting/shared`); API and worker zod env schemas default from it.

### Metrics & logging

- `@hosting/monitoring` registry (counters/gauges/histograms/timers), `/api/metrics` endpoint (guarded), `api_requests_total`, `api_request_duration_seconds`.
- Structured access log with request correlation; deploy/error logs; logger `child` bindings; per-request `requestId`.

### Security

- Login timing equalization (`verifyDummyPassword`) to prevent user enumeration.
- CSRF (`x-csrf-token`) enforced on mutating routes for cookie-auth; **all Fastify lifecycle hooks are `async`** — this Fastify 5.11.0 + Node 24.18 combination stalls synchronous hooks that return `undefined`, so this is now an enforced codebase constraint.
- Permission string literals replaced with `PERMISSION_CODES`/`ROLE_CODES` constants.
- Zip extraction: traversal/NUL/dot-path rejection, per-entry and total-size limits, allowed-extension whitelist, `.well-known` support.
- nginx hardening: dotfile blocking, security headers, forbidden file handling.

### Tooling

- CI (`ci.yml`) now runs tests and provisions a `postgres:16-alpine` service; format check enforced; repo is prettier-clean.
- Fixed `packages/errors` build (added tsup config); react-refresh lint warnings eliminated by splitting frontend `App`/`router` exports; README/stale-flag fixes.

## Verification

| Check               | Result                                                                                                                                                                                                                                                                                                                                        |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm build`        | 14/14 packages pass                                                                                                                                                                                                                                                                                                                           |
| `pnpm lint`         | 14/14 pass, 0 warnings                                                                                                                                                                                                                                                                                                                        |
| `pnpm typecheck`    | 14/14 pass (strict, `exactOptionalPropertyTypes`)                                                                                                                                                                                                                                                                                             |
| `pnpm test`         | 10 files / 65 tests pass                                                                                                                                                                                                                                                                                                                      |
| `pnpm format:check` | clean                                                                                                                                                                                                                                                                                                                                         |
| `pnpm db:validate`  | schema valid                                                                                                                                                                                                                                                                                                                                  |
| `pnpm db:deploy`    | 4 migrations applied, 0 pending                                                                                                                                                                                                                                                                                                               |
| Config fail-fast    | API and worker exit code 1 with readable zod errors on bad env                                                                                                                                                                                                                                                                                |
| Live smoke          | login → create project → upload v1 (deploy) → upload v2 → nginx serves v2 → rollback to v1 → nginx serves v1; deployment states `[v3 active/rollbackOf=v1, v2 ROLLED_BACK, v1 SUCCEEDED]`; events `deployment.completed`×2 + `rollback.completed` published; error envelope verified (404, invalid login, non-zip upload, validation details) |
| Live processes      | API + worker running against real PostgreSQL and system nginx                                                                                                                                                                                                                                                                                 |

## Known limitations / recommended before launch

1. **Secrets**: `.env` still contains dev defaults (JWT secrets, `Admin12345!`) — rotate before any public exposure.
2. **Extraction memory**: each zip entry is decompressed with `adm-zip` into memory, bounded by `MAX_SINGLE_FILE_SIZE_MB`. Under many concurrent deploys this multiplies; reduce the cap or stream extraction for high load.
3. **Sync FS**: `copyTree` and extraction are synchronous; a large deploy briefly blocks the worker event loop (heartbeat is 30 s, acceptable at current limits).
4. **nginx reload**: config writes run `nginx -t` + reload per deploy; consider coalescing under high deploy volume.
5. **Frontends**: `admin`/`client` were not part of this hardening pass (API contract only).
6. **Rate limits**: global 300/min, login 5/15 min — tune for expected traffic.
7. **HTTPS/ACME**: not implemented; front the API and sites with a TLS proxy for production.
8. **Durable events**: the in-process EventBus is lost on worker restart; add a durable outbox for production-grade notifications/webhooks (Phase 4).
9. **Sync-hook constraint**: any new Fastify lifecycle hook must be `async`; consider pinning a Fastify version that fixes sync hooks or adding a lint rule.
