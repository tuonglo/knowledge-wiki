"use client";

import type { Me } from "@kw/shared";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { type ReactNode, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { rememberWorkspace, useWorkspaces } from "@/lib/workspaces";
import { Centered } from "./centered";
import { PageTree } from "./page-tree";
import { RequireAuth } from "./require-auth";
import { WorkspaceSwitcher } from "./workspace-switcher";

/** Sidebar + main area for everything under /w/[workspaceId]. */
export function AppShell({ children }: { children: ReactNode }) {
  return <RequireAuth>{(user) => <Shell user={user}>{children}</Shell>}</RequireAuth>;
}

function Shell({ user, children }: { user: Me; children: ReactNode }) {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const workspaces = useWorkspaces();
  const current = workspaces.data?.find((w) => w.id === workspaceId);

  useEffect(() => {
    if (current) rememberWorkspace(current.id);
  }, [current]);

  if (workspaces.isError) return <Centered>Couldn&apos;t load your workspaces. Try reloading.</Centered>;
  if (!workspaces.data) return <Centered>Loading…</Centered>;
  if (!current) {
    // Not a member: same message whether it doesn't exist or isn't yours (like the API's 404).
    return (
      <Centered>
        <p>This workspace doesn&apos;t exist, or you don&apos;t have access to it.</p>
        <Link href="/" className="text-sm underline">
          Go to your workspaces
        </Link>
      </Centered>
    );
  }

  return (
    <div className="flex min-h-screen flex-1">
      <aside className="sticky top-0 flex h-screen w-64 shrink-0 flex-col gap-4 border-r border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900/40">
        {/* key: remount (= close the menu) when you switch workspace. */}
        <WorkspaceSwitcher key={current.id} current={current} workspaces={workspaces.data} />
        <nav aria-label="Pages" className="min-h-0 flex-1 overflow-y-auto">
          <PageTree key={current.id} workspace={current} />
        </nav>
        <UserMenu user={user} />
      </aside>
      <main className="flex min-w-0 flex-1 flex-col">{children}</main>
    </div>
  );
}

function UserMenu({ user }: { user: Me }) {
  const { logout } = useAuth();
  const router = useRouter();
  return (
    <div className="flex items-center gap-2 border-t border-zinc-200 pt-3 dark:border-zinc-800">
      {user.avatarUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- external avatar URLs, no optimization needed
        <img src={user.avatarUrl} alt="" className="h-7 w-7 rounded-full" />
      )}
      <span className="min-w-0 flex-1 truncate text-sm">{user.name ?? user.email}</span>
      <button
        type="button"
        onClick={async () => {
          await logout();
          router.replace("/login");
        }}
        className="rounded-md px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-200/60 dark:text-zinc-400 dark:hover:bg-zinc-800"
      >
        Log out
      </button>
    </div>
  );
}
