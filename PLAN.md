# theGrave — Execution Plan

Real-time 1v1 coding battles: JWT auth → matchmaking → timed DSA round → judged result → Glicko-2 rating → leaderboard.

Each phase ends in something runnable and tested. Don't start a phase until the previous one's **exit criteria** pass.
Every non-trivial choice made along the way gets an entry in [`decision.md`](./decision.md).

---

## Architecture (target)

```
 Browser (React SPA, Monaco)
   │  HTTPS (REST)          WSS (Socket.IO)
   ▼                        ▼
 ┌─────────────── API / Realtime nodes (Fastify + Socket.IO), N replicas ───────────────┐
 │ auth · problems · matches · leaderboard  │  matchmaking · battle rooms · timers      │
 └───────┬───────────────────────┬───────────┴──────────────┬────────────────────────────┘
         │                       │                          │ enqueue submission
    PostgreSQL              Redis (pub/sub adapter,      BullMQ queue
  (source of truth)          queue ZSET, leaderboard,        │
                              rate limits, locks)            ▼
                                                   Judge workers (isolated hosts)
                                                   docker run --network none ... per test batch
```

- **Postgres** is the source of truth (users, problems, matches, submissions, rating history).
- **Redis** holds fast, rebuildable state: matchmaking queue, live leaderboard, presence, locks, Socket.IO fan-out.
- **Judge workers** are a separate process (and in prod, separate machines) because they run untrusted code.

---

## Phase 0 — Foundation ✅ (done 2026-11-18)

- pnpm monorepo: `apps/server`, `apps/web`, `packages/shared`
- Postgres 17 + Redis 8 via `docker compose`
- Fastify server with helmet/CORS/cookies/Redis-backed rate limit, zod-validated env, `/health` checking both stores
- Prisma 7 schema + first migration (`User`, `RefreshToken`)
- React 19 + Vite 8 + Tailwind 4 shell, dev proxy to API
- ESLint + Prettier + strict TS across the workspace

**Exit:** `pnpm typecheck && pnpm lint` green, `/health` → `{"status":"ok"}`. ✔

---

## Phase 1 — Authentication ✅ (done 2026-11-18)

- `POST /auth/register`, `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `GET /me`
- argon2id password hashing; generic "invalid credentials" errors (no user enumeration)
- Access JWT (HS256, 15 min) returned in body → kept **in memory** on the client
- Refresh token: opaque random 256-bit, stored as SHA-256 hash, set as `httpOnly; Secure; SameSite=Strict` cookie, **rotated on every use**; reuse of a revoked token revokes the whole family
- `authenticate` Fastify hook; strict rate limits on auth routes (e.g. 5/min/IP on login)
- Frontend: login/register pages, auth store, silent refresh on boot + on 401, protected routes

**Exit:** integration tests (Vitest + real Postgres) for register/login/refresh rotation/reuse detection/logout. ✔ (15 tests, `pnpm test`)

_Note: all client routes are served under `/api` (D-017), e.g. `POST /api/auth/login`._

---

## Phase 2 — Problems & Code Execution (highest risk — start with a spike)

- Models: `Problem` (slug, title, difficulty, statement markdown, time/memory limits, starter code per language), `TestCase` (input, expected, `isSample`)
- Seed ~30 problems across Easy/Medium/Hard with hidden tests
- **Executor interface** (`run(lang, code, tests, limits) → verdicts`) with a Docker implementation:
  - one container per submission, `--network none --read-only --tmpfs /tmp --memory 256m --cpus 1 --pids-limit 64`, non-root user, wall-clock kill
  - language images: Python 3, Node, C++ (g++), Java — start with Python + C++
  - stdout comparison with whitespace normalisation
- BullMQ `submissions` queue; separate `worker` entrypoint; concurrency limit per host
- Verdicts: `ACCEPTED | WRONG_ANSWER | TLE | MLE | RUNTIME_ERROR | COMPILE_ERROR`
- "Run" (sample tests only) vs "Submit" (all hidden tests)

**Exit:** fuzz/abuse tests: fork bomb, infinite loop, memory hog, network access, writing to FS — all contained and reported correctly.

---

## Phase 3 — Realtime & Matchmaking

- Socket.IO with `@socket.io/redis-adapter`; handshake authenticates the access JWT
- Queue = Redis ZSET scored by rating; per-user queue metadata (joinedAt)
- Matchmaker tick (every ~1s) holding a Redis lock (`SET NX PX`) so only one node matches at a time
- Rating window widens with wait time: ±50, +25 every 5 s, capped at ±400
- Pairing + removal from queue in a single Lua script (atomic; no double matches)
- Match accept/ready check (10 s) → decline/timeout returns the other player to the queue
- Guard: a user can be in at most one queue/match (Redis key `user:{id}:state`)

**Exit:** test with 200 simulated clients — no double matches, no orphaned queue entries, fair rating spread.

---

## Phase 4 — Battle Round

- `Match` model + state machine: `PENDING → ACTIVE → FINISHED | ABORTED`
- Problem pick: difficulty from the players' average rating, excluding problems either player has already seen
- **Server-authoritative timer:** `startsAt/endsAt` persisted; expiry handled by a BullMQ delayed job (survives restarts). Clients only render a countdown corrected by server clock offset.
- Submissions are tied to the match; opponent sees **progress only** (attempts, tests passed), never code
- Win rules: first full ACCEPTED wins → else at time-out, most hidden tests passed → tiebreak earlier best submission → else draw
- Disconnects: 30 s reconnect grace with state resync; then forfeit
- Per-user submission rate limit in a match (e.g. 1 per 5 s)

**Exit:** E2E (Playwright, two browser contexts) for win, time-out, draw, disconnect-forfeit.

---

## Phase 5 — Rating & Leaderboard

- Glicko-2 update in one DB transaction when a match finishes; idempotent per match id
- `RatingHistory` rows (before/after, delta, matchId)
- Leaderboard: Redis ZSET updated on rating change, rebuilt from Postgres on boot; paginated + "my rank"
- Rating deviation decay for inactive players (periodic job)
- Profile page: rating graph, match history, W/L/D

**Exit:** unit tests against the Glicko-2 paper's worked example; leaderboard consistent with DB after a rebuild.

---

## Phase 6 — Frontend Polish

Lobby (queue, live player count), battle screen (statement | Monaco | test results, timer, opponent progress), result modal with rating delta, leaderboard, profile. Reconnection UX, loading/error states, responsive layout.

---

## Phase 7 — Production Hardening & Deployment

- Multi-stage Dockerfiles (api, worker, web/nginx); prod compose or k8s manifests
- Reverse proxy (Caddy/nginx) — single origin, TLS, WebSocket upgrade, sticky sessions not required (Redis adapter + websocket transport)
- Judge workers on dedicated hosts, ideally with gVisor (`runsc`) runtime
- GitHub Actions: lint, typecheck, unit + integration tests (service containers), build images
- Observability: structured pino logs, `/metrics` (Prometheus), request ids, error tracking
- Security pass: input size limits, CSP, secrets via env/secret manager, dependency audit
- Load test (k6): concurrent sockets, matchmaking throughput, judge queue latency
- Backups for Postgres; Redis AOF

---

## Risks

| Risk | Mitigation |
|---|---|
| Sandbox escape from user code | Isolated judge hosts, no network, non-root, resource caps, gVisor in prod, no Docker socket on API nodes |
| Judge latency under load | Queue with backpressure, horizontal workers, sample-only "Run" |
| Timer drift / disputes | Server is the only authority on time and verdicts |
| Double matching across nodes | Redis lock + atomic Lua pairing |
| Cheating (copying solutions) | Out of scope for v1; log submissions for later similarity checks |
