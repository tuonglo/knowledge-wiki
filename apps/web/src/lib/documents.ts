"use client";

/** Page (document) data hooks. */
import { DocumentDetail, DocumentSummary } from "@kw/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { apiFetch } from "./api";
import { descendantIds } from "./tree";
import { queryKeys } from "./workspaces";

/** Every page in the workspace that I can see, with my role on each (flat; see buildTree). */
export function useDocuments(workspaceId: string) {
  return useQuery({
    queryKey: queryKeys.documents(workspaceId),
    queryFn: () => apiFetch(`/workspaces/${encodeURIComponent(workspaceId)}/documents`, {}, z.array(DocumentSummary)),
  });
}

export function useDocument(id: string) {
  return useQuery({
    queryKey: queryKeys.document(id),
    queryFn: () => apiFetch(`/documents/${encodeURIComponent(id)}`, {}, DocumentDetail),
  });
}

/** The fields POST returns. It has no `role`: the list refetch below fills that in. */
const CreatedDocument = DocumentDetail.omit({ role: true });

export function useCreateDocument(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { title?: string; parentId?: string }) =>
      apiFetch(`/workspaces/${encodeURIComponent(workspaceId)}/documents`, { method: "POST", body: input }, CreatedDocument),
    // Refetch the list rather than guessing the new page's role: on a sub-page it's
    // inherited from grants, and only the server knows them.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.documents(workspaceId) }),
  });
}

export function useRenameDocument(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) =>
      apiFetch(`/documents/${encodeURIComponent(id)}`, { method: "PATCH", body: { title } }, CreatedDocument),
    // Update both caches in place, so the sidebar and the page show the new title at once.
    onSuccess: (doc) => {
      queryClient.setQueryData<DocumentSummary[]>(queryKeys.documents(workspaceId), (old) =>
        old?.map((d) => (d.id === doc.id ? { ...d, title: doc.title } : d)),
      );
      queryClient.setQueryData<DocumentDetail>(queryKeys.document(doc.id), (old) => old && { ...old, ...doc });
    },
  });
}

export function useDeleteDocument(workspaceId: string) {
  const queryClient = useQueryClient();
  const listKey = queryKeys.documents(workspaceId);
  return useMutation({
    mutationFn: (id: string) => apiFetch(`/documents/${encodeURIComponent(id)}`, { method: "DELETE" }),
    onSuccess: (_result, id) => {
      // The server cascades to sub-pages, so drop them from the cache too.
      const docs = queryClient.getQueryData<DocumentSummary[]>(listKey) ?? [];
      const gone = new Set([id, ...descendantIds(docs, id)]);
      queryClient.setQueryData<DocumentSummary[]>(listKey, docs.filter((d) => !gone.has(d.id)));
      for (const goneId of gone) queryClient.removeQueries({ queryKey: queryKeys.document(goneId) });
      return queryClient.invalidateQueries({ queryKey: listKey });
    },
  });
}
