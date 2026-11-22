"use client";

import type { Role } from "@kw/shared";
import { useParams } from "next/navigation";
import { useWorkspaces } from "@/lib/workspaces";

const ROLE_LABEL: Record<Role, string> = { OWNER: "an owner", EDITOR: "an editor", VIEWER: "a viewer" };

/** Workspace home. The shell already checked membership, so the workspace is in the cache. */
export default function WorkspaceHome() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const workspace = useWorkspaces().data?.find((w) => w.id === workspaceId);
  if (!workspace) return null;

  return (
    <div className="mx-auto w-full max-w-3xl px-8 py-16">
      <h1 className="text-3xl font-semibold">{workspace.name}</h1>
      <p className="mt-2 text-zinc-600 dark:text-zinc-400">
        You&apos;re {ROLE_LABEL[workspace.role]} of this workspace. Pick a page in the sidebar, or create one.
      </p>
    </div>
  );
}
