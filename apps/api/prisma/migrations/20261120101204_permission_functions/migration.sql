-- CreateIndex
CREATE INDEX "Document_parentId_idx" ON "Document"("parentId");

-- ---------------------------------------------------------------------------
-- Permission rule — the SINGLE source of truth for "who can see/edit what".
-- Hand-written (Prisma doesn't model SQL functions). Used by:
--   * the Node API (permissions.ts) for single-document checks
--   * the Python AI service (Phase 4), JOINed into vector search so retrieval
--     only ever considers documents the user may view
--
-- Effective role on a document = the highest of:
--   1. the user's workspace role (Membership) — covers every doc in the workspace
--   2. any DocumentPermission grant on the doc OR ANY ANCESTOR page
--      (sharing a page shares its sub-pages)
-- No row returned = no access.
--
-- Relies on the "Role" enum's declaration order (VIEWER < EDITOR < OWNER):
-- Postgres compares enums by that order, so max(role) picks the highest.
-- ---------------------------------------------------------------------------
CREATE FUNCTION kw_document_roles(p_user_id text)
RETURNS TABLE (document_id text, role "Role")
LANGUAGE sql
STABLE -- reads but never writes; lets Postgres optimize calls within one query
AS $$
  WITH RECURSIVE granted (document_id, role) AS (
      -- start: pages granted to this user directly
      SELECT dp."documentId", dp.role
      FROM "DocumentPermission" dp
      WHERE dp."userId" = p_user_id
    UNION -- not UNION ALL: dedupes, so even a corrupt parent cycle terminates
      -- repeat: children of anything already granted inherit the grant
      SELECT child.id, g.role
      FROM "Document" child
      JOIN granted g ON child."parentId" = g.document_id
  ),
  via_membership (document_id, role) AS (
    SELECT d.id, m.role
    FROM "Document" d
    JOIN "Membership" m ON m."workspaceId" = d."workspaceId"
    WHERE m."userId" = p_user_id
  )
  SELECT document_id, max(role)
  FROM (
    SELECT * FROM granted
    UNION ALL
    SELECT * FROM via_membership
  ) AS all_roles
  GROUP BY document_id
$$;
