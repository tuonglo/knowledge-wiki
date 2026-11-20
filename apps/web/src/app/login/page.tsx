import { Suspense } from "react";
import { loginUrl } from "@/lib/api";

/** Error codes the API's OAuth callback can send back (see apps/api/src/auth/routes.ts). */
const ERROR_MESSAGES: Record<string, string> = {
  cancelled: "Login was cancelled.",
  unverified_email: "Your account needs a verified email address. Verify it with the provider, then try again.",
  login_failed: "Something went wrong while logging in. Please try again.",
};

/**
 * The page itself is static (pre-rendered at build time). Only the error message
 * depends on the URL, so only it waits inside <Suspense> — required by
 * `cacheComponents`, which pre-renders everything outside Suspense boundaries.
 */
export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-4 py-16">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Knowledge Wiki</h1>
        <p className="text-zinc-600 dark:text-zinc-400">Log in to continue</p>
      </div>

      <Suspense>
        <LoginError searchParams={searchParams} />
      </Suspense>

      {/* Plain links, not fetch(): OAuth needs a full-page navigation to the provider. */}
      <div className="flex flex-col gap-2">
        <a
          href={loginUrl("github")}
          className="rounded-lg bg-zinc-900 px-4 py-2.5 text-center font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          Continue with GitHub
        </a>
        <a
          href={loginUrl("google")}
          className="rounded-lg border border-zinc-300 px-4 py-2.5 text-center font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
        >
          Continue with Google
        </a>
      </div>
    </main>
  );
}

async function LoginError({ searchParams }: { searchParams: PageProps<"/login">["searchParams"] }) {
  const { error } = await searchParams;
  if (typeof error !== "string") return null;
  return (
    <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-300">
      {ERROR_MESSAGES[error] ?? ERROR_MESSAGES.login_failed}
    </p>
  );
}
