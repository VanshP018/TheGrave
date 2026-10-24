# theGrave

Real-time 1v1 coding battles: DSA problems and debugging real codebases, with ratings, private rooms and an AI hint coach. See [PLAN.md](./PLAN.md) for the roadmap and [decision.md](./decision.md) for the decision log.

**Deploying?** [production.md](./production.md) is the step-by-step for putting it live on a server.

## Quickstart

```bash
pnpm install
pnpm infra:up                                  # Postgres :5442, Redis :6389
cp apps/server/.env.example apps/server/.env   # then set real JWT secrets
pnpm --filter @thegrave/shared build
pnpm --filter @thegrave/server db:migrate
pnpm --filter @thegrave/server db:generate     # Prisma 7: migrate no longer generates the client
pnpm --filter @thegrave/server db:seed         # 30 problems with hidden tests
pnpm --filter @thegrave/server judge:build     # sandbox image for the code judge
pnpm --filter @thegrave/server workspace:build # sandbox image for programming challenges
docker compose up -d mailpit                   # local inbox for registration codes: http://localhost:8025 (see .env.example)
pnpm dev                                       # api :4000, judge worker, web :5173 (landing at /, lobby at /play)
pnpm test                                      # integration tests (needs infra:up; uses thegrave_test DB)
pnpm exec playwright install chromium          # once
pnpm test:e2e                                  # two-browser battle E2E (isolated thegrave_e2e DB, real judge)
```
