"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth";

/** Home. Logged out → /login. Logged in → (for now) who you are; Step 2 adds workspaces. */
export default function Home() {
  const { state, logout } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (state.status === "anonymous") router.replace("/login");
  }, [state.status, router]);

  if (state.status === "error") {
    return <Centered>{state.message}</Centered>;
  }
  if (state.status !== "authenticated") {
    return <Centered>Loading…</Centered>;
  }

  const { user } = state;
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 px-4 py-16">
      <div className="flex items-center gap-3">
        {user.avatarUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- external avatar URLs, no optimization needed
          <img src={user.avatarUrl} alt="" className="h-10 w-10 rounded-full" />
        )}
        <div>
          <p className="font-medium">{user.name ?? user.email}</p>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">{user.email}</p>
        </div>
      </div>
      <button
        type="button"
        onClick={async () => {
          await logout();
          router.replace("/login");
        }}
        className="self-start rounded-lg border border-zinc-300 px-4 py-2 text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
      >
        Log out
      </button>
    </main>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <main className="flex flex-1 items-center justify-center text-zinc-600 dark:text-zinc-400">{children}</main>;
}
