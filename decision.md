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

### D-008 — Code execution: own Docker sandbox behind an `Executor` interface · Revisit in Phase 2
- **Context:** Running untrusted code is the biggest security and operational risk. Docker on this machine uses **cgroup v2**.
- **Decision:** Build a judge worker that runs each submission in a throwaway container (`--network none --read-only --memory --cpus --pids-limit`, non-root, wall-clock timeout), fed by a BullMQ queue. Hide it behind an `Executor` interface so the backend can be swapped.
- **Alternatives:**
  - *Judge0 (self-hosted):* feature-rich, but its `isolate` sandbox expects cgroup v1 and is painful on Docker Desktop/cgroup v2 hosts. Still a candidate for a dedicated Linux judge host.
  - *Hosted APIs (Judge0 RapidAPI, Piston public):* per-call cost, rate limits, added latency, and user code sent to a third party.
  - *In-process VMs (vm2, isolated-vm):* JS only and historically escapable.
- **Consequences:** The worker needs Docker access, which is effectively root. It **must not** run on API nodes in production. Use dedicated judge hosts, ideally with the gVisor `runsc` runtime. Phase 2 starts with a spike to measure container cold-start latency (target < 1.5 s p95 for Python).

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
