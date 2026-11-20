import { ServiceStatus } from "@/components/service-status";

/** Health of the backends, reached through this app's /api and /ai proxies. */
export default function StatusPage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 px-4 py-16">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Knowledge Wiki</h1>
        <p className="text-zinc-600 dark:text-zinc-400">Service status</p>
      </div>
      <ul className="flex flex-col gap-2">
        <ServiceStatus name="API (Node)" url="/api" />
        <ServiceStatus name="AI (Python)" url="/ai" />
      </ul>
    </main>
  );
}
