# Knowledge Wiki

Real-time collaborative wiki with a permission-aware RAG assistant.

| Path              | What                                                  |
| ----------------- | ----------------------------------------------------- |
| `apps/web`        | Next.js (App Router) + Tailwind                       |
| `apps/api`        | Node/Express + Prisma: auth, permissions, WebSockets  |
| `services/ai`     | FastAPI (+ LlamaIndex later): indexing worker and RAG |
| `packages/shared` | Shared zod schemas/types                              |

## Run it

```bash
cp .env.example .env            # set POSTGRES_PORT if 5432 is taken
docker compose --profile app up --build   # everything in Docker
```

Or, for development, run only the databases in Docker and the apps on your machine:

```bash
pnpm install
pnpm db:up
pnpm dev                         # web :3000, api :4000
cd services/ai && uv sync && uv run kw-ai   # ai :8000
```

## Checks

```bash
pnpm lint && pnpm typecheck && pnpm test
cd services/ai && uv run ruff check . && uv run pytest
```
