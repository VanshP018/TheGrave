# theGrave

Real-time 1v1 coding battles. See [PLAN.md](./PLAN.md) for the roadmap and [decision.md](./decision.md) for the decision log.

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
pnpm dev                                       # api :4000, judge worker, web :5173
pnpm test                                      # integration tests (needs infra:up; uses thegrave_test DB)
```
