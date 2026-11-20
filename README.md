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
cp .env.example .env                 # set POSTGRES_PORT if 5432 is taken; add OAuth values (below)
pnpm install
pnpm --filter @kw/api gen:keys       # JWT signing keys → .env (the API won't start without them)
docker compose --profile app up --build   # everything in Docker; migrations run automatically
```

Or, for development, run only the databases in Docker and the apps on your machine:

```bash
pnpm db:up
pnpm db:migrate                  # apply database migrations
pnpm dev                         # web :3000, api :4000
cd services/ai && uv sync && uv run kw-ai   # ai :8000
```

## OAuth setup

Login needs a GitHub and a Google OAuth app. Put their values in `.env`.

- **GitHub:** Settings → Developer settings → OAuth Apps → New.
  Callback URL: `http://localhost:4000/auth/github/callback`
- **Google:** Cloud Console → Google Auth Platform → Clients → Create client (Web application).
  Redirect URI: `http://localhost:4000/auth/google/callback`. While the app is in Testing mode,
  add your account under Audience → Test users.

## Auth

```
Browser → GET /auth/github ──► GitHub/Google ──► GET /auth/github/callback
          (state + PKCE cookies)                 (checks state, finds/creates user,
                                                  sets httpOnly refresh cookie)
Web app → POST /auth/refresh  → { accessToken (15 min, RS256 JWT), expiresIn }
          (rotates the refresh cookie; reusing an old one revokes the whole session)
API calls → Authorization: Bearer <accessToken>
```

- **Access token:** short-lived JWT holding only the user id. Roles are checked in the database
  on every request, so permission changes apply immediately.
- **Refresh token:** random, stored hashed, `httpOnly; SameSite=Lax; Path=/auth`, rotated on every use.

## Permissions

A user's role on a document is the **highest** of their workspace role and any grant on that
page **or any parent page**. The rule lives in one place, the SQL function `kw_document_roles`,
which the API and the AI service both use.

| Action   | Minimum role |
| -------- | ------------ |
| `view`   | VIEWER       |
| `edit`   | EDITOR       |
| `manage` | OWNER        |

No access returns **404**, not 403, so outsiders can't confirm that a document exists.
**403** means you can see it but not do that.

## API

All routes except `/health` and `/auth/*` need `Authorization: Bearer <token>`.

| Route                                        | Who                          |
| -------------------------------------------- | ---------------------------- |
| `GET /health`                                | anyone                       |
| `GET /auth/{github,google}` (+ `/callback`)  | anyone (login)               |
| `POST /auth/refresh`, `POST /auth/logout`    | refresh cookie               |
| `GET /me`                                    | logged in                    |
| `POST /workspaces`, `GET /workspaces`        | logged in (creator → OWNER)  |
| `GET /workspaces/:id/members`                | member                       |
| `POST /workspaces/:id/members`               | OWNER (invite by email)      |
| `PATCH`/`DELETE /workspaces/:id/members/:uid`| OWNER, or yourself to leave  |
| `GET /workspaces/:id/documents`              | pages you can view           |
| `POST /workspaces/:id/documents`             | EDITOR, or edit on parent    |
| `GET`/`PATCH`/`DELETE /documents/:id`        | view / edit / manage         |

A workspace always keeps at least one OWNER (`409 last_owner`).

## Checks

API tests run against a real Postgres (a separate `kw_test` database, created automatically),
so start it first with `pnpm db:up`.

```bash
pnpm lint && pnpm typecheck && pnpm test
cd services/ai && uv run ruff check . && uv run pytest
```
