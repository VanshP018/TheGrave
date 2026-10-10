# theGrave

Real-time 1v1 coding battles. See [PLAN.md](./PLAN.md) for the roadmap and [decision.md](./decision.md) for the decision log.

## Quickstart

```bash
pnpm install
pnpm infra:up                                  # Postgres :5442, Redis :6389
cp apps/server/.env.example apps/server/.env   # then set real JWT secrets
pnpm --filter @thegrave/shared build
pnpm --filter @thegrave/server db:migrate
pnpm dev                                       # api :4000, web :5173
```
