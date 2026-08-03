# Technical Debt Report

Inventory of known debt and deferred work after Phase 3.5 Part 2. Reviewed `2026-08-03`.

Priority legend: **H** = do before launch, **M** = important follow-up, **L** = nice to have.

## Recently retired (this phase)

| Item                                                                   | Resolution                                                                          |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Ad-hoc error codes/messages across routes                              | `@hosting/errors` canonical codes + typed errors; `AppError` kept for compatibility |
| Permission string literals in route guards                             | Replaced with `PERMISSION_CODES` references                                         |
| Raw fs symlink/stat logic inside deploy pipeline                       | Moved behind `StorageManager` symlink abstraction                                   |
| Single 32-bit advisory lock collision surface                          | 64-bit `(int4,int4)` lock pair via `projectLockKeyPair`                             |
| Non-atomic deploy completion (fs ok + DB fail → inconsistent state)    | `withProjectTransaction` commits fs+DB together                                     |
| nginx command hangs                                                    | 30 s timeout + SIGKILL; PID-liveness lock takeover                                  |
| Sync `onRequest` hook hanging all requests (Fastify 5.11 + Node 24.18) | All lifecycle hooks made async; documented in architecture-review.md                |
| 2 react-refresh lint warnings                                          | Split `App`/`router` exports in both frontends                                      |
| Stale README (`-- --admin` flag, missing `errors` package)             | Fixed; prettier formatted                                                           |
| CI missing test step / no postgres service                             | Added to `.github/workflows/ci.yml`                                                 |
| `packages/errors` build failure (no tsup config)                       | Added standard `tsup.config.ts`                                                     |

## Open debt

### H — Security/ops

1. **Secrets rotation** — `.env` ships dev defaults (`JWT_*`, `Admin12345!`). Rotate before any public exposure; add a startup warning when known dev values are detected.
2. **HTTPS / ACME** — not implemented. Front API and sites with a TLS proxy; add automatic cert issuance (Phase 4: SSL).
3. **Rate-limit tuning** — global 300/min and login 5/15 min are guesses; benchmark expected traffic (Phase 4: monitoring-driven tuning).

### H — Worker/fs robustness

4. **Synchronous FS during deploy** — `copyTree` and zip extraction are synchronous; a large site briefly blocks the worker event loop (heartbeat 30 s tolerates current limits, but not large concurrent deploys). Migrate extraction to streaming/async (`yauzl`-style) and bound total per-entry memory (see #7).
5. **Crash window between fs work and DB commit** — the deploy phase mutates the filesystem before `withProjectTransaction` commits. An orphaned `.pending`/version dir is cleaned by the periodic sweep, but a durable deploy journal (fs marker written before commit, reconciled at startup) would close the window (Phase 4).
6. **In-process EventBus volatility** — events are lost on worker restart. Introduce a durable outbox table + publisher for notifications/webhooks (Phase 4).

### M — API/contract

7. **Extraction memory bound** — each zip entry is decompressed into memory up to `MAX_SINGLE_FILE_SIZE_MB`. Under concurrent deploys this multiplies; either lower the cap or stream entries to disk.
8. **Route business logic still in handlers** — deployments/domains/projects/users/files handlers embed logic in `*.routes.ts`. Extraction into `apps/api/src/services/*.service.ts` (mirroring `auth.service.ts`) was **deferred** to avoid churn/regression risk; do it before routes grow further. No HTTP contract change is needed.
9. **Unified success envelope postponed (Section 14)** — frontends cast success payloads directly; adding `{success,data}` would break them. Keep the additive error envelope; revisit only if a v2 API is introduced.
10. **`FST_ERR_VALIDATION` passthrough** — Fastify validation errors are returned with their raw code. Acceptable, but a mapping pass (`FST_ERR_*` → canonical codes) would make API errors fully consistent.

### L — Performance / DX

11. **nginx reload coalescing** — `nginx -t` + reload per deploy. Under high deploy volume, batch or debounce reloads.
12. **Dashboard/site queries** — the `/site` info endpoint runs several sequential repo calls; batch with `Promise.all` (already partially done) or a dedicated projection query if latency matters.
13. **Schema index additions (reviewed, not migrated)** — the schema is already indexed on FK and hot query paths (`Deployment[projectId,status]`, `[status,createdAt]`, `ActivityLog[userId,createdAt]`, `AuditLog[entityType,entityId]`, `Worker[lastHeartbeatAt]`). Optional additions if query patterns change: composite on `DeploymentHistory[projectId,deployedAt]`, `Backup[projectId,status]`, `Notification[userId,isRead]`. Add via an additive `prisma migrate dev --create-only` migration when the query workload is known.
14. **Frontend hardening** — `admin`/`client` are out of scope for this pass (API contract only). They still import `ApiError` from `@hosting/ui`; a follow-up should align them with the new error/observability story.
15. **Hook-runner constraint** — all Fastify lifecycle hooks must be `async` (sync hooks stall on Fastify 5.11.0 + Node 24.18). Consider pinning a Fastify version where the sync-hook path is fixed, or adding a lint rule to enforce async hooks.

## Deferred to Phase 4 (by design)

- SSL/TLS + ACME, backups scheduling, monitoring/alerts dashboards, billing, multi-node worker deployment, webhooks/notifications, durable event outbox.
