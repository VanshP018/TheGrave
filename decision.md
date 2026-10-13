# Decision Log

Record of what was done and **why**. Newest work-log entries at the bottom of each section.
Format for decisions: **Context → Decision → Alternatives considered → Consequences.**
Status values: `Accepted`, `Superseded by D-xxx`, `Revisit in Phase N`.

---

## Work Log

### 2026-11-18 — Phase 0: Foundation

- Checked the machine: Node 24.14, pnpm 10.34, Docker 29.9 (cgroup v2), Homebrew Postgres 18 client. No Redis or Go, and none needed (Redis runs in Docker).
- Ran `git init` with a pnpm workspace: `apps/server`, `apps/web`, `packages/shared`.
- `docker-compose.yml`: Postgres 17 and Redis 8 with healthchecks and named volumes. Host ports are **5442 / 6389** (see D-013).
- Server: Fastify 5 with helmet, CORS (credentials), cookies, Redis-backed rate limiting, a zod-validated env (`src/config.ts`), a Prisma client using the `pg` driver adapter, ioredis, graceful shutdown, and `/health`.
- Prisma 7.10.1 schema with `User` (including Glicko-2 fields) and `RefreshToken` (hash + family). Migration `init` applied.
- Web: React 19 + Vite 8 + Tailwind 4. Dev proxy for `/api` and `/socket.io`. Installed react-router, TanStack Query, Zustand, socket.io-client and Monaco.
- Shared package: zod auth schemas and a typed Socket.IO event contract.
- Root ESLint (flat config, typescript-eslint) and Prettier.
- Removed unrequested files that `prisma init` generated (see D-016).
- **Verified:** `pnpm typecheck` and `pnpm lint` are green, `pnpm --filter @thegrave/web build` succeeds, and `GET /health` returns `{"status":"ok","postgres":true,"redis":true}`.

### 2026-11-18 — Phase 1: Authentication

- Shared: `PublicUser`, `AuthResponse` and `ApiError` types. Email is trimmed and lower-cased in the zod schema before validation, so `ALICE@x.io` and `alice@x.io` are the same account.
- Server `src/lib/tokens.ts`: HS256 access JWT (`sub`, `username`, `iss=thegrave`; verification pins the algorithm and issuer), plus an opaque 256-bit refresh token stored as HMAC-SHA256 (D-018).
- Server `src/modules/auth`: `POST /api/auth/register|login|refresh|logout` and `GET /api/me`. Passwords use argon2id. Unknown emails are verified against a dummy hash, so login timing doesn't reveal which accounts exist. Every error is the generic "Invalid email or password".
- Refresh rotation is a conditional `updateMany … WHERE revokedAt IS NULL` inside a transaction. Two concurrent refreshes can't both win; the loser is treated as reuse (D-019). Presenting a revoked token revokes the whole family. Other login sessions of the same user are unaffected.
- `authenticate` Fastify plugin (`onRequest: app.authenticate`) sets `req.auth`. `verifyAccessToken` is exported for the Socket.IO handshake in Phase 3.
- Global error handler: `ZodError` → 400 with field `issues`, `AuthError` → 401/409, 5xx bodies are masked and logged.
- Rate limits (Redis-backed, per IP): register 5/min, login 5/min, refresh 30/min, everything else 200/min.
- All client routes moved under `/api`, and the Vite proxy rewrite was removed (D-017).
- Web: in-memory Zustand auth store, an `api()` fetch wrapper (401 → refresh once → retry), silent refresh on boot serialised across tabs with the Web Locks API (D-020), login/register pages with field errors, `ProtectedRoute`/`GuestRoute`, and a home page that calls `/api/me`.
- Tests: Vitest integration suite (`apps/server/test/auth.test.ts`, 15 tests) against real Postgres (`thegrave_test` DB, created and migrated by `globalSetup`) and Redis DB 1 (D-021). It covers register, duplicates/validation, login and generic errors, the login rate limit, rotation, reuse detection and family revocation, session isolation, expired/unknown tokens, the concurrent-refresh race, logout, and forged/`alg=none`/expired JWTs.
- **Verified:** `pnpm test` (15/15), `pnpm typecheck`, `pnpm lint` and the web build are green. Ran a manual curl pass through the Vite proxy (register → cookie `Path=/api/auth` → refresh → `/me` → logout → refresh returns 401). The UI has not been clicked through in a real browser yet.

### 2026-11-18 — Phase 2: Problems & Code Execution

- **Spike first, as planned.** Built one judge image (`apps/server/judge/`: Alpine 3.22, Python 3.12, g++ 14.2, `runner.py`) and timed whole-container runs with every sandbox flag on. Each run was 3 tests and 12 runs per language:

  | Language                                    | p50    | p95    |
  | ------------------------------------------- | ------ | ------ |
  | Python                                      | 359 ms | 672 ms |
  | C++ (`<iostream>`)                          | 452 ms | 549 ms |
  | C++ (`<bits/stdc++.h>`, precompiled header) | 409 ms | 2.7 s  |

  The `<bits/stdc++.h>` p95 is a single cold-start outlier. Python beats the < 1.5 s p95 target, so D-008 moves to Accepted.

- Prisma: new `Problem`, `TestCase` and `Submission` models, plus enums `Difficulty`, `Language`, `Verdict`, `SubmissionKind` (RUN/SUBMIT) and `SubmissionStatus` (QUEUED/RUNNING/DONE/FAILED). Migration `problems_and_submissions`.
- Shared: `LANGUAGES`, `VERDICTS`, `codeSubmissionSchema` (code limited to 64 KB), and the `ProblemDetail`/`SubmissionView`/`TestResultView` contracts.
- `Executor` interface (`src/judge/executor.ts`) and `DockerExecutor`. Containers run with `--network none --read-only --tmpfs /tmp:size=64m --memory <limit+64m> --memory-swap = memory --cpus 1 --pids-limit 64 --user 65534 --cap-drop ALL --no-new-privileges --ulimit nofile=64`. `JUDGE_RUNTIME` is optional, e.g. `runsc`. A host-side deadline runs `docker kill`.
- The runner is PID 1. Each test runs under a wall-clock limit, `RLIMIT_CPU` as a backstop and `RLIMIT_FSIZE` for output. The OOM count from cgroup v2 `memory.events` detects MLE. After every test the runner kills and reaps every other process, which catches forks that escaped their process group with `setsid`.
- Output comparison ignores trailing whitespace per line, CRLF and trailing blank lines, and nothing else.
- Queue and worker: a BullMQ `submissions` queue with `jobId = submissionId` (idempotent) and 3 attempts with exponential backoff. `src/worker.ts` is a separate entrypoint with concurrency `JUDGE_CONCURRENCY` (default 2). Once retries are exhausted the submission becomes `FAILED`.
- API, all signed-in only:
  - `GET /api/problems`
  - `GET /api/problems/:slug` (samples only, per-language time limits, starter code)
  - `POST /api/problems/:slug/run` (samples) and `POST /api/problems/:slug/submit` (all tests): both return 202 and the submission id
  - `GET /api/submissions/:id`: owner only, 404 for anyone else

  Run/submit are rate limited to 10/min **per user**. The API returns 503 + `Retry-After` when the waiting queue reaches `JUDGE_QUEUE_MAX`.

- Seed: 30 problems (10 Easy, 12 Medium, 8 Hard) and 223 test cases, generated deterministically (D-031). `pnpm --filter @thegrave/server db:seed` is idempotent.
- Scripts: `dev` runs `dev:api` and `dev:worker` together. Added `judge:build`, `db:seed` and `start:worker`. Test `globalSetup` builds the judge image.
- Bugs found along the way:
  - Two of my own test cases were wrong. `1e9 + 1e9` doesn't overflow a 32-bit int, and a DNS lookup with no network ends in TLE because musl retries; it is still contained.
  - Prisma 7's `migrate dev` no longer regenerates the client, so `db:generate` must run after migrations.
  - My first Python reference for balanced brackets was O(n²) and would have hit TLE on the 50k-deep hidden test.
- **Verified:** `pnpm test` passes 73/73: 15 auth, 16 executor/abuse, 32 problem set, 10 judge API.
  - Abuse tests (the exit criterion): fork bomb, detached forks, infinite loop (Python and C++), sleeping, memory hogs (Python list, bytearray, C++ vector), TCP and DNS network access, writes to `/`, `/etc`, the runner and `/usr/bin`, filling `/tmp`, uid and capabilities, `kill -9` on PID 1, output flood, and reading expected outputs. Every one is contained and gets the right verdict, and later tests and containers still work.
  - All 30 independent Python references are ACCEPTED, with a max of 565 ms against the 3 s Python limit.
  - Ran `pnpm dev` and submitted a real C++ solution over HTTP: `ACCEPTED 9/9`. No judge containers were left behind. Typecheck and lint are green.
- Not done in this phase: a frontend for practice or the editor (Monaco UI is Phase 6), and pushing results over sockets (Phase 3/4; for now the client polls).

### 2026-11-18 — Phase 3: Realtime & Matchmaking

- **Approach:** every matchmaking state change is a Redis Lua script, so correctness comes from atomicity, not from timing or locks (D-034). Leases on queue entries make orphans impossible even when a node crashes (D-035).
- Shared socket contract (`packages/shared/src/socket-events.ts`):
  - client → server: `queue:join`, `queue:leave`, `match:accept`, `match:decline`, all **acked** with `{ok} | {ok:false, code, message}`
  - server → client: `queue:joined`, `queue:left`, `queue:stats`, `match:found`, `match:accepted`, `match:confirmed`, `match:cancelled`
  - `userRoom(id)` helper
- Server `src/matchmaking/scripts.ts` has 7 Lua scripts: join, leave, tick, accept, decline, release, describe. They share one prelude and one key layout and take time from Redis `TIME`. They are called with EVALSHA, falling back to EVAL on NOSCRIPT.
- Server `src/matchmaking/matchmaker.ts`: the `Matchmaker` class, independent of Socket.IO. It talks to a `Notifier`, which makes it testable with a fake.
  - The rating comes from Postgres on join, never from the client.
  - The tick runs on whichever node wins `SET mm:tick-lock NX PX`.
  - Lease renewal is one `ZADD XX` per node.
  - Has an `onConfirmed` hook.
  - `stop()` waits for in-flight work.
- Server `src/realtime/index.ts`:
  - Socket.IO, WebSocket transport only, with `@socket.io/redis-adapter` (duplicated ioredis pub/sub clients).
  - JWT handshake middleware (`auth.token`); every socket joins `user:{id}`.
  - Per-socket rate limit: 30 events per 10 s.
  - The current state is resent on (re)connect, so a page reload mid-ready-check still shows it.
  - Dequeue on disconnect only if the user has no socket left on any node.
  - A node that is shutting down gracefully doesn't dequeue anyone, so clients keep their place when they reconnect to another node.
- Web:
  - `lib/socket.ts`: the `auth` callback always sends the current in-memory token, and `unauthorized` triggers a refresh and reconnect.
  - `stores/lobby.ts`, plus a minimal `Lobby` on the home page: find match/cancel with a wait timer, live queue size, and a ready-check panel with countdown and accept/decline. A polished lobby is Phase 6.
- **Bug found by the stress test:** a teardown "Connection is closed" unhandled rejection showed up in about 1 of 3 runs. A tick that started just before `stop()` ran against Redis after it was quit, and production's `index.ts` shutdown has the same close-then-quit order. `Matchmaker.stop()` now waits for in-flight ticks and renewals, and `preClose` waits for it. Six reruns were clean.
- **Verified:** `pnpm test` passes 89/89, adding 14 matchmaker behaviour tests and 2 stress tests.
  - Behaviour tests: join, concurrent duplicate joins, closest/oldest-first pairing, window steps 50→75→100, the ±400 cap, 10 concurrent ticks over 100 players, confirm, busy guard, release, outsider accept, decline-requeue with the original `joinedAt`, timeout requeue/drop, late accept rejected, resync, lease purge, lease renewal, and renew not enqueueing anyone.
  - **Exit criterion:** 200 real Socket.IO clients across **2 API nodes**. 5% decliners, 5% AFK, every player double-clicks join, and 10% have a second tab on the other node. There were no double matches: each ready check has exactly 2 symmetric participants, no player had overlapping checks, and no player was confirmed twice. After disconnect, `mm:queue`, `mm:joined`, `mm:lease`, `mm:ready:*` and `user:*:state` are all empty, so nothing was orphaned. Rating spread was fair: 89–90 matches, mean difference 10–15, p90 26–43, max 78–152, under the ±400 cap. Stable across 7 runs, about 8 s each.
  - Two clients through the **Vite dev proxy** with production defaults got matched on the first 1 s tick and confirmed.
  - Typecheck, lint and the web build are green. The lobby UI has not been clicked through in a real browser.

---

## Decisions

### D-001 — pnpm workspaces monorepo · Accepted

- **Context:** The server and client share types (API payloads, socket events, validation).
- **Decision:** One repo using pnpm workspaces, with `packages/shared` consumed as `workspace:*`.
- **Alternatives:** Separate repos would mean duplicated types and drift. Turborepo/Nx add caching, but nothing needs it at three packages. Add Turborepo if builds get slow.
- **Consequences:** `shared` must be built (`tsc`) before the server or web typecheck, and its dev script runs `tsc --watch`.

### D-002 — TypeScript everywhere, pinned to 6.0.x · Accepted

- **Context:** npm `latest` for TypeScript is 7.0.2, the native Go compiler. `typescript-eslint` 8.73 declares `typescript >=4.8.4 <6.1.0`.
- **Decision:** Pin `typescript@~6.0.3` in every package, including web, whose Vite template defaulted to 7. Use strict mode plus `noUncheckedIndexedAccess`.
- **Consequences:** Move to TS 7 once typescript-eslint supports it. That should be a free speed-up.

### D-003 — Fastify 5 for the HTTP API · Accepted

- **Context:** The API needs to be fast, typed and production-grade, with a plugin system for auth, rate limiting and so on.
- **Decision:** Fastify 5.
- **Alternatives:** Express is slower, and its async error handling and typings are weaker. NestJS brings heavy DI/decorator ceremony that this team size doesn't need. Hono is great, but its Node/WebSocket ecosystem is thinner.
- **Consequences:** Built-in pino logging, a schema-friendly design, and first-party plugins (cookie, cors, helmet, rate-limit).

### D-004 — Socket.IO (+ Redis adapter) for realtime · Accepted

- **Context:** Battles need rooms, reconnection, acks and fan-out across several server replicas.
- **Decision:** Socket.IO 4 with `@socket.io/redis-adapter`.
- **Alternatives:** Raw `ws`/uWebSockets is faster, but rooms, reconnection, acks and multi-node broadcast would all be hand-built. SSE is one-way only.
- **Consequences:** Clients must use the Socket.IO client. Force the `websocket` transport in prod so no sticky sessions are needed.

### D-005 — PostgreSQL 17 + Prisma 7.10.1 (pg driver adapter) · Accepted

- **Context:** Data is relational (users ↔ matches ↔ submissions ↔ rating history), and rating updates need transactions.
- **Decision:** Postgres 17 and Prisma 7. Prisma is **pinned to 7.10.1** because npm `latest` currently points to `8.0.0-rc.34`, a release candidate. Prisma 7 needs a driver adapter, so it uses `@prisma/adapter-pg`. The client is generated into `apps/server/src/generated/prisma` (gitignored).
- **Alternatives:** Drizzle is lighter and closer to SQL, but Prisma's migrations and DX are more mature. MongoDB is a poor fit for relational data that needs transactional rating updates.
- **Consequences:** Run `pnpm db:generate` after schema changes and in CI. Write raw SQL where Prisma is weak, such as leaderboard window queries.

### D-006 — Redis 8 for ephemeral/fast state · Accepted

- **Decision:** One Redis serves the matchmaking queue (ZSET by rating), live leaderboard (ZSET), rate-limit counters, distributed locks, Socket.IO pub/sub and BullMQ.
- **Why:** Sorted sets map directly to "find players near rating X" and "top N by rating". Lua scripts give atomic pairing.
- **Consequences:** Everything in Redis must be **rebuildable from Postgres** (the leaderboard is rebuilt on boot). AOF is enabled. Split Redis instances by role later if load requires.

### D-007 — Auth: short-lived access JWT + rotating refresh cookie · Accepted

- **Context:** The requirement is JWT auth, and it must also authenticate WebSocket handshakes.
- **Decision:**
  - Access token: HS256 JWT, **15 min**, returned in the response body and held **in memory** on the client (not localStorage, so XSS can't read it from storage). It is sent as `Authorization: Bearer` and in the Socket.IO `auth` payload.
  - Refresh token: opaque 256-bit random value, stored as **SHA-256 hash**, in an `httpOnly; Secure; SameSite=Strict` cookie, valid 7 days, **rotated on every refresh**. Tokens share a `familyId`, and presenting a revoked token revokes the whole family (stolen-token detection).
  - Passwords: **argon2id** (verified the native build on this machine).
- **Alternatives:** Long-lived JWTs alone can't be revoked. Server sessions only would be simpler, but the user specifically asked for JWT. A JWT refresh token gains nothing over an opaque one and leaks claims.
- **Consequences:** Logout and revocation take effect within 15 minutes for access tokens. Use separate secrets for access and refresh. Move to RS256/EdDSA if other services need to verify tokens.

### D-008 — Code execution: own Docker sandbox behind an `Executor` interface · Accepted (spike passed in Phase 2)

- **Context:** Running untrusted code is the biggest security and operational risk. Docker on this machine uses **cgroup v2**.
- **Decision:** Build a judge worker that runs each submission in a throwaway container (`--network none --read-only --memory --cpus --pids-limit`, non-root, wall-clock timeout), fed by a BullMQ queue. Hide it behind an `Executor` interface so the backend can be swapped.
- **Alternatives:**
  - _Judge0 (self-hosted):_ feature-rich, but its `isolate` sandbox expects cgroup v1 and is painful on Docker Desktop/cgroup v2 hosts. Still a candidate for a dedicated Linux judge host.
  - _Hosted APIs (Judge0 RapidAPI, Piston public):_ per-call cost, rate limits, added latency, and user code sent to a third party.
  - _In-process VMs (vm2, isolated-vm):_ JS only and historically escapable.
- **Consequences:** The worker needs Docker access, which is effectively root. It **must not** run on API nodes in production. Use dedicated judge hosts, ideally with the gVisor `runsc` runtime. Phase 2 starts with a spike to measure container cold-start latency (target < 1.5 s p95 for Python). **Result:** Python p95 was 672 ms for a whole 3-test container run (see the Phase 2 work log).

### D-009 — Server is authoritative for time and verdicts · Accepted

- **Decision:** Match `startsAt/endsAt` live in the DB. Expiry fires from a BullMQ delayed job, not an in-memory `setTimeout`, so it survives restarts and works across replicas. Clients only display a countdown corrected by server time offset. Only the judge decides verdicts.
- **Why:** This prevents client clock manipulation and keeps outcomes consistent when a node dies mid-match.

### D-010 — Glicko-2 rating instead of Elo · Accepted

- **Context:** A rating system for 1v1 results.
- **Decision:** Glicko-2 (rating 1500, RD 350, volatility 0.06 at start). The fields are already on `User`.
- **Why:** Glicko-2 tracks uncertainty (RD). New players move fast and veterans stay stable, and inactive players' RD grows. Elo uses one K-factor for everyone, which is unfair to newcomers and slow to converge.
- **Consequences:** The math is more complex, so it will get unit tests against Glickman's worked example. Matchmaking can use RD to widen windows for uncertain players.

### D-011 — Frontend: React 19 + Vite SPA · Accepted

- **Decision:** React 19, Vite 8, Tailwind 4, Monaco (`@monaco-editor/react`), TanStack Query (server state), Zustand (client and realtime state), react-router.
- **Alternatives:** Next.js offers SSR and SEO, but the app is almost entirely authenticated and realtime, so SSR adds complexity (server components vs. sockets, an extra runtime) for little gain.
- **Consequences:** Static build served by nginx/CDN. A public leaderboard SEO page could be added later if wanted.

### D-012 — Same-origin deployment (proxy) · Accepted

- **Decision:** In dev, the Vite proxy forwards `/api` and `/socket.io` to `:4000`. In prod, a reverse proxy serves the web and API under one origin.
- **Why:** It lets the refresh cookie use `SameSite=Strict`, which largely neutralises CSRF on `/auth/refresh`, and it avoids CORS preflights.

### D-013 — Non-default local ports (5442 / 6389) · Accepted

- **Context:** Other projects' containers on this machine (`debate_redis` on 6379, others on 5434/5435/6380) already use the default ports.
- **Decision:** Map this project's Postgres to host port **5442** and Redis to **6389**, with compose project name `thegrave`. The existing containers were not touched.

### D-014 — zod for all validation, shared between client and server · Accepted

- **Why:** One schema provides runtime validation on the server, form validation on the client, and inferred TS types. Env vars are also validated with zod at boot, so the server fails fast on bad config.

### D-015 — UUIDv7 primary keys · Accepted

- **Why:** IDs are not enumerable like auto-increment, and unlike UUIDv4 they are time-ordered, so B-tree indexes stay compact and IDs sort by creation.

### D-016 — Removed AI-editor skill files injected by `prisma init` · Accepted

- **Context:** Prisma 7's `init` wrote `.agents/`, `.claude/`, `.windsurf/` skill folders and `skills-lock.json` into `apps/server`.
- **Decision:** Deleted them, along with the generated `apps/server/.gitignore` (the root `.gitignore` covers it).
- **Why:** Nobody requested them, they are third-party instructions for AI tools, and they clutter the repo.

### D-017 — API routes live under `/api` on the server (no proxy rewrite) · Accepted

- **Context:** The Vite proxy stripped `/api` before forwarding. A refresh cookie scoped with `Path=/auth` by the server would then never be sent by the browser, which requests `/api/auth/refresh`.
- **Decision:** The server registers client-facing routes with `prefix: '/api'`, and the proxies forward paths unchanged. `/health` stays at the root for infrastructure probes.
- **Alternatives:** Cookie `Path=/` would leak the refresh token onto every request. A configurable cookie path per environment invites mismatches.
- **Consequences:** Dev and prod see identical paths. The prod reverse proxy must forward `/api/*` as-is (Phase 7).

### D-018 — Refresh tokens hashed with HMAC-SHA256 (keyed by `JWT_REFRESH_SECRET`) · Accepted

- **Context:** The plan says "SHA-256 hash". The token is 256 bits of randomness, so a plain hash is already safe from brute force. `JWT_REFRESH_SECRET` existed in the config but had no use, because refresh tokens are opaque rather than JWTs.
- **Decision:** Store `HMAC-SHA256(secret, token)`.
- **Why:** It costs nothing and gives defence in depth: a DB dump alone can't confirm a candidate token without the secret. It also gives the existing secret a real purpose.
- **Consequences:** Rotating `JWT_REFRESH_SECRET` invalidates every refresh token, which forces everyone to log in again. That is acceptable, and also a handy kill switch.

### D-019 — Strict rotation: a concurrent refresh with the same token counts as reuse · Accepted

- **Decision:** Rotation succeeds only if the conditional revoke updates exactly one row. If two requests race with the same token, one wins and the other revokes the family.
- **Alternatives:** A grace window that accepts the previous token for N seconds tolerates races, but it weakens theft detection and makes the server stateful about "recently rotated".
- **Consequences:** The client must never send overlapping refreshes, which is solved by D-020. A tested invariant: after a race, at most one live token remains.

### D-020 — Client serialises refreshes with in-tab dedupe + Web Locks · Accepted

- **Context:** The access token is in memory, so every tab silently refreshes on load. Two tabs opening at once would present the same cookie and, under D-019, log the user out.
- **Decision:** `refreshSession()` dedupes calls within a tab (one shared promise) and wraps the request in `navigator.locks.request('thegrave-refresh')`. A waiting tab sends the cookie the first tab just rotated, so both tabs end up authenticated.
- **Alternatives:** `BroadcastChannel` to share the access token across tabs is more code and doesn't stop the race on its own. Storing the token in localStorage contradicts D-007.
- **Consequences:** Web Locks needs a secure context (HTTPS, or `localhost` in dev). It is supported in all evergreen browsers.

### D-021 — Integration tests use a dedicated database and Redis DB · Accepted

- **Decision:** Vitest `globalSetup` creates `thegrave_test` if it's missing and runs `prisma migrate deploy`. Tests use Redis DB index 1. Each test truncates the tables and runs `FLUSHDB`, which also resets rate-limit counters. Test files run serially (`fileParallelism: false`).
- **Why:** These are real-database tests, as the plan requires, and they can't clobber dev data. CI can reuse the setup with service containers (Phase 7).
- **Consequences:** Tests need `pnpm infra:up` first. If suites slow down later, move to a schema per worker.

### D-022 — Refresh cookie `Secure` everywhere except `NODE_ENV=development` · Accepted

- **Context:** Chrome and Firefox treat `http://localhost` as secure, but Safari has historically dropped `Secure` cookies on plain-HTTP localhost.
- **Decision:** `secure: NODE_ENV !== 'development'`. Test and production always set `Secure`, and a test asserts it.
- **Consequences:** Dev is the only environment without `Secure`. It still has `httpOnly` + `SameSite=Strict` + `Path=/api/auth`.

### D-023 — One judge image for all languages, with a Python runner as PID 1 · Accepted

- **Context:** The plan suggested one image per language. Every image needs the same runner logic: limits, verdict classification and process cleanup.
- **Decision:** One image, `thegrave-judge` (Alpine + Python 3 + g++). `runner.py` is the entrypoint and therefore PID 1. A precompiled `<bits/stdc++.h>` uses the judge's exact flags (`-std=c++17 -O2 -pipe`).
- **Why:** There is one runner implementation to harden. As PID 1, orphaned and `setsid`-escaped processes are reparented to the runner, so it can kill and reap all of them between tests. The kernel also ignores `kill -9 1` from inside the namespace, which a test confirms.
- **Alternatives:** Per-language images (smaller each, but the runner is duplicated, or C++ images also need Python). A C runner (faster startup, much more code). `isolate` (cgroup v1, see D-008).
- **Consequences:** The image is 527 MB. Adding Java means a bigger image or a split by language. Revisit at that point.

### D-024 — Code and inputs go to the container as JSON on stdin; expected outputs never do · Accepted

- **Decision:** `docker run -i`, with no bind mounts. The runner writes the code to `/tmp/work`, streams one JSON line per test (status, time, stdout, stderr) and the **host** compares the output.
- **Why:** User code can read anything inside its container, so expected outputs must never be there, and a test confirms this. Skipping bind mounts also avoids host-path problems when the worker runs inside a container against a remote or socket-mounted daemon.
- **Consequences:** All hidden inputs are held in the runner's memory, a few MB per problem, which is charged to the sandbox overhead (D-028).

### D-025 — Drive Docker through the CLI (`child_process.spawn`), not dockerode · Accepted

- **Why:** There's no extra dependency, the flags match what you'd type when debugging, and stdin/stdout streaming is trivial. Every container is named `judge-<uuid>`, so the deadline can `docker kill` it.
- **Consequences:** The `docker` binary must be on the worker host. Spawning costs a few ms per submission, which is negligible next to container start.

### D-026 — Wall-clock time limits; Python gets 3× the base limit · Accepted

- **Decision:** `Problem.timeLimitMs` (default 1000 ms) is the C++ limit. Python gets ×3 through `effectiveTimeLimitMs`. The limit is wall clock, so `sleep` gets TLE. `RLIMIT_CPU` is a backstop. `GET /problems/:slug` shows the effective limit per language.
- **Why:** Python is 10–50× slower than C++ on tight loops, so a single limit would make Python unusable on Medium and Hard problems. Every Python reference fits within 565 ms of its 3 s limit, so ×3 leaves good headroom.
- **Consequences:** Matches between a C++ player and a Python player aren't perfectly fair on time-critical problems. That is accepted for v1.

### D-027 — Always run every test; the overall verdict is the first failing test's · Accepted

- **Decision:** The judge does not stop at the first failure. `testsPassed/testsTotal` are always exact, and the overall verdict is ACCEPTED or the verdict of the lowest-index failing test.
- **Why:** Phase 4's tiebreak is "most hidden tests passed", which needs exact partial counts.
- **Consequences:** The worst case is about `tests × timeLimit`, for example 9 × 3 s for a Python TLE. The host deadline caps it (startup + compile + tests × (limit + 0.5 s)), and every test that hasn't reported by then is marked TLE.

### D-028 — How MLE and output limits are detected · Accepted

- **MLE:** The runner reads the cgroup v2 `memory.events` `oom_kill` counter before and after each test. `MemoryError` and `std::bad_alloc` in stderr also count as MLE. Container memory is the problem limit + 64 MB (runner, inputs, tmpfs pages), and swap is off.
- **Output:** `RLIMIT_FSIZE` is set to 8 MB per test. Going over it gives `RUNTIME_ERROR` with "Output limit exceeded", and `/tmp` is a 64 MB tmpfs.
- **Consequences:** The memory limit is approximate. The program gets about the stated MB, with slack from the overhead. Per-test peak memory isn't reported yet: `memory.peak` reset needs a newer kernel API, so revisit then.

### D-029 — Problems are visible to signed-in users only · Revisit in Phase 4

- **Context:** Practice mode needs problem statements, but battles choose problems "either player hasn't seen". A public catalogue lets people pre-solve the whole set.
- **Decision for now:** All problem endpoints require auth. Hidden tests are never served.
- **Revisit:** In Phase 4, decide whether the battle pool is separate from practice or excluded once a user has viewed or submitted a problem.

### D-030 — Every RUN and SUBMIT is a persisted `Submission`; clients poll for now · Accepted (push in Phase 3/4)

- **Decision:** Both kinds go through the same queue and table, so there is one code path. `POST` returns 202 with the id, and the client polls `GET /api/submissions/:id`. RUN results include sample I/O (stdout clipped at 4 KB, stderr at 2 KB). SUBMIT results carry only `{index, verdict, timeMs}`.
- **Alternatives:** Having the API `await job.waitUntilFinished()` ties up HTTP connections for seconds and doesn't fit battles. Not persisting RUN loses useful history and adds a second path.
- **Consequences:** Once sockets exist (Phase 3), the worker publishes completion and the battle UI gets pushed updates. Polling stays as a fallback.

### D-031 — Test data is generated from a TS solver and cross-checked by an independent Python solution · Accepted

- **Decision:** Each problem in `src/seed/problems.ts` has samples, a seeded hidden-test generator (mulberry32 keyed by slug, so seeding is deterministic), a TypeScript `solve` that produces expected outputs, and a **separately written** Python reference. A test judges every Python reference against every generated test, under the real Python limit.
- **Why:** Hand-written expected outputs drift and are error-prone. Two independent solutions that agree on edge-case and max-size tests give high confidence that the data is right, and the same test proves the limits are achievable in the slower language. The implementations deliberately differ for several problems: Prim vs Kruskal, merge sort vs Fenwick tree, two Manacher formulations, and block decomposition vs deque.
- **Consequences:** Adding a problem means writing both solutions. Expected outputs are recomputed on each seed, so changing a generator changes the stored tests.

### D-032 — Judge reliability: retry infra errors only, per-user rate limits, queue backpressure · Accepted

- **Decision:**
  - Bad user code always produces a verdict, never an exception. Only `JudgeError`s and other infrastructure failures throw. They get 3 attempts with exponential backoff, then status `FAILED`, which the client shows as "judge error, try again" and not as a verdict.
  - Run/submit are limited to 10/min per user. The rate-limit `keyGenerator` verifies the bearer token itself, because the plugin's hook runs before route-level `authenticate`.
  - The API returns 503 once `JUDGE_QUEUE_MAX` jobs are waiting.
- **Consequences:** A dead judge fleet shows up as FAILED submissions plus 503s instead of an ever-growing queue.

### D-033 — `pnpm dev` starts the API and the judge worker · Accepted

- **Decision:** The server's `dev` script is `pnpm run "/^dev:/"`, which runs `dev:api` and `dev:worker` in parallel. The root `pnpm dev` therefore starts web, API and worker.
- **Consequences:** Local dev needs the judge image (`pnpm --filter @thegrave/server judge:build`, which the tests also run).

### D-034 — Matchmaking state changes only through Lua scripts; the tick lock is an optimisation · Accepted
- **Context:** The plan asks for a `SET NX PX` lock so only one node matches at a time, plus atomic pairing. A lock alone is not safe: it can expire mid-tick during a GC pause or a slow Redis call, and then two nodes match concurrently.
- **Decision:** Every transition (join, leave, the whole tick pass, accept, decline, release) is one Lua script, and each script checks `user:{id}:state` before acting. The whole tick (purge leases → expire ready checks → pair) is **one** script. The lock is still taken so that only one node does the work each interval, but correctness doesn't depend on it. A test fires 10 ticks concurrently over 100 players and gets exactly 50 pairs, with no player in two.
- **Time:** Scripts use Redis `TIME`, so waiting windows, leases and deadlines all come from one clock, whatever the skew between API nodes.
- **Consequences:** The tick is O(n log n) in queue size and blocks Redis while it runs. That's microseconds at hundreds of players, and `maxPairsPerTick` bounds it. Past roughly 10k concurrently queued players, shard the queue by rating band. Keys built inside scripts (`user:{id}:state`, `mm:ready:{id}`) assume one Redis, not Redis Cluster; Cluster would need hash tags.

### D-035 — Queue entries are leases renewed by the node holding the socket · Accepted
- **Context:** The exit criterion is "no orphaned queue entries". Disconnect handlers aren't enough, because a crashed or partitioned node never runs them, and its users would sit in the queue forever, matchable but unreachable.
- **Decision:**
  - `mm:lease` (ZSET, userId → expiry, 15 s) is set on join.
  - Every node renews leases every 5 s for all **locally connected** users with a single `ZADD mm:lease XX …`. `XX` makes this a no-op for users who aren't queued, so a node never needs to know who is queued.
  - The tick purges expired leases first and tells the user `queue:left {reason:'expired'}` if they are still connected anywhere.
  - Disconnect: dequeue right away only if `fetchSockets()` across the cluster finds no other socket for that user (multi-tab). If that lookup fails, do nothing and let the lease expire.
  - Graceful shutdown: skip the dequeue. Clients reconnect to another node within the lease, and the resync tells them they are still queued.
- **Consequences:** After a crash, orphans live for at most `leaseMs` plus one tick. A live socket renews at most N user ids every 5 s, which is cheap.

### D-036 — Pairing: longest-waiting first, closest rating inside the waiter's own window · Accepted
- **Decision:** Iterate `mm:joined` oldest-first. Each player's window is `min(50 + 25·⌊wait/5 s⌋, 400)`, as the plan specifies. Pick the closest rating inside it, breaking ties by longer wait. Look at most 3 neighbours on each side with `ZRANGEBYSCORE … LIMIT`.
- **Alternatives:**
  - *Mutual window* (both windows must contain the other) penalises long waiters, because a newcomer's ±50 blocks them.
  - *Global optimal matching* (minimum-weight perfect matching) is more complex and slower, and gains little at this scale.
  - *RD-aware windows* (D-010): left for later. Uncertain players could start with a wider window.
- **Measured** with 200 players uniform on 1000–2000: mean difference 10–15, p90 ≤ 43, max ≤ 152.
- **Consequences:** Window parameters are code constants (`DEFAULT_MATCHMAKER_OPTIONS`), not env vars. Tests pass shorter intervals.

### D-037 — Ready-check semantics · Accepted
- **Decision:**
  - A ready check lasts 10 s. The deadline lives in `mm:ready:deadlines`, and the tick expires it. Accepts after the deadline are refused even if the tick hasn't run yet.
  - Decline: the decliner goes back to idle, and the other player is **requeued with their original `joinedAt`**, so they keep their place and their widened window.
  - Timeout: players who accepted are requeued the same way. Players who didn't respond are dropped, so an AFK player can't keep pulling others into failed checks.
  - Confirm happens when both accept. `user:{id}:state = match:{id}`, with a 2 h safety-net TTL.
- **Not done (revisit if abused):** a cooldown for repeat decliners.

### D-038 — Ready-check ids come from a Redis counter; a confirmed match goes to an `onConfirmed` hook · Accepted (Phase 4 plugs in)
- **Decision:** Ready-check ids are `INCR mm:seq`, which can be generated inside the Lua script. Phase 4 creates the `Match` row, with its UUID, inside `onConfirmed`. Phase 3 has no battle yet, so the default hook calls `release()` straight away and players can queue again. `release()` is a compare-and-delete on `match:{id}`, which is also what Phase 4 calls when a battle ends.
- **Consequences:** Clients see ready-check ids in `match:found`. Phase 4 will send the real match id when the battle starts.

### D-039 — Socket protocol: handshake-only auth, acks, per-user rooms, resync on connect · Accepted
- **Auth:** The JWT is verified in the handshake middleware and is never put in the URL. The client's `auth` is a callback that sends the current in-memory token on every reconnect. An `unauthorized` connect error triggers one refresh, then a reconnect. A connection is **not** re-checked when its 15-min token expires: revocation applies at the next reconnect. Revisit if an admin "kick" is needed.
- **Acks** on every client event give the UI a definite result, e.g. `ALREADY_IN_MATCH` or `MATCH_NOT_FOUND`.
- **Rooms:** Events go to `user:{id}`, so all tabs on all nodes stay in sync. For example, joining in one tab shows "searching" in the others.
- **Resync:** On connect, the server resends `queue:joined` or `match:found` from the current Redis state. A reload or reconnect during a ready check keeps it alive.
- **Limits:** 30 events per 10 s per socket. HTTP rate limits don't apply to WebSocket frames.
- **Known gap:** The ready countdown uses the client clock against the server's `expiresAt`. Phase 4 adds the server clock offset (D-009).
