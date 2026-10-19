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

### 2026-11-18 — Phase 4: Battle Round

- **Approach:** every way a match can end goes through **one** conditional update (`finish()`, D-040). The win rules are a **pure function** of the submissions (D-041). Every timer is a BullMQ delayed job that re-checks state when it fires, so timers survive restarts and never need cancelling (D-043).
- Prisma:
  - `Match` (status `PENDING|ACTIVE|FINISHED|ABORTED`, `startsAt/endsAt`, `winnerId`, `endReason` `SOLVED|TIMEOUT|FORFEIT|ABANDONED`)
  - `MatchPlayer` (`ratingBefore` snapshot for Phase 5)
  - `SeenProblem`
  - `Submission.matchId`
  - Migration `battles`.
- Shared: `BattleView`, `PlayerProgress` (counts only, never code), `MatchResult`, `MySubmission`. New socket events: `battle:created|started|progress|finished`, `submission:judged`, plus `time:sync` and `matchRoom()`.
- Server `src/battle/`:
  - `outcome.ts`: the rules.
  - `problem-pick.ts`: difficulty from average rating, excluding seen problems.
  - `queue.ts`: the `battle` queue with jobs `start`, `end`, `judged`, `forfeit` and idempotent ids.
  - `service.ts`: `BattleService` with lifecycle, the finish gate, presence, submit, views and progress.
  - `worker.ts`: runs in every API node.
- Matchmaker: a new `rebind` script atomically moves `user:{id}:state` from the ready-check id to the Match UUID. `onConfirmed` now creates the battle.
- Judge: once a match submission is DONE or finally FAILED, it enqueues `judged` on the battle queue. It still knows nothing about battles or sockets.
- API (participants only, 404 otherwise):
  - `GET /api/matches/:id`: the full resync view. The problem stays hidden until `startsAt`.
  - `POST /api/matches/:id/submit`: accepted only while `startsAt ≤ now < endsAt` by the server clock, limited to 1 per 5 s per user with a Redis `SET NX PX`. Returns 429 with `Retry-After`/`retryAfterMs`.
  - Practice `GET /problems/:slug` and run/submit now record `SeenProblem`.
- Realtime:
  - Sockets join `match:{id}` when the match is created, or on reconnect.
  - On connect, a live battle resends `battle:created` and cancels the away state.
  - When the last socket disconnects, the player is marked away and a forfeit job is scheduled.
  - `time:sync` acks the server time.
- Web:
  - `RealtimeProvider`: one socket for the signed-in app, so it survives lobby → battle. It feeds the lobby store, patches the battle query from `battle:progress`, and refetches on started/finished/judged.
  - `lib/clock.ts`: NTP-style offset from 5 samples, keeping the one with the lowest round trip.
  - Lazy `BattlePage`:
    - countdown to the problem reveal, a timer corrected by the clock offset, statement and samples
    - **locally bundled Monaco**, the language picker, Run samples and Submit
    - your verdicts, both players' progress cards with an away countdown, and a result overlay
    - drafts kept per match and language in `sessionStorage`
  - The statement renderer builds React nodes (no `innerHTML`).
- E2E: `pnpm test:e2e` runs Playwright with an isolated backend (D-045).
- **Bugs found:**
  1. **The reload race** (found by the E2E): a player who reloaded mid-battle **forfeited**. The new socket's resync cleared the away key *before* the old socket's disconnect handler wrote it. The forfeit job, and `markAway` straight after writing, now check cluster-wide presence (`fetchSockets`) instead of trusting event order (D-044). A deterministic regression test forces the bad ordering; it fails without the fix and passes with it.
  2. A partially applied edit: the judge's final-FAILED handler had lost its battle hand-off after prettier reformatted it. ESLint's unused-import error caught it. Restored.
  3. E2E harness: Playwright's "Desktop Chrome" device has a Windows user agent, so Monaco's select-all is Ctrl+A even on a Mac host. With Cmd+A the editor wasn't cleared, and the starter code swallowed stdin.
  4. Two timing assumptions in my own integration tests: a 150 ms countdown elapsed before the "too early" submit, and disconnecting before a restart correctly triggered a forfeit.
- **Verified:**
  - `pnpm --filter @thegrave/server test` passes 114/114, adding 13 outcome-rule unit tests and 12 battle integration tests. The integration tests use the real Socket.IO, BullMQ, Postgres and judge-worker path with a scripted executor. They cover:
    - lifecycle: problem hidden while PENDING, SOLVED win, release and requeue, the opponent seeing progress but never code
    - access: non-participants get 404, the cooldown returns 429, and an earlier still-judging submission beats a later ACCEPTED
    - endings: time-out on tests passed, draw, submit refused after the end
    - disconnects: forfeit, reconnect cancelling the forfeit, the reload race, both gone → ABORTED
    - **the end timer surviving an API node restart**
    - seen-problem avoidance with the difficulty fallback
  - The battle tests passed 3 times in a row before the reload fix, and again in the full-suite runs after it.
  - **Exit criterion:** `pnpm test:e2e` passes 4/4 in two consecutive runs of about 1.3 min each, with two browser contexts through the real UI, Monaco, the Docker judge and Socket.IO via the Vite proxy:
    - **win**, including a mid-battle reload resync, and the loser sees 9/9 progress but no code
    - **time-out**: 1/9 beats 0/9
    - **draw**
    - **disconnect-forfeit**: the context closes, the opponent shows as away, and the other player wins after the grace period
  - Typecheck, lint and web build are green.
- **Observed flake:** `problems.test.ts` (30 Python references, 3 concurrent containers) failed 2 problems with TLE when run straight after the battle suite, with machine load average around 8.8 on 8 cores and another `pnpm dev` running. It passed 32/32 when rerun alone. CI should run it with low container concurrency (Phase 7).
- **Not done:** Glicko-2 rating (Phase 5 hooks into `finish()`), match history and profile (Phase 5), lobby and battle polish (Phase 6). The Monaco chunk is 2.7 MB (700 KB gzipped), lazy-loaded; Phase 7 can trim it. Vite's dev proxy logs harmless `EPIPE` errors when a WebSocket closes during a reload.

### 2026-11-18 — Phase 5: Rating & Leaderboard

- **Approach:**
  - Rating commits **in the same transaction** as Phase 4's finish gate, so a match can never be finished but unrated (D-048).
  - Inactivity decay uses the fact that Glicko-2's idle RD inflation is *additive in time*. A lazy calculation at match time and a periodic materialising job then agree exactly, whatever the cadence (D-049).
  - The leaderboard is derived state. It is rebuilt off to the side and swapped in with a version compare-and-swap, so a rebuild never shows an empty board and never overwrites a newer rating (D-050).
- `src/rating/glicko2.ts`: Glicko-2 as pure functions, following Glickman's paper step by step (Illinois algorithm for σ'), plus `inflateRd`. `rateWithTrace` exposes every intermediate value for the paper test.
- `policy.ts`: rating period of 1 day, leaderboard RD ≤ 200, provisional above 110, and `effectiveRd`.
- `apply.ts`: rating a match inside a transaction (`ratedAt` gate, `FOR UPDATE` row locks in id order, simultaneous update, `RatingHistory` rows).
- `leaderboard.ts`: Redis ZSET with competition ranks, page and rank lookups, CAS rebuild, and the decay SQL.
- `maintenance.ts`: a BullMQ job scheduler (`rd-decay`, hourly: decay then rebuild), plus a rebuild on boot.
- Prisma:
  - `User.rdUpdatedAt`, `User.ratedGames` (+ index)
  - `Match.ratedAt`
  - `RatingHistory` (before/after rating, RD and volatility, delta, outcome, opponent, `@@unique(matchId, userId)`)
  - enum `GameOutcome`
  - Migration `ratings`.
- `BattleService.finish()` is now one `$transaction`: status gate → `applyMatchRating` for FINISHED, so ABORTED stays unrated. After commit it updates the leaderboard incrementally and sends `battle:finished` with `ratingChanges`. `GET /matches/:id` includes them too.
- API, all signed-in only:
  - `GET /api/leaderboard?offset&limit` returns entries and `me`.
  - `GET /api/users/:username` returns the profile: rating, effective RD, provisional flag, rank, W/L/D, and a graph of up to 500 points.
  - `GET /api/users/:username/matches?cursor&limit` is keyset-paginated history.
- Web:
  - `AppShell` navigation (Play, Leaderboard, Profile).
  - `LeaderboardPage`: paged, with your rank and your row highlighted.
  - `ProfilePage`: stat tiles, rating chart, match history with "Load more".
  - The battle result shows `before → after (±delta)`.
  - `battle:finished` invalidates the me, profile and leaderboard queries.
- **On "the paper's worked example":** a full-precision implementation gives r' = 1464.0507, but the paper prints 1464.06. Glickman carries *rounded* intermediate values from step to step (μ' = −0.2069 → 1464.06). So the test checks **every intermediate quantity at the paper's printed precision**: μ, φ, g(φj), E, v, Δ, σ', φ*, φ', μ', r', RD'. It also shows that the paper's own rounded g and E, fed through our v and Δ formulas, reproduce its printed 1.7785 and −0.4834 exactly. That is stronger than a single end-to-end tolerance, and it pins down why the last digits differ.
- **Fixed along the way:**
  - `RatingChart`'s `ResizeObserver` watched the element present on mount, and that element is swapped when data arrives. It now uses a callback ref.
  - Rendering the profile showed that the chart's area wash implied a quantity measured from a non-zero baseline, so it was removed. It also showed match-history rows wrapping badly at 390 px, so they now use a two-line layout.
  - My test assumptions: a population too small for a fixed index, and assuming which seeded player ranks first.
  - Phase 4 tests that used `toEqual` on results were relaxed to `toMatchObject`, now that results carry `ratingChanges`, and the win test asserts the symmetric ±delta.
- **Verified:**
  - `pnpm --filter @thegrave/server test` passes 142/142:
    - **14 Glicko-2 tests** against the paper (the exit criterion), plus properties: symmetric outcomes, newcomers moving fast and veterans slowly, upsets, RD shrinking, step 6 with no games, and decay additivity with the cap.
    - **14 rating/leaderboard integration tests**: rating in the finish transaction, 8 concurrent finishes plus a replay rating exactly once, draws, ABORTED unrated, idle-inflated RD at rating time, decay matching the lazy formula and idempotent, split decay equalling a single decay.
    - **The leaderboard matching Postgres exactly** (ids *and* scores, in order) after a rebuild from a Redis corrupted with phantom, missing and wrong-score entries, over 400 random users with ties. This is the exit criterion.
    - Pages concatenating to the full board with competition ranks, the CAS refusing a stale swap (2 attempts), enter and leave thresholds, rebuild on boot with exactly one scheduler across two "nodes", and profile W/L/D, graph and 3-page keyset history.
  - `pnpm test:e2e` passes 5/5: the 4 battle scenarios, now also asserting the ±rating change on the result screen, and a new **rating E2E**. It logs in as a seeded 30-game veteran and checks the leaderboard (descending order, "You are #1 of 5", the highlighted row), the profile (30 games, graph with hover tooltip, table view of 31 rows, history paginating 15 → 30), and a 390 px phone viewport with no horizontal scroll. Screenshots were inspected.
  - Typecheck, lint and the web build are green.

### 2026-11-18 — Landing page (black + grey + gold)

- **Tooling:**
  - Installed `framer-motion` 14.14, `@splinetool/react-spline` 4.2 and `@splinetool/runtime` 2.0.190 in `apps/web`.
  - Installed the third-party `ui-ux-pro-max` skill at **user level** (`~/.claude/skills/`, not in the repo, per D-016), after reading it: stdlib-only Python search over bundled CSVs, no network or subprocess calls. Only that skill was installed, not the six others its repo bundles.
  - Its design-system query gave a feature-showcase pattern and a 3D/immersive style for gaming, plus: respect reduced motion (high severity), 1–2 animated elements per view, 44 px touch targets, no emoji icons. Its default palette (purple/rose) was overridden by the requested black/grey/gold, and its gold palette results were light-mode only.
- **Routes:** `/` is now the public landing page (lazy chunk), and the lobby moved to `/play`. Login and register redirects, `GuestRoute`, the AppShell nav and the battle page's "back" links all point to `/play`.
- **Page:** `pages/LandingPage.tsx` and `components/landing/*`.
  - Navbar: fixed and transparent, gaining a blurred backdrop on scroll.
  - Hero: full-screen, copy bottom-left over an interactive Spline 3D scene. It uses the reference's staggered fade-up + blur entrance via framer-motion variants with the same `cubic-bezier(0.16, 1, 0.3, 1)` timing, and the reference's fluid `clamp()` type.
  - Sections: How it works (a gold rule draws across 4 steps), Arena (6 feature cards), Ranked (a judged submission streaming line by line), closing CTA, footer.
  - All copy describes what the system actually does; the one example ("+162") is the real result of two new players in the E2E.
- **Bugs found by rendering and probing the page** (the Playwright screenshots were inspected each round):
  1. **The full-screen 3D scene trapped the mouse wheel.** The Spline canvas consumes wheel events for camera zoom, so the page couldn't be scrolled past the hero. A capture-phase listener on the scene wrapper now stops wheel events before they reach the canvas, and the browser scrolls normally (D-054).
  2. The scene's accent glow was green. A CSS `hue-rotate` alone turned the faintly blue cubes green, so the filter is now `grayscale(0.8) hue-rotate(-75deg) saturate(2.5)`: neutral cubes, gold glow (D-054).
  3. The step rule animated from `scaleX: 0`, a zero-width box the IntersectionObserver never reported, so it never drew. It now inherits its trigger from the parent list's variants.
  4. The terminal lost its indentation, fixed with `whitespace-pre`. An orphaned "away." in the hero subheading was fixed with `text-balance`.
  - A flaky "wheel didn't scroll" result turned out to be the *probe's* fault. Headless Chromium's software WebGL delays input past a fixed sleep, so the check now waits for the scroll position (it passes consistently).
- **Verified:** `pnpm test:e2e` passes 8/8: the 4 battle scenarios, rating, and 3 new landing tests (CTA → register, section anchors scroll in-page, signed-in CTA → `/play`, and reduced motion with no canvas and every section visible). Visual checks at 1440 px (scene loaded) and 390 px (no horizontal overflow). Typecheck, lint and build are green.
- **Chunks:** landing 55 KB gzipped, Spline loader 81 KB gzipped plus the scene's runtime, all lazy. The signed-in app bundle is unchanged in practice (113 KB gzipped).

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

### D-029 — Problems are visible to signed-in users only · Accepted (resolved by D-042)

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

### D-040 — Battle lifecycle with a single "finish gate" · Accepted
- **States:** `PENDING` (countdown, problem hidden) → `ACTIVE` (from the `start` job at `startsAt`) → `FINISHED` (winner or draw) or `ABORTED` (both players gone, no result).
- **Decision:** Every ending (first ACCEPTED, the end timer, a forfeit, abandonment) calls `finish()`. That is `UPDATE "Match" SET … WHERE id = ? AND status IN ('PENDING','ACTIVE')`, and only the caller that updates one row emits `battle:finished` and releases the players. Concurrent triggers can't produce two results or a double release.
- **Server time decides:** a submit is accepted iff `startsAt ≤ now < endsAt`, even if the `start` job is a few ms late flipping the status. Submissions created at or after `endsAt` are ignored by the rules.
- **Consequences:** Phase 5's rating update goes inside the winning branch of `finish()`, so it runs exactly once per match.

### D-041 — Win rules as a pure function; "first" means first *submitted* · Accepted
- **Rules:** `decideOutcome(players, submissions, {timeUp, ignorePending})`.
  1. The first full ACCEPTED, **by submission time**, wins. An ACCEPTED is only final if the opponent has no *earlier* submission still being judged, because that one could also be ACCEPTED.
  2. Otherwise, at time-up with nothing pending, the player with the most tests passed wins.
  3. A tie goes to whoever reached that score first.
  4. 0–0 (or an exact tie in time) is a draw.
- **Why submission time:** judging order depends on queue luck and container start time. Without this, a player could lose a race they actually won.
- **Missing verdicts:** after `endsAt` the end job re-checks every 2 s. After 60 s (`endGraceMs`) it decides as if pending submissions didn't exist. A judge `FAILED` counts as not pending, with 0 passed. A dead judge can't hold a match open forever.
- **Tests count all tests** (samples + hidden), matching what both players see as `x/9`.

### D-042 — Problem selection: difficulty by average rating, avoiding anything either player has seen · Accepted
- **Difficulty:** below 1550 → Easy, below 1900 → Medium, otherwise Hard. New players (1500) start on Easy.
- **"Seen"** is a `SeenProblem` row, written when a user opens a problem in practice, submits to it, or gets it in a battle. Picking prefers an unseen problem at the target difficulty, then the nearest difficulty. If both players have seen everything, it falls back to a random problem at the target difficulty.
- **Resolves D-029:** the practice catalogue stays open, and practising a problem removes it from your battle pool, so pre-solving gains nothing.
- **Durations:** Easy 15 min, Medium 25 min, Hard 40 min. `BATTLE_DURATION_MS` overrides all of them, for tests.

### D-043 — Battle timers are BullMQ delayed jobs on API nodes; the judge only hands over verdicts · Accepted
- **Decision:** A `battle` queue carries `start`, `end` (with an attempt counter), `judged` and `forfeit` jobs, processed by a worker inside every API node (they need Socket.IO). Job ids (`start_{id}`, `end_{id}_{n}`, `judged_{subId}`, `forfeit_{id}_{user}_{token}`) make scheduling idempotent. Jobs never need cancelling: each one re-reads state when it fires, so a `start` for a finished match or a `forfeit` for a player who came back is a no-op.
- **Judge boundary:** the judge worker (a separate process, on separate hosts in prod) enqueues `judged` and nothing else. All rules and notifications stay in the API's `BattleService`.
- **Verified:** a test kills the API node that created a match and starts a fresh one, and the match still ends on time.

### D-044 — Presence and forfeit: away tokens plus a ground-truth presence check · Accepted
- **Decision:**
  - When a user's *last* socket on any node disconnects during a live match, `markAway` writes `battle:away:{match}:{user} = token` and schedules `forfeit` after `BATTLE_RECONNECT_GRACE_MS` (30 s). Opponents see `connected:false` with `graceEndsAt`.
  - Reconnecting deletes the key, which also triggers a battle resync.
  - When `forfeit` fires it needs the same token **and** `fetchSockets()` showing no socket for that user. If the opponent is also away and not connected, the match is ABORTED/ABANDONED; otherwise the opponent wins by FORFEIT.
- **Why the presence check:** the E2E showed a reload can interleave so that "away" is written *after* the new socket has connected. Event order across two sockets isn't reliable, so the decision is made from actual presence when it matters. `markAway` also re-checks presence right after writing, so the opponent's UI doesn't flash "away".
- **Graceful shutdown:** a node going down doesn't mark its users away (same as D-035). They reconnect elsewhere within the grace period.

### D-045 — E2E harness: isolated full stack, real judge, shortened timings · Accepted
- **Decision:** `playwright.config.ts` starts:
  1. `apps/server/test/e2e/setup.ts`: database `thegrave_e2e`, migrations, judge image build, exactly **one** problem (Sum of Array, so the tests know a correct solution), and a flush of Redis DB 2.
  2. `test/e2e/server.ts`: API + Socket.IO + battle worker + **the real Docker judge** in one process on :4100.
  3. Vite on :5174, proxying to it (`API_PROXY_TARGET`).

  Battle timings come from env vars (countdown 1.5 s, duration 20 s, grace 4 s, cooldown 1 s), so the time-out, draw and forfeit scenarios take seconds. Scenarios run serially because there is one shared queue, and `rl:*` keys are cleared between scenarios so per-IP auth limits don't trip.
- **Why one backend process:** Playwright waits on a URL, and a separate judge worker has none. Putting them together keeps startup deterministic, and production still runs them apart.
- **Consequences:** It needs Docker and `pnpm exec playwright install chromium`. About 1.3 min for 4 scenarios.

### D-046 — Battle frontend: app-level socket, clock offset, local Monaco · Accepted
- **One socket per signed-in app** (`RealtimeProvider` inside `ProtectedRoute`), so navigating lobby → battle doesn't drop the connection and trigger a disconnect grace. `battle:created` navigates to the battle from anywhere, including after a reload.
- **Clock:** `serverNow() = Date.now() + offset`. The offset comes from 5 `time:sync` round trips, keeping the lowest-RTT sample (error ≤ RTT/2). It is recomputed on every connect. All countdowns (ready check, start, timer, away grace) use it, which closes the gap noted in D-039.
- **Monaco is bundled locally** (`monaco-editor/editor/editor.api` + Python/C++ tokenizers + the editor worker), not loaded from its default CDN. There's no third-party script at runtime, it works offline and in CI, and it's CSP-friendly for Phase 7. It is lazy-loaded with the battle route.
- **State:** the battle view is a TanStack Query entry. Socket progress events patch it, and lifecycle events refetch it, so the server's `GET /matches/:id` stays the single source of truth for resync.

### D-047 — Each game is rated on its own; idle time inflates RD by real elapsed time · Accepted
- **Context:** Glicko-2 was designed for batches ("rating periods" of roughly 10–15 games). In a 1v1 app, players want their rating to move after every game, and step 6 of the algorithm adds one period of uncertainty per update.
- **Decision:** Each finished match is its own update, called with `periodFraction: 0`. Uncertainty from idle time is added separately and exactly: `RD_now = √(RD² + σ²·t)`, with `t` = elapsed days since `rdUpdatedAt` (rating period = 1 day). This is applied to *both* players right before the update. τ = 0.5. New players start at 1500 / 350 / 0.06.
- **Alternatives:** Batching per day or week means ratings only change at period boundaries, which feels broken in a competitive app. Keeping step 6 per game inflates RD after every game for rapid players, which is wrong. Elo: see D-010.
- **Consequences:** The numbers: a newcomer reaches RD ≈ 190 after 3 games against established players, and a veteran at RD 60 goes provisional (> 110) after about 79 idle days.

### D-048 — Rating is part of the finish transaction; idempotent per match · Accepted
- **Decision:** `finish()` = `BEGIN; UPDATE Match … WHERE status IN (live)` (Phase 4 gate) → `UPDATE Match SET ratedAt WHERE ratedAt IS NULL` (rating gate) → `SELECT … FOR UPDATE` on both users **in id order** (no deadlocks) → Glicko-2 using both players' *pre-match* values (a simultaneous update) → update users + 2 `RatingHistory` rows → `COMMIT`. `@@unique(matchId, userId)` on `RatingHistory` is a backstop.
- **Why in the same transaction:** a separate "rate later" job would need an outbox to survive a crash between finishing and rating. Committing together makes FINISHED-but-unrated impossible, and makes "exactly once" a property of the database.
- **Display:** the exact float is stored, and values are rounded only for display. `delta` shown = round(after) − round(before), so `before + delta = after` on screen.
- ABORTED matches are unrated. FORFEIT is rated as a normal loss.

### D-049 — Inactivity decay: lazy and materialised give identical results · Accepted
- **Insight:** idle inflation `φ² + σ²·t` is additive in `t`. Inflating 25 days then 15 equals inflating 40, and a test proves it.
- **Decision:**
  - The source of truth is `(ratingDev, rdUpdatedAt)`, and everything that needs "RD now" uses `effectiveRd`.
  - An hourly BullMQ job scheduler (`rd-decay`, upserted by id, so one schedule however many API nodes start it) runs **one SQL statement** that writes the inflated RD and sets `rdUpdatedAt = now()` for everyone idle for over an hour, then reconciles the leaderboard.
  - The SQL formula mirrors `effectiveRd`, and a test checks they agree to 3 decimals.
- **Why materialise at all, if lazy is exact?** So the leaderboard and any SQL query (eligibility, analytics) see current RD without per-row maths in the application.
- **Consequences:** A missed or late job changes nothing about correctness, only how fresh the stored column is.

### D-050 — Leaderboard: derived Redis ZSET, competition ranks, CAS-swapped rebuilds · Accepted
- **Membership:** at least 1 rated game and effective RD ≤ 200. That means about 3 games in, or about 11 months idle out. Players with RD > 110 are shown as provisional ("1523?").
- **Ranks:** competition ranking, `1 + ZCOUNT(score, +inf exclusive)`, so ties share a rank (1, 2, 2, 4). A page needs only one `ZCOUNT`; after that the rank changes exactly where the score changes. Scores are the exact floats, so Redis order equals Postgres `ORDER BY rating DESC, id DESC`.
- **Updates:**
  - Incremental `ZADD`/`ZREM` + `INCR lb:version` in one `MULTI` after each rating commit. If it fails, the next rebuild repairs it.
  - Rebuild: read Postgres → build into `lb:rating:build:{uuid}` → a Lua script `RENAME`s it over the live key **only if `lb:version` didn't change since the read**; otherwise it discards and retries.
  - The rebuild runs on boot and hourly.
- **Why CAS:** a plain rebuild can read the DB just before a match commits and then swap its older snapshot over the newer `ZADD`. A test forces exactly that interleaving through a `beforeSwap` seam: the first swap is refused, and the second is built from fresh data.
- **Why build-and-rename:** readers never see an empty or partial board, as they would with `DEL` + refill.

### D-051 — Profile and history API · Accepted
- W/L/D come from `groupBy(outcome)` on `RatingHistory`. The rating graph is the latest 500 points, starting from the pre-game rating. Match history is **keyset-paginated** with an opaque `(createdAt, id)` cursor, so it's stable while new games are added and doesn't use OFFSET.
- Profiles are visible to signed-in users, the same as problems (D-029).

### D-052 — Rating chart follows the dataviz procedure · Accepted
- **Form:** one series over games played, as a line. There's no legend because the title names it. The x-axis is the game number, not time, so a burst of games on one day isn't squashed.
- **Colour:** the brand's emerald-500 (`#10b981`) **failed** the dark-mode lightness band (L 0.70 vs 0.48–0.67) in `validate_palette.js`. The chart uses `#10a87a`, the nearest step of the same hue that passes every check (band, chroma, ≥ 3:1 on the zinc-900 card). All text uses text tokens, never the series colour.
- **Marks:** 2px line, an end dot (r = 4) with a 2px surface ring, a direct label on the endpoint only, solid hairline grid one step off the surface, and clean ticks.
- **No area wash:** the y-axis can't start at 0 for ratings, so a fill would imply a magnitude from an arbitrary floor. I removed it after looking at the render.
- **Interaction and accessibility:**
  - a crosshair snapping to the nearest game across the whole plot (the hit target is the plot, not the 2px line)
  - a tooltip with the value first, then the context
  - keyboard focus with ←/→/Home/End
  - `role="img"` with a summary label
  - a "Show as table" view of every point
  - the width tracked with a `ResizeObserver` (callback ref), checked at 390 px.

### D-053 — Brand: black + grey + gold, with every text colour contrast-checked · Accepted
- **Tokens** (Tailwind 4 `@theme` in `index.css`, so they're usable as utilities like `bg-gold` and `text-ash-300`):

  | Token | Hex | Contrast on `#0a0a0a` | Use |
  |---|---|---|---|
  | `hero-bg` | `#0a0a0a` | n/a | background |
  | `ink` | `#f5f5f4` | n/a | primary text |
  | `ash-300` | `#a3a3a3` | 7.9:1 | body text |
  | `ash-400` | `#8a8a8a` | 5.7:1 | tertiary text |
  | `ash-700` / `ash-800` | n/a | n/a | borders / surfaces |
  | `gold` | `#d4af37` | **9.4:1**, and `#0a0a0a` on gold is also 9.4:1 | text and button fill |
  | `gold-light` / `gold-deep` | n/a | n/a | the wordmark gradient |

  `#737373` (4.18:1) was rejected for text.
- **Font:** Sora (300–700), loaded from Google Fonts in `index.html`, as in the reference.
- **Scope:** for now, only the landing page uses Sora and gold. The signed-in app keeps zinc + emerald, and the rating chart's validated colour is unchanged (D-052). Carrying the brand through the app is a Phase 6 polish item.
- **Adapted from the reference spec:** it assumed Tailwind 3 (`tailwind.config` + HSL vars) and shadcn/ui. This repo uses Tailwind 4 and has no shadcn, and two button styles don't justify adding it (cva, Radix, and a `components/ui` tree). The visual spec (tokens, type scale, timing, layout, pointer-events pattern) is reproduced as specified.

### D-054 — Landing hero: lazy 3D scene with fallbacks, recolouring, and the wheel fix · Accepted
- **The scene is the reference's Spline scene** (`prod.spline.design/Slk6b8kz3LRlKiyk`), lazy-loaded with `React.lazy`. It fades in only once `onLoad` fires, over a static gold-glow backdrop, so there's never a blank flash. The content layer is `pointer-events-none` so the scene stays interactive, and the CTAs opt back in.
- **No 3D on phones (< 768 px) or with `prefers-reduced-motion`:** they get the static backdrop. WebGL is expensive on mobile, and the motion is exactly what reduced-motion users opted out of; the skill rates 3D as high-cost/high-risk. `MotionConfig reducedMotion="user"` also turns every entrance into a plain fade, and smooth anchor scrolling is disabled under reduced motion.
- **Recolouring the scene without re-authoring it:** `filter: grayscale(0.8) hue-rotate(-75deg) saturate(2.5)`. The glow's hue (~119°) lands on gold (~44°), and the faint blue tint of the cubes is removed first so it can't turn green.
- **Wheel passthrough:** the wrapper's capture-phase `wheel` listener calls `stopPropagation()` (passive, with no `preventDefault`). The canvas never sees the event, so it can't zoom or cancel it, and the page scrolls. Pointer interaction (hover glow, drag) is unaffected.
- **Consequences:**
  - At runtime the page depends on `prod.spline.design` (scene + assets). Phase 7's CSP must allow it, or the scene should be self-hosted (export `.splinecode` into `public/`).
  - If the scene fails to load, the backdrop simply stays: the page is fully usable without it.

### D-055 — Landing: the 3D scene is pinned; content scrolls over it · Accepted
- **Request:** the animation stays fixed while all content scrolls.
- **Decision:** `SplineBackground` moved out of the hero into a `fixed inset-0 z-0` layer at the page root. The nav, hero, sections and footer sit in a `relative z-10` layer above it. The hero is now transparent and fully `pointer-events-none`, with only its CTAs opting back in, so the pinned scene still gets hover and drag where the hero is. The capture-phase wheel passthrough (D-054) still applies: a wheel over the scene scrolls the page.
- **Readability:** a fixed `ScrollDim` layer (framer-motion `useScroll` → `useTransform`) takes the scene from 30% to 72% black over the first ~0.9 viewport heights. The scene stays visible behind the sections but recedes enough for body text. The hero's bottom-left gradient now has a mask that fades it out, removing the hard seam that showed once the scene ran continuously behind the hero/section boundary.
- **Verified** with a Playwright probe from scroll 0 to 2735 px: the canvas stays at `top: 0` and full viewport height while the hero heading moves 2735 px with the content. Wheel scrolling works over both the hero and the sections. Screenshots at mid-scroll, in the sections and at 390 px (static backdrop pinned the same way, no horizontal overflow). Landing E2E passes 3/3, and typecheck and lint are green.
- **Consequence:** the WebGL scene is now visible (and rendering) for the whole page visit, not just above the fold. That was already its cost, since an off-screen canvas still renders; phones and reduced-motion users still never load it.

### D-056 — The app wears the brand; the 3D scene stays on the landing page · Accepted
- **Request:** redesign every page in the landing page's black + grey + gold palette, without the animation. This supersedes D-053's scope note ("only the landing page uses Sora and gold").
- **No Spline, no framer-motion outside `/`:** the app's pages are for focus (the lobby, a timed battle), and framer-motion + the Spline loader stay out of the app bundle (the landing page remains a lazy chunk). The only motion is CSS: the gold queue "ping", the loading pulse and the accept-window bar. All are `motion-safe:` or plain transitions.
- **Global base:** `body` gets the `hero-bg` surface, `ink` text, Sora and a gold `::selection` in `index.css`, so no route can flash white or fall back to the system font. There are two new tokens: `ash-900 #141414` (card surface) and `ash-600 #3a3a3a` (control borders). The old `zinc-500` text (4.1:1) is gone; the faintest text is now `ash-400` (5.7:1).
- **Shared primitives** in `components/ui.tsx`:
  - class strings: `btnPrimary` (gold), `btnSecondary`, `card`, `input`, `focusRing`
  - components: `Wordmark`, `Eyebrow`, `PageHeader`, `GoldBackdrop`
  - These are plain strings and small components, not a UI kit, for the same reason as D-053.
  - `GoldBackdrop` is a quieter static version of the landing glow + grid, pinned behind the app pages.
- **Per page:**
  - **Header:** sticky and blurred, with the wordmark. The nav is uppercase-tracked like the landing nav, the active link gets a gold underline, and the nav wraps to its own row on phones.
  - **Login / register:** a card over the backdrop.
  - **Lobby:** a gold CTA and a gold ping while searching. When a match is found, the card gets a gold border and the 10 s accept window drains as a bar.
  - **Leaderboard:** the podium ranks are gold, and your own row is tinted with a gold inset rule plus a "you" badge.
  - **Profile:** a gold monogram, a gold rating tile, gold positive deltas, and W–L–D as one non-wrapping value (it wrapped at 390 px).
  - **Battle:**
    - Header: the clock turns red in the last minute.
    - Progress: your bar is gold and the opponent's is grey.
    - Rest of the screen: a "Get ready" countdown, and a gold-gradient result card on a win.
    - Monaco uses a custom `grave` theme: a `#111` surface, gold cursor, selection and keywords, and a gold-light number colour.
- **Status colours stay semantic, not brand:** accepted, connected and win are emerald; errors and loss are red; "away" and judge failure changed from amber to **orange**, so a warning can't be mistaken for gold. Every status still comes with a text label.
- **Rating chart (re-validated per D-052):** brand gold `#d4af37` **fails** the dark lightness band (L 0.77). `#c4a032` (0.72), `#bf9b2f` (0.70) and `#b8952b` (0.68) also fail. The line uses **`#b08e28`**, which passes every check against the new `#141414` card. The grid, crosshair and labels moved to the ash tokens.
- **Verified:**
  - Typecheck and lint are clean, and the full E2E suite passes 8/8. No test selectors changed: headings, labels and button names are identical.
  - Screenshots of login, lobby (idle, queued, match found), leaderboard, profile with tooltip, battle, the win overlay, and profile and lobby at 390 px (no horizontal overflow).

### D-057 — Battle arena: an IDE-style workspace · Accepted
- **Request:** a more polished, professional arena, modelled on a reference online-judge IDE, in our palette.
- **Layout (≥ 1024 px, fills the viewport, no page scroll):**
  - **Top bar:** Back (asks to confirm while the match is live) and the problem title on the left; compact *You vs Opp* progress chips in the centre; on the right a clock pill (gold, turning red in the last minute), **Run** and a gold **Submit**.
  - **Panels:** an icon rail switches the left panel between **Description** and **Match**. The problem panel and the editor column are split by a draggable divider, and the editor and console by a second one.
- **Resizable panes:** `Splitter` is a `role="separator"` that uses pointer capture, so dragging across Monaco never loses the handle. Arrow keys and Home/End move it. Sizes are clamped (problem 25–65 %, console 15–70 %) and saved in `localStorage` per browser, with any storage failure falling back to the defaults. Widths and heights go through CSS variables (`lg:w-[var(--left)]`), so the inline size applies only at `lg` and up.
- **Problem panel:** a difficulty pill (emerald, orange or red: status colours, per D-056), the limits, section titles with a hairline rule, and examples as Input/Output blocks with copy buttons. The statement renderer adds `**bold**`, still building React nodes rather than HTML.
- **Editor toolbar:** a language pill, "Autosaved" (drafts already persist per match and language), reset to the starter code (with a confirm), and **focus mode**. Focus mode takes the editor and console full screen (Esc exits) and moves the clock and Run/Submit into the toolbar, so they are never hidden in a timed match.
- **Keyboard:** Ctrl/⌘ + Enter runs and Ctrl/⌘ + Shift + Enter submits. They are bound with `editor.addCommand`, because Monaco consumes those keys before they reach `window`; refs keep the commands calling the latest handlers.
- **Console tabs:**
  - **Test results:** an overall verdict, then one chip per sample showing that case's input, your output and the expected output.
  - **Submissions:** a count badge, and still carries `data-testid="my-submissions"`.
  - **Errors:** compiler output and per-case stderr, with a count badge.
  - Run switches to Test results and Submit switches to Submissions. The stale "Submitted, judging…" note is gone, because the list itself shows "Judging…".
- **Match tab:** both players in detail (passed/total, attempts, judging, presence) plus the rules: submission-time ordering, the time-out tie-break, the grace period, and that the opponent sees progress but never code.
- **Small screens:** everything stacks and the page scrolls. The rail becomes a labelled tab row, the dividers hide, and the editor gets 60 vh. No horizontal overflow at 390 px.
- **Structure:** `BattlePage` keeps the data flow (query, draft, run/submit). The view pieces live in `components/battle/`: `ProblemPanel`, `ConsolePanel`, `Players`, `Splitter`, `ResultOverlay`, `format` and `icons`. The icons reuse the landing page's `Icon` base.
- **Verified:** typecheck and lint are clean, and the full E2E suite passes 8/8 with no test changes: every test id, button name and the `Language` label are kept. Screenshots: idle, after a Run with a failing case selected, after a Submit with the Match tab open, focus mode, and 390 px.

## D-058 — Judging animation and the win confetti (2026-11-19)

**Context.** Submitting in the arena only added a row to the submissions list. The ask: show each test case spinning, then turning pass/fail, and burst confetti when every test passes.

**Decision.**
- The Submissions console tab opens with a **Last submission** panel (`components/battle/Judging.tsx`):
  - A summary card shows "x/N test cases passed" and the status: In queue → Running tests → verdict.
  - One `TC #n` card per test, plus details for the selected test. Hidden-test input and output read "Hidden", along with the verdict and time.
- **The stagger is presentation.** The judge reports every test at once when it finishes (`processSubmission` writes `results` in one update). Until then every card spins. Once the verdict lands, the cards flip in order, spaced 60–160 ms apart so the whole sweep takes about a second. Each status disc springs in through framer-motion.
  - Streaming real per-test progress would need the judge to write partial results. That isn't worth it for tests that each take milliseconds.
- **Confetti** (`components/battle/Confetti.tsx`) is a dependency-free one-shot canvas:
  - Gold, gold-light, ink and a touch of emerald.
  - Two corner cannons and a centre pop, fading out after about 3 s.
  - Skipped under `prefers-reduced-motion`; the reveal is instant there too.
- **Ordering with the result overlay.** An accepted submission ends the match, and the socket result usually arrives before the sweep finishes. So the page holds the "You won!" overlay while its own submission sweeps, and brings it in 1.2 s into the burst (the confetti sits above it, z-60).
  - A 5 s cap after the result arrives means the overlay is never held back for long.
- **Restoring and staying mounted.**
  - After a reload the latest submission is restored without animation or confetti.
  - Console tabs now stay mounted (`hidden`), so a sweep started on one tab still finishes, and still celebrates, if you switch tabs.

## D-059 — Recolour: gold → light blue (2026-11-19)

**Context.** The brand moves from black + grey + gold to black + grey + a light, shiny blue. Every gold accent becomes blue.

**Decision.**
- **Tokens renamed as well as recoloured**, so class names say what they show:
  - `--color-gold` → `--color-azure` #5cb8ff (9.2:1 on #0a0a0a, and #0a0a0a text on it is 9.2:1)
  - `gold-light` → `azure-light` #a8dbff
  - `gold-deep` → `azure-deep` #2b7fd9
  - The "shine" is the existing light → base → deep gradient on the wordmark and on "You won!".
  - Every `*-gold*` utility, `rgb(212 175 55 / …)` glow and raw hex was swapped mechanically, and `GoldBackdrop` became `GlowBackdrop`.
- **Greys and status colours are unchanged.** Emerald, red and orange stay semantic. Orange was chosen in D-056 so it couldn't be mistaken for gold; it is now even further from the accent.
- **Rating chart line** is #3b9be8, the nearest step of the new hue that passes the dataviz lightness band on #141414. #5cb8ff itself is too light (L 0.756).
- **Editor theme:**
  - Keywords, cursor, selection and the active line number use #5cb8ff.
  - Numbers use #a8dbff and types #8fd0ff.
  - Strings move from the warm grey #c8c3b4 to the cool grey #b9c3cf.
- **Confetti:** blues, white and a touch of emerald.
- **Spline hero:** the scene's own glow is green (~119°). The CSS filter now rotates it +87° to the brand blue (~206°) instead of −75° to gold. The grayscale strip still keeps the faintly blue cubes neutral.

## D-060 — Landing: grid + drifting blue lights replace the 3D scene (2026-11-19)

**Context.** The ask was to drop the Spline animation on the landing page and use the auth page's grid look instead, more visible, with a glowing blue light moving randomly behind it.

**Decision.**
- `components/landing/GridBackground.tsx` replaces `SplineBackground`. It stays pinned to the viewport, as in D-055, so the content scrolls over it.
- **The grid** is 64 px, like the auth page's `GlowBackdrop`. The lines are light blue at 13% instead of 5%, so it reads clearly. A soft radial mask and an edge vignette keep the corners and the copy calm.
- **Three blurred blue lights** sit behind the grid, in base, deep and light blue.
  - Each picks a new random point and a duration of 5–9 s on every leg, through framer-motion's `onAnimationComplete`, so the path never visibly loops.
  - Only transform and opacity are animated, which is cheap.
  - Under reduced motion they stay still.
- **Removed:**
  - `SplineBackground.tsx` and the `ScrollDim` layer, which only existed to dim the busy scene.
  - The `@splinetool/react-spline` and `@splinetool/runtime` dependencies, so the landing page no longer downloads a 3D runtime or a remote scene.
  - The reduced-motion E2E test is renamed; it still asserts that no `<canvas>` exists.
- **The auth and app pages are unchanged.** They keep the quieter static `GlowBackdrop`, per D-056.

## D-061 — Landing: shadowy half-blur grid, a real footer, no section rules (2026-11-19)

- **Grid.** It is drawn twice, for a depth-of-field look. A crisp layer is masked to an ellipse across the upper middle, and a 2.5 px-blurred, slightly brighter copy covers everything else. The two masks overlap, so the change is gradual. Shadow comes on top:
  - a 25% black film, which makes the lights read as coming from under the grid
  - a heavy radial vignette
  - top and bottom fades into black

  The drifting lights from D-060 are unchanged.
- **No rules between sections.** The `border-t` on Arena, Ranked, the closing CTA and the old footer is gone, and so is the nav's bottom border once it turns solid; spacing alone separates them now.
- **Footer.** The footer is solid #050505. It joins the page through a 16 rem gradient above it rather than a line, which is why the footer no longer clips its overflow. It contains:
  - the wordmark, a blurb and an "arena is open" pill
  - Product links (in-page anchors plus the leaderboard)
  - Play links (find a match, create an account, log in). The last one is labelled "Log in" so the page has only one "Sign in" link, which the E2E test looks up by name.
  - a static "Under the hood" list
  - an oversized THEGRAVE wordmark fading into the floor
  - the copyright line

  The columns stack on phones, with no horizontal overflow at 390 px.

## D-062 — Landing: every section in the footer's style, with a few grave-themed lines (2026-11-19)

**Context.** The ask was to make the hero and every landing section match the footer: shadowy, classic and professional. It also asked for a few bold lines such as "turn their codebase into ashes", without overdoing it.

**Decision.** There is one visual language across the page:
- **Panels with no borders.** Depth comes from a #121212 → #070707 gradient, a deep drop shadow and a 1px inset top highlight.
- **Ghost type**, a gradient from ash-700 to transparent, like the footer wordmark. It is used for section indices (01–03), step numbers and the "1v1" behind the closing call to action.
- **Shadow bands.** Each section sits on a band that fades from transparent through #050505 and back, so sections separate without rules (D-061).

**Hero**
- A "Ranked 1v1 · Season 01" pill, a larger wordmark with a drop shadow, and the tagline.
- A terminal-style **taunt** that types, holds and erases five lines, starting with "turn their codebase into ashes." The animated text is `aria-hidden` and the line carries a static `aria-label`; it is static under reduced motion.
- A scripted **live-match card**, on large screens only and `aria-hidden`: progress bars, a verdict log and a "RIP" result line, looping every ~10 s.
- A stats row: 30 problems, 2 languages, 1v1 real time, 1500 starting rating.

**Sections**
- **How it works:** four step cards with ghost numerals and a hover glow. The last step is renamed "Bury".
- **Arena:** feature cards with a glowing icon tile and a corner glow on hover.
- **Ranked:** the judge stream in a window frame, ending with "opponent 1500 → 1338 rest in peace." Below the heading are three rating facts (1500, ±350, 1 tx).
- **Closing CTA:** a darker panel with a blue glow from below. It adds a secondary "See who's on top" link to the leaderboard.
- **Manifesto (new):** a single loud typographic moment between Ranked and the CTA: "Every match ends in a funeral. / Make sure it isn't yours.", with "TheGrave · where ratings go to die" underneath.

**Copy restraint.** The bold lines are limited to three places: the hero taunt, one mono `// kicker` per section, and the manifesto. Everything else stays factual.

**Unchanged for the E2E tests:**
- the h1 text
- the "Enter the arena" link
- the single "Sign in" link
- the three section headings and the section-nav anchors

No horizontal overflow at 390 px.

## D-063 — Landing: no cards; type and spacing carry the page (2026-11-19)

**Context.** The ask was to remove the cards and the live-match card, and to show things another way, or rearrange the text and spacing to fill the gaps.

**Decision.** Every boxed element is gone: the live-match card, the step and feature panels, the judge terminal and the closing-CTA panel. The unused `panel` style went with them.
- **Hero:**
  - THEGRAVE now runs the full width (up to 13.5 rem).
  - Beneath it the copy splits in two: tagline and taunt on the left; description and CTAs on the right, aligned to the right edge.
  - The stats spread across the full width in larger mono type.
- **How it works:** four text-only steps, each hanging off a giant ghost numeral (01–04), with a mono tag in blue.
- **Arena:** an editorial split. The heading is sticky on the left (`lg:sticky top-32`) while a two-column list of icon, title and body scrolls past on the right. The icons get a soft blue drop-shadow glow in place of a tile.
- **Ranked:** the terminal is replaced by **a rating swing told in type**:
  - an "ACCEPTED · 9/9" line
  - 1500, struck through
  - an oversized gradient number that counts up to 1662 when scrolled into view (instant under reduced motion)
  - +162, then "opponent 1500 → 1338 · rest in peace."
- **Closing CTA:** stands bare on a blue glow rising from the bottom, with the ghost "1v1" behind it.
- **Page wrapper:** `overflow-x-clip`, so glows that extend past their column never cause horizontal scroll. `clip`, unlike `hidden`, doesn't create a scroll container, so the sticky Arena heading still works.

The heading texts, links and anchors the E2E tests use are unchanged.

## D-064 — Play page: matchmaking bar + practice set, and a practice solving page (2026-11-19)

**Context.** The ask was a more professional play page, following a judge's problem-list screenshot: matchmaking controls in a compact top area, and a practice question list below.

**Server**
- **`Problem.tags String[]`.** Migration `problem_tags`. The 30 seeded problems get one to three topics from `seed/tags.ts`, applied by the idempotent seed and the E2E setup. A unit test keeps the map and the problem set in step.
- **`GET /problems` now returns `ProblemListItem[]`:**
  - `tags`
  - `acceptance`: accepted ÷ judged SUBMITs across all users, practice and battle, or null before any
  - the caller's `solved` / `attempted` (any SUBMIT) / `seen`

  It costs four grouped queries in parallel, whatever the size of the problem set. The judge-API test covers the new fields: per-user status and a 1/3 acceptance after one accepted, one wrong and one compile error.

**Play page (`/play`)**
- **Header:** "Lobby / Welcome, X", with the rating and "View profile" on the right.
- **Matchmaking bar** (the `Lobby` component, restyled):
  - Mode (Ranked 1v1), Language, Server status and In queue, plus the Find match / Searching… + Cancel action.
  - The ready check expands the bar in place (`role="dialog"`, "Match found").
  - **Language** is a real option. It is remembered per browser (`pref:language`) and is now the editor's starting language in battles and practice; it was always Python before. No fake modes were added: the server has one queue.
- **Practice list** (`components/play/PracticeList.tsx`):
  - topic chips with counts; the row scrolls sideways, and "Expand" wraps it
  - search, which also matches topics
  - a difficulty segment
  - a status filter: all, unsolved, solved, not opened yet
  - a sort that cycles through difficulty, acceptance and title
  - an "x/N Solved" ring
  - a random-unsolved button
  - Rows alternate tint. Each shows a solved check or attempted dot, a number and title, two topics, acceptance %, and Easy / Med. / Hard in the status colours. An eye icon marks problems already opened.
  - A visible note says **opening a problem takes it out of your ranked pool**. Viewing marks it seen (D-042), so players learn the trade-off before they make it.
- `AppShell` gets a `wide` option (max-w-6xl) for this page.

**Practice page (`/practice/:slug`, lazy like the arena)**
- The arena's layout without an opponent or a clock: problem panel | editor + console, with resizable, remembered splits.
- Run fills **Test results**, using the arena's `Results`, now exported.
- Submit fills **Submission**, using the arena's `LastSubmission` spinner-to-verdict sweep, and fires the confetti on Accepted.
- Drafts persist per problem and language in `localStorage`.
- The list query is invalidated on open (seen) and after judging (solved/acceptance).
- `pollSubmission` moved to `lib/submissions.ts`, shared with the arena.

**Verified:**
- Server typecheck clean; judge-API tests 11/11.
- E2E 8/8 on a clean run; every battle and rating selector is kept, and no second "Leaderboard" link was added.
- Screenshots against the dev stack (30 problems): the list, the searching state, the practice page and 390 px, with no horizontal overflow.

## D-065 — Private rooms: play a friend with a code (2026-11-19)

**Context.** The ask was "create your own room" next to matchmaking: a user creates a room, shares a code, and a friend joins.

**Decision.** A room is a pre-battle lobby for exactly two players, host and guest. When the host starts, it becomes an ordinary match, so the countdown, clock, judging, forfeits, the result and the arena UI are all reused unchanged.

**State and atomicity**
- Rooms live in Redis (`room:{code}` HASH: host, guest, ready, difficulty). They change only through Lua scripts (`rooms/scripts.ts`: create, join, leave, update, start), as the matchmaker does (D-034).
- **Membership uses the matchmaker's own `user:{id}:state` key** (`room:{code}`). So the existing JOIN script already refuses to queue a room member, and the room scripts refuse queued or in-match users: someone can never be in both.
  - `Matchmaker.describe` and `join` now recognise that state. They return `IN_ROOM`, "Leave your private room before queueing".
- **Start** checks host, guest present, guest ready and the guest's state, all in one script. It then deletes the room and moves both players to `match:room-{code}`.
  - `BattleService.createMatch` is unchanged in shape: it rebinds that state to the real Match id, exactly as for a ranked ready check.
  - If creation fails, both players are released and told `start-failed`.
- **Codes:** six characters from an alphabet without look-alikes (no 0/O/1/I/L), generated with `crypto.randomInt`, retried on collision. Input is normalised, so "xf5-aac" works.
- **TTL:** a room and its members' state expire after 2 h idle, as a safety net.

**Rules**
- The host picks the difficulty (Auto = rating-based like ranked, or Easy / Medium / Hard), can remove the guest, and starts.
- Only the guest toggles Ready. Start stays disabled until then.
- The host leaving closes the room for both players; a guest leaving frees the seat.
- **Disconnects get a 15 s grace period** before a member is removed, so reloading the play page doesn't close the room. A reconnecting socket is resynced with `room:updated`.

**Unrated**
- `Match.rated Boolean @default(true)` (migration `match_rated`). Room matches are created with `rated: false`, and `finish()` skips Glicko-2 for them. Otherwise two friends could farm rating off each other, and the leaderboard means nothing.
- `BattleView.rated` drives a "Friendly · unrated" badge in the arena, and "Friendly match: ratings are unchanged." on the result.
- They don't appear in profile history, which is built from rating changes.

**Client**
- `RoomPanel` sits under the ranked bar on `/play`.
  - Idle: code input + Join, and Create room.
  - In a room: the big code, "Copy code" / "Copy invite link", host and guest seats with ready state, the difficulty segment (read-only for the guest), and Start / Ready / Remove guest / Close or Leave.
- **Invite links** are `/play?room=CODE` and join automatically once the socket connects. `AuthForm` now keeps the query string when it returns you after login, so the link survives a sign-in.
- Find match is disabled while in a room, with a hint under the ranked bar.
- State lives in a `useRoom` store fed by `room:updated` / `room:closed` in `RealtimeProvider`. `battle:created` clears it.

**Verified**
- `test/rooms.test.ts` (4 tests):
  - code format; full and not-found; queue and room exclusivity
  - host-only difficulty and start; guest ready; an unrated battle ending with `ratingChanges: []` and ratings and `ratedGames` unchanged
  - host-leave and kick
  - surviving a quick reconnect, then being dropped after the grace period
- The battle, matchmaker, rating, outcome, auth and stress suites (70 tests) still pass.
- New `e2e/room.spec.ts`: create → invite link → ready → start → host wins → friendly result on both sides.
- Full E2E 9/9. One earlier full run failed the room test because a judge run stayed "Running" for over 15 s; it was not reproducible in two reruns.
