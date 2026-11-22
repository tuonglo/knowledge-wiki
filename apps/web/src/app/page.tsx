"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Centered } from "@/components/centered";
import { CreateWorkspaceForm } from "@/components/create-workspace-form";
import { RequireAuth } from "@/components/require-auth";
import { pickWorkspace, useWorkspaces } from "@/lib/workspaces";

/** "/" only routes: to your last (or first) workspace, or to onboarding if you have none. */
export default function Home() {
  return <RequireAuth>{() => <PickWorkspace />}</RequireAuth>;
}

function PickWorkspace() {
  const workspaces = useWorkspaces();
  const router = useRouter();
  const target = workspaces.data && pickWorkspace(workspaces.data);

  useEffect(() => {
    if (target) router.replace(`/w/${target.id}`);
  }, [target, router]);

  if (workspaces.isError) return <Centered>Couldn&apos;t load your workspaces. Try reloading.</Centered>;
  if (!workspaces.data || target) return <Centered>Loading…</Centered>;

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 px-4 py-16">
      <div>
        <h1 className="text-2xl font-semibold">Create your first workspace</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          A workspace holds your pages and the people you share them with.
        </p>
      </div>
      <CreateWorkspaceForm autoFocus />
    </main>
  );
}
