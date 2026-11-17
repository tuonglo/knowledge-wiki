"use client";

import { HealthResponse } from "@kw/shared";
import { useEffect, useState } from "react";

type State = "checking" | "ok" | "degraded" | "unreachable";

const styles: Record<State, string> = {
  checking: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  ok: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  degraded: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  unreachable: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
};

export function ServiceStatus({ name, url }: { name: string; url: string }) {
  const [state, setState] = useState<State>("checking");

  useEffect(() => {
    let cancelled = false;
    fetch(`${url}/health`)
      .then((res) => res.json())
      .then((json) => {
        const parsed = HealthResponse.safeParse(json);
        if (!cancelled) setState(parsed.success ? parsed.data.status : "unreachable");
      })
      .catch(() => !cancelled && setState("unreachable"));
    return () => {
      cancelled = true;
    };
  }, [url]);

  return (
    <li className="flex items-center justify-between rounded-lg border border-zinc-200 px-4 py-3 dark:border-zinc-800">
      <span className="font-medium">{name}</span>
      <span className={`rounded-full px-2.5 py-0.5 text-sm ${styles[state]}`}>{state}</span>
    </li>
  );
}
