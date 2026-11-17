import { ServiceStatus } from "@/components/service-status";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const AI_URL = process.env.NEXT_PUBLIC_AI_URL ?? "http://localhost:8000";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 px-4 py-16">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Knowledge Wiki</h1>
        <p className="text-zinc-600 dark:text-zinc-400">Service status</p>
      </div>
      <ul className="flex flex-col gap-2">
        <ServiceStatus name="API (Node)" url={API_URL} />
        <ServiceStatus name="AI (Python)" url={AI_URL} />
      </ul>
    </main>
  );
}
