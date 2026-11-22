/**
 * Turning the API's flat page list into the sidebar tree. Pure functions, no React,
 * so they're easy to test.
 */
import type { DocumentSummary } from "@kw/shared";

export interface TreeNode {
  doc: DocumentSummary;
  children: TreeNode[];
}

/**
 * Group pages under their parents, keeping the API's order (oldest first).
 *
 * A page whose parent ISN'T in the list becomes a root. That happens when someone
 * shares a sub-page with you but not its parent: you can see it, so it must show up
 * somewhere, but showing its parent would leak a page you can't access.
 */
export function buildTree(docs: DocumentSummary[]): TreeNode[] {
  const nodes = new Map(docs.map((doc) => [doc.id, { doc, children: [] as TreeNode[] }]));
  const roots: TreeNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.doc.parentId ? nodes.get(node.doc.parentId) : undefined;
    (parent ? parent.children : roots).push(node);
  }
  return roots;
}

/** Ids of the page's ancestors that are in the list, nearest first. Used to auto-expand to the open page. */
export function ancestorIds(docs: DocumentSummary[], id: string): string[] {
  const byId = new Map(docs.map((d) => [d.id, d]));
  const result: string[] = [];
  const seen = new Set<string>([id]); // guards against a cycle in bad data
  let parentId = byId.get(id)?.parentId;
  while (parentId && byId.has(parentId) && !seen.has(parentId)) {
    result.push(parentId);
    seen.add(parentId);
    parentId = byId.get(parentId)?.parentId;
  }
  return result;
}

/** Ids of every page under `id` (not including it). Deleting `id` deletes all of these too. */
export function descendantIds(docs: DocumentSummary[], id: string): string[] {
  const childrenOf = new Map<string, string[]>();
  for (const d of docs) {
    if (d.parentId) childrenOf.set(d.parentId, [...(childrenOf.get(d.parentId) ?? []), d.id]);
  }
  const result: string[] = [];
  const stack = [...(childrenOf.get(id) ?? [])];
  while (stack.length > 0) {
    const next = stack.pop()!;
    if (result.includes(next) || next === id) continue;
    result.push(next);
    stack.push(...(childrenOf.get(next) ?? []));
  }
  return result;
}
