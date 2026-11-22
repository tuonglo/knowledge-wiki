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
  Callback URL: `http://localhost:3000/api/auth/github/callback`
- **Google:** Cloud Console → Google Auth Platform → Clients → Create client (Web application).
  Redirect URI: `http://localhost:3000/api/auth/google/callback`. While the app is in Testing mode,
  add your account under Audience → Test users.

## Auth

```
Browser → GET /api/auth/github ──► GitHub/Google ──► GET /api/auth/github/callback
          (state + PKCE cookies)                     (checks state, finds/creates user,
                                                      sets httpOnly refresh cookie)
Web app → POST /api/auth/refresh  → { accessToken (15 min, RS256 JWT), expiresIn }
          (rotates the refresh cookie; reusing an old one revokes the whole session)
API calls → Authorization: Bearer <accessToken>
```

- **Access token:** short-lived JWT holding only the user id. Roles are checked in the database
  on every request, so permission changes apply immediately.
- **Refresh token:** random, stored hashed, `httpOnly; SameSite=Lax; Path=/api/auth`, rotated on every use.

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

Paths are the API's own. Browsers reach them under `/api` (e.g. `/api/me`).
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
| `GET /documents/:id/content`                 | view                         |
| `PUT /documents/:id/content`                 | edit                         |

A workspace always keeps at least one OWNER (`409 last_owner`).

## Web app

The browser only talks to `localhost:3000`. Next.js forwards `/api/*` to the API and `/ai/*` to the
AI service, so everything is one origin: the refresh cookie is first-party and there's no CORS.

| Route                          | What                                                              |
| ------------------------------ | ----------------------------------------------------------------- |
| `/login`                       | GitHub / Google login                                             |
| `/`                            | Sends you to your last workspace (or "create your first one")     |
| `/w/[workspaceId]`             | App shell: workspace switcher, page tree, user menu               |
| `/w/[workspaceId]/d/[docId]`   | Editable title + Tiptap editor (read-only for viewers)            |

- **Access token** lives in memory only, never `localStorage`. Refreshes are single-flight within a tab
  and serialized across tabs with the Web Locks API, so concurrent refreshes can't trip reuse detection.
- **Server data** goes through TanStack Query (cache, dedupe, refetch); logging out clears the cache.
- **Page tree** is built from the flat page list. A page shared without its parent shows at the top level.
- **Editor**: Tiptap bound to a Yjs document, with Markdown shortcuts. Autosave waits for a 1 s pause
  (at most 10 s), sends one save at a time, and on `409` **merges** the newer server state into the local
  Y.Doc and saves again: two tabs editing one page both keep their edits. Network errors retry with
  backoff; `403`/`404` stop with a message. Logging out saves pending edits first.

## Document content

A page's content is stored three ways on the `Document` row:

- `content`: the editor's **Yjs** state (binary CRDT). The server checks that it decodes before saving.
- `markdown`: a plain-text copy for search and the AI indexer.
- `version`: +1 per save.

`PUT /documents/:id/content` takes `{ state (base64), markdown, baseVersion }` and saves only if
`baseVersion` is still the stored version (one atomic `UPDATE … WHERE version = baseVersion`).
Otherwise it returns `409 version_conflict` with `currentVersion`, so a stale tab can't overwrite
newer work. It accepts bodies up to 5 MB, read only after the edit permission check. Every other route
keeps a 100 kB limit (`413 payload_too_large`). Each save appends `{ documentId, workspaceId, version }` to the `doc.saved` Redis
Stream for the indexer.

## Checks

API tests run against a real Postgres (a separate `kw_test` database, created automatically)
and a real Redis (logical database 15), so start both first with `pnpm db:up`.

```bash
pnpm lint && pnpm typecheck && pnpm test
cd services/ai && uv run ruff check . && uv run pytest
```
