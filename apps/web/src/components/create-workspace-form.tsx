"use client";

import { CreateWorkspaceBody } from "@kw/shared";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useCreateWorkspace } from "@/lib/workspaces";

/**
 * Name → POST /workspaces → go to the new workspace.
 * Validates with the SAME zod schema the API uses, so the rules can't drift apart.
 */
export function CreateWorkspaceForm({ autoFocus = false }: { autoFocus?: boolean }) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const create = useCreateWorkspace();
  const router = useRouter();

  return (
    <form
      className="flex w-full flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const parsed = CreateWorkspaceBody.safeParse({ name });
        if (!parsed.success) {
          setError("Enter a name (up to 100 characters).");
          return;
        }
        setError(null);
        create.mutate(parsed.data.name, {
          onSuccess: (workspace) => {
            setName("");
            router.push(`/w/${workspace.id}`);
          },
          onError: () => setError("Couldn't create the workspace. Try again."),
        });
      }}
    >
      <label htmlFor="workspace-name" className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
        Workspace name
      </label>
      <div className="flex gap-2">
        <input
          id="workspace-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Engineering"
          maxLength={100}
          autoFocus={autoFocus}
          className="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm dark:border-zinc-700"
        />
        <button
          type="submit"
          disabled={create.isPending}
          className="rounded-lg bg-zinc-900 px-4 py-2 text-sm text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {create.isPending ? "Creating…" : "Create"}
        </button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </form>
  );
}
