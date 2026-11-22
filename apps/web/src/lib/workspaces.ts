"use client";

/** Workspace data hooks. Every query key lives here, so cache invalidation stays consistent. */
import { Workspace } from "@kw/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { apiFetch } from "./api";

export const queryKeys = {
  workspaces: ["workspaces"] as const,
  /** The page list (sidebar tree) of one workspace. */
  documents: (workspaceId: string) => ["workspaces", workspaceId, "documents"] as const,
  document: (id: string) => ["documents", id] as const,
};

export function useWorkspaces() {
  return useQuery({
    queryKey: queryKeys.workspaces,
    queryFn: () => apiFetch("/workspaces", {}, z.array(Workspace)),
  });
}

export function useCreateWorkspace() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => apiFetch("/workspaces", { method: "POST", body: { name } }, Workspace),
    // Put the new workspace into the cached list right away, then refetch to be sure.
    onSuccess: (created) => {
      queryClient.setQueryData<Workspace[]>(queryKeys.workspaces, (old) => [...(old ?? []), created]);
      return queryClient.invalidateQueries({ queryKey: queryKeys.workspaces });
    },
  });
}

// ---- remembering the last workspace (a per-browser convenience, so localStorage is fine) ----

const LAST_WORKSPACE_KEY = "kw:lastWorkspace";

export function rememberWorkspace(id: string) {
  try {
    localStorage.setItem(LAST_WORKSPACE_KEY, id);
  } catch {
    // Private mode or blocked storage: just don't remember.
  }
}

/** Where "/" should send you: the last workspace you used if you still have it, else the first. */
export function pickWorkspace(workspaces: Workspace[]): Workspace | undefined {
  let last: string | null = null;
  try {
    last = localStorage.getItem(LAST_WORKSPACE_KEY);
  } catch {}
  return workspaces.find((w) => w.id === last) ?? workspaces[0];
}
