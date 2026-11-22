"use client";

import { type DocumentSummary, roleAllows, roleAtLeast, type Workspace } from "@kw/shared";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useCreateDocument, useDeleteDocument, useDocuments } from "@/lib/documents";
import { ancestorIds, buildTree, descendantIds, type TreeNode } from "@/lib/tree";

/**
 * The sidebar's page tree. Buttons appear only when your role allows the action,
 * but that's for UX: the API enforces the same rules on every request.
 */
export function PageTree({ workspace }: { workspace: Workspace }) {
  const { docId: activeId } = useParams<{ docId?: string }>();
  const router = useRouter();
  const documents = useDocuments(workspace.id);
  const create = useCreateDocument(workspace.id);
  const remove = useDeleteDocument(workspace.id);
  const [error, setError] = useState<string | null>(null);

  // Explicit expand/collapse clicks. Rows without an entry fall back to "open if it's
  // an ancestor of the page you're on", so the tree reveals the current page by itself.
  const [toggled, setToggled] = useState<Map<string, boolean>>(new Map());
  const docs = useMemo(() => documents.data ?? [], [documents.data]);
  const tree = useMemo(() => buildTree(docs), [docs]);
  const activeAncestors = useMemo(() => new Set(activeId ? ancestorIds(docs, activeId) : []), [docs, activeId]);

  const setOpen = (id: string, open: boolean) => setToggled((prev) => new Map(prev).set(id, open));

  const createPage = (parentId?: string) => {
    setError(null);
    create.mutate(
      { parentId },
      {
        onSuccess: (doc) => {
          if (parentId) setOpen(parentId, true);
          router.push(`/w/${workspace.id}/d/${doc.id}`);
        },
        onError: () => setError("Couldn't create the page."),
      },
    );
  };

  const deletePage = (doc: DocumentSummary) => {
    const below = descendantIds(docs, doc.id);
    const message = below.length
      ? `Delete "${doc.title}" and its ${below.length} sub-page${below.length === 1 ? "" : "s"}?`
      : `Delete "${doc.title}"?`;
    if (!window.confirm(message)) return;

    setError(null);
    const leavingActive = activeId !== undefined && (activeId === doc.id || below.includes(activeId));
    remove.mutate(doc.id, {
      onSuccess: () => {
        if (leavingActive) router.push(`/w/${workspace.id}`);
      },
      onError: () => setError("Couldn't delete the page."),
    });
  };

  const canCreateTopLevel = roleAtLeast(workspace.role, "EDITOR");

  return (
    <div className="flex flex-col gap-1 text-sm">
      <div className="flex items-center justify-between px-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
        <span>Pages</span>
        {canCreateTopLevel && (
          <IconButton label="New page" onClick={() => createPage()} disabled={create.isPending}>
            +
          </IconButton>
        )}
      </div>

      {error && (
        <p role="alert" className="px-2 text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      {documents.isError ? (
        <p className="px-2 text-zinc-500">Couldn&apos;t load pages.</p>
      ) : !documents.data ? (
        <p className="px-2 text-zinc-500">Loading…</p>
      ) : tree.length === 0 ? (
        <p className="px-2 text-zinc-500">{canCreateTopLevel ? "No pages yet. Click + to add one." : "No pages yet."}</p>
      ) : (
        <ul>
          {tree.map((node) => (
            <TreeRow
              key={node.doc.id}
              node={node}
              depth={0}
              workspaceId={workspace.id}
              activeId={activeId}
              isOpen={(id) => toggled.get(id) ?? activeAncestors.has(id)}
              setOpen={setOpen}
              onCreateChild={createPage}
              onDelete={deletePage}
              busy={create.isPending || remove.isPending}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

interface RowProps {
  node: TreeNode;
  depth: number;
  workspaceId: string;
  activeId: string | undefined;
  isOpen: (id: string) => boolean;
  setOpen: (id: string, open: boolean) => void;
  onCreateChild: (parentId: string) => void;
  onDelete: (doc: DocumentSummary) => void;
  busy: boolean;
}

function TreeRow(props: RowProps) {
  const { node, depth, workspaceId, activeId, isOpen, setOpen, onCreateChild, onDelete, busy } = props;
  const { doc, children } = node;
  const open = isOpen(doc.id);
  const active = doc.id === activeId;

  return (
    <li>
      <div
        className="group flex items-center gap-0.5 rounded-md pr-1 hover:bg-zinc-200/60 data-[active=true]:bg-zinc-200 dark:hover:bg-zinc-800 dark:data-[active=true]:bg-zinc-800"
        data-active={active}
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
      >
        {children.length > 0 ? (
          <button
            type="button"
            aria-label={open ? `Collapse ${doc.title}` : `Expand ${doc.title}`}
            aria-expanded={open}
            onClick={() => setOpen(doc.id, !open)}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-zinc-500 hover:bg-zinc-300/60 dark:hover:bg-zinc-700"
          >
            <span aria-hidden className={`text-[10px] transition-transform ${open ? "rotate-90" : ""}`}>
              ▶
            </span>
          </button>
        ) : (
          <span className="w-5 shrink-0" aria-hidden />
        )}

        <Link
          href={`/w/${workspaceId}/d/${doc.id}`}
          aria-current={active ? "page" : undefined}
          className="min-w-0 flex-1 truncate py-1 aria-[current=page]:font-medium"
        >
          {doc.title}
        </Link>

        {/* Row actions: shown on hover, and on keyboard focus. */}
        <div className="flex shrink-0 gap-0.5 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
          {roleAllows(doc.role, "edit") && (
            <IconButton label={`Add a page inside ${doc.title}`} onClick={() => onCreateChild(doc.id)} disabled={busy}>
              +
            </IconButton>
          )}
          {roleAllows(doc.role, "manage") && (
            <IconButton label={`Delete ${doc.title}`} onClick={() => onDelete(doc)} disabled={busy}>
              ×
            </IconButton>
          )}
        </div>
      </div>

      {open && children.length > 0 && (
        <ul>
          {children.map((child) => (
            <TreeRow key={child.doc.id} {...props} node={child} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

function IconButton(props: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={props.label}
      title={props.label}
      onClick={props.onClick}
      disabled={props.disabled}
      className="flex h-5 w-5 items-center justify-center rounded text-base leading-none text-zinc-500 hover:bg-zinc-300/60 hover:text-zinc-900 disabled:opacity-40 dark:hover:bg-zinc-700 dark:hover:text-zinc-100"
    >
      {props.children}
    </button>
  );
}
