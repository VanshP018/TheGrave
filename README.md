# theGrave ⚔️

> **High-stakes 1v1 real-time competitive programming & multi-file debugging arena.**

[![TypeScript](https://img.shields.io/badge/TypeScript-6.0-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19.0-61dafb?logo=react&logoColor=black)](https://react.dev/)
[![Fastify](https://img.shields.io/badge/Fastify-5.0-000000?logo=fastify&logoColor=white)](https://fastify.dev/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-17-336791?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Redis](https://img.shields.io/badge/Redis-8-dc382d?logo=redis&logoColor=white)](https://redis.io/)
[![Docker](https://img.shields.io/badge/Docker-Sandboxed-2496ed?logo=docker&logoColor=white)](https://www.docker.com/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-v4-06b6d4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-d4af37.svg)](LICENSE)

---

## Overview

**theGrave** is an open-source real-time 1v1 battleground where developers duel head-to-head under strict time constraints. Move past solitary problem solving: queue up against live opponents, race to pass hidden test suites, or dive into broken multi-file production codebases to diagnose and patch live incident tickets.

Every match is executed inside hardened, isolated Docker sandboxes with millisecond-precision timing. Ratings are powered by the **Glicko-2** rating system with automatic volatility tracking and inactivity decay, surfacing on global and campus-specific leaderboards.

---

## Key Features

### ⚔️ Dual Battle Modes
* **DSA Showdowns**: 30 curated algorithmic challenges across Dynamic Programming, Graph Theory, Trees, Greedy algorithms, and Data Structures.
  * Multi-language support: **Python 3** and **C++20**.
  * LeetCode-style function signatures with transparent stdin/stdout test harnesses.
  * Tie-breaking decided strictly by **submission timestamp**, not judge queue latency.
* **Systems & Programming Battles**: Real-world multi-file software engineering incident scenarios (e.g. Distributed Job Queues, Order Pricing Engines, Concurrency race conditions).
  * In-browser IDE workspace with file tree explorer, Monaco code editor, test runner terminal, and diff inspection.
  * Solved against both public test suites and hidden validation tests.

### 🎮 Custom Rooms & Practice Mode
* **Private Duels**: Create private lobbies with 6-character room codes (`/play?room=CODE`) and instant shareable invite links.
  * Host-configurable difficulty (Auto, Easy, Medium, Hard).
  * Mutual ready checks, unrated friendly gameplay that doesn't artificially inflate leaderboard standing.
* **Solo Practice**: Unclocked solo sandbox to hone problem solving and debugging skills with local draft auto-saving.

### 📈 Glicko-2 Rating & Campus Leaderboards
* **Statistical Rating Engine**: Full Glicko-2 implementation (rating, deviation $RD$, and volatility $\sigma$).
* **Idle Rating Decay**: Automatic rating deviation expansion over time for inactive accounts to ensure accurate match quality.
* **Campus & Global Leaderboards**: Filter rankings globally or restrict views to your university/institution.
* **Rich Profiles**: Visual rating trajectory charts, head-to-head match history, Win/Loss/Draw statistics, customizable avatars, and player search.

### 🤖 Progressive AI Coach
* **Context-Aware Hints**: Powered by Claude 3.5 Sonnet, DeepSeek, or Groq.
* **Pedagogical Guardrails**: Delivers directional nudges and conceptual hints without revealing exact code or spoiling solutions.
* **Fair Play**: AI hints are permanently disabled during active ranked and unrated duels.

### 🛡️ Sandboxing & Production Security
* **Hermetic Docker Sandbox**: Code execution runs inside unprivileged, ephemeral containers with `--network none`, strict cgroup v2 memory limits (256 MB), CPU quotas, and dropped Linux capabilities.
* **Authentication**: Argon2id password hashing, rotating JWT access tokens, refresh token family reuse detection, and email OTP verification via SMTP / Mailjet.

---

## Architecture

```
                       Browser (React 19 SPA, Monaco Editor)
                          │                         │
                   HTTPS (REST API)          WSS (Socket.IO)
                          ▼                         ▼
  ┌────────────────────────────────────────────────────────────────────────┐
  │         Fastify 5 API Gateway + Socket.IO Distributed Nodes            │
  │  ────────────────────────────────────────────────────────────────────  │
  │  • Auth & User Profiles   • Matchmaker (Lua)      • Room Management    │
  │  • Problem Catalog        • Battle State Machine  • Progressive Hints  │
  └───────────────┬───────────────────────┬────────────────────────┬───────┘
                  │                       │                        │
                  ▼                       ▼                        ▼
       PostgreSQL 17 (Prisma 7)     Redis 8 Cluster          BullMQ Queue
       • Source of Truth            • ZSET Matchmaking Queue       │
       • Users & Credentials        • Lua State Leases             │
       • Problems & Test Cases      • Realtime Pub/Sub Adapter     ▼
       • Match & Submission History • Rate Limiting & Presence  Judge Workers
                                                                (Docker Sandbox)
                                                                docker run
                                                                --network none
                                                                --memory 256m
```

---

## Monorepo Layout

```
theGrave/
├── apps/
│   ├── server/             # Fastify 5 REST API, Socket.IO server, BullMQ judge workers
│   │   ├── prisma/         # Prisma 7 schema & SQL migrations
│   │   ├── src/battle/     # Match state machine, problem selector, timer queues
│   │   ├── src/hints/      # Progressive AI hint engine (Anthropic, DeepSeek, Groq)
│   │   ├── src/judge/      # Docker sandboxed code runner & test harness drivers
│   │   ├── src/matchmaking/# Redis Lua script matchmaking engine
│   │   ├── src/rating/     # Glicko-2 rating update & decay workers
│   │   ├── src/realtime/   # Socket.IO connection handling & event routing
│   │   └── src/rooms/      # Private room lobby manager
│   └── web/                # React 19 SPA with Vite 8 & Tailwind CSS v4
│       ├── src/components/ # Arena workspace, Monaco editor, splitters, lobby
│       ├── src/pages/      # Landing, Play, Battle, Practice, Profile, Leaderboard
│       └── src/stores/     # Zustand stores (Auth, Lobby, Room, Battle)
├── packages/
│   └── shared/             # Shared TypeScript types, Zod schemas, socket contracts
├── deploy/                 # Dockerfile.server, Dockerfile.web, Caddyfile, backup scripts
├── e2e/                    # Playwright end-to-end multi-browser test suite
├── docker-compose.yml      # Local development Postgres 17, Redis 8, Mailpit
├── docker-compose.prod.yml # Production multi-container orchestration
└── production.md           # Production deployment & operations runbook
```

---

## Getting Started

### Prerequisites
* **Node.js**: `v24.x` or later (see `.nvmrc`)
* **pnpm**: `v10.x`
* **Docker & Docker Compose**: Required for Postgres, Redis, and code execution sandboxes

### Quickstart

1. **Clone the repository and install dependencies:**
   ```bash
   git clone https://github.com/VanshP018/TheGrave.git
   cd TheGrave
   pnpm install
   ```

2. **Start backing services (PostgreSQL, Redis, Mailpit):**
   ```bash
   pnpm infra:up
   ```
   * *Postgres*: `localhost:5442`
   * *Redis*: `localhost:6389`
   * *Mailpit (local mail catcher)*: Web UI at `http://localhost:8025`

3. **Configure environment variables:**
   ```bash
   cp apps/server/.env.example apps/server/.env
   # Edit apps/server/.env to configure JWT secrets, AI hint keys, or SMTP settings
   ```

4. **Build shared packages and migrate database:**
   ```bash
   pnpm --filter @thegrave/shared build
   pnpm --filter @thegrave/server db:migrate
   pnpm --filter @thegrave/server db:generate
   pnpm --filter @thegrave/server db:seed
   ```

5. **Build execution sandbox images:**
   ```bash
   # Sandbox image for algorithmic code execution (Python / C++)
   pnpm --filter @thegrave/server judge:build

   # Sandbox image for multi-file programming workspace challenges
   pnpm --filter @thegrave/server workspace:build
   ```

6. **Start local development servers:**
   ```bash
   pnpm dev
   ```
   * **Web Client**: [http://localhost:5173](http://localhost:5173) (Landing at `/`, Arena lobby at `/play`)
   * **API Gateway**: [http://localhost:4000](http://localhost:4000) (`/health`, `/api`)
   * **Mailpit Inbox**: [http://localhost:8025](http://localhost:8025)

---

## Testing & Quality

theGrave includes a comprehensive test suite across unit, integration, stress, and multi-browser E2E tiers:

```bash
# Typecheck all packages
pnpm typecheck

# Lint workspace
pnpm lint

# Integration tests (Fastify, Prisma, Redis, Glicko-2 math, Matchmaker)
pnpm test

# Run 200-client matchmaking concurrency stress tests
pnpm --filter @thegrave/server test test/matchmaking-stress.test.ts

# Install Playwright browser engines (first-time only)
pnpm exec playwright install chromium

# Multi-browser concurrent battle and rating E2E test suite
pnpm test:e2e
```

---

## Production Deployment

A battle-tested production setup is provided with Caddy (automatic Let's Encrypt TLS, HTTP/3, and hardened CSP), minimal multi-stage Docker builds, read-only containers, and automated database backup routines.

To review the complete production guide, server preparation steps, and operational runbook:
👉 **See [production.md](./production.md)**

```bash
# Build production images
docker compose -f docker-compose.prod.yml --profile images build

# Run production stack
docker compose -f docker-compose.prod.yml up -d
```

---

## Documentation

* **[production.md](./production.md)** — Production deployment, secrets management, judge worker security, and rollback instructions.

---

## Author

Crafted by **Vansh Panwar** ([@VanshP018](https://github.com/VanshP018))

* GitHub: [@VanshP018](https://github.com/VanshP018)
* Email: [vanshpanwar500005@gmail.com](mailto:vanshpanwar500005@gmail.com)

---

## License

Distributed under the [MIT License](LICENSE).
