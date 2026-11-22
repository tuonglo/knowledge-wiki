"use client";

import type { Workspace } from "@kw/shared";
import Link from "next/link";
import { useState } from "react";
import { CreateWorkspaceForm } from "./create-workspace-form";

/**
 * The workspace menu at the top of the sidebar. Uses a native <details> element:
 * keyboard and screen-reader support for free, no dropdown library.
 */
export function WorkspaceSwitcher({ current, workspaces }: { current: Workspace; workspaces: Workspace[] }) {
  const [creating, setCreating] = useState(false);

  return (
    <details className="group relative">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-md px-2 py-1.5 font-medium hover:bg-zinc-200/60 dark:hover:bg-zinc-800">
        <span className="truncate">{current.name}</span>
        <span aria-hidden className="text-xs text-zinc-500 group-open:rotate-180">
          ▾
        </span>
      </summary>
      <div className="absolute left-0 right-0 z-10 mt-1 flex flex-col gap-1 rounded-lg border border-zinc-200 bg-white p-1 shadow-lg dark:border-zinc-800 dark:bg-zinc-950">
        <ul aria-label="Workspaces">
          {workspaces.map((w) => (
            <li key={w.id}>
              <Link
                href={`/w/${w.id}`}
                aria-current={w.id === current.id ? "page" : undefined}
                className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm hover:bg-zinc-100 aria-[current=page]:font-medium dark:hover:bg-zinc-900"
              >
                <span className="truncate">{w.name}</span>
                <span className="text-xs text-zinc-500">{w.role.toLowerCase()}</span>
              </Link>
            </li>
          ))}
        </ul>
        <hr className="border-zinc-200 dark:border-zinc-800" />
        {creating ? (
          <div className="p-2">
            <CreateWorkspaceForm autoFocus />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="rounded-md px-2 py-1.5 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-900"
          >
            + New workspace
          </button>
        )}
      </div>
    </details>
  );
}
