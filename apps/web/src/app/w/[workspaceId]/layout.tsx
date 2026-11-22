import { Suspense } from "react";
import { AppShell } from "@/components/app-shell";
import { Centered } from "@/components/centered";

/**
 * The workspace id is only known per request, so with cacheComponents anything that
 * reads it must sit inside <Suspense>. Next prerenders the fallback as the static
 * shell and fills in the rest in the browser.
 */
export default function WorkspaceLayout({ children }: LayoutProps<"/w/[workspaceId]">) {
  return (
    <Suspense fallback={<Centered>Loading…</Centered>}>
      <AppShell>{children}</AppShell>
    </Suspense>
  );
}
