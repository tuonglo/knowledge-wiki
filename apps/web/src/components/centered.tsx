import type { ReactNode } from "react";

/** A full-height centered message: loading, errors, empty states. */
export function Centered({ children }: { children: ReactNode }) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 px-4 text-center text-zinc-600 dark:text-zinc-400">
      {children}
    </main>
  );
}
