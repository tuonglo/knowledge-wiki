"use client";

import { useParams } from "next/navigation";
import { Centered } from "@/components/centered";
import { PageTitle } from "@/components/page-title";
import { ApiError } from "@/lib/api";
import { useDocument } from "@/lib/documents";

/** One page. Step 5 replaces the placeholder body with the editor. */
export default function DocumentPage() {
  const { docId } = useParams<{ docId: string }>();
  const doc = useDocument(docId);

  if (doc.error) {
    // The API answers 404 both for "doesn't exist" and "not yours", so the UI can't tell either.
    return (
      <Centered>
        {doc.error instanceof ApiError && doc.error.status === 404
          ? "This page doesn't exist, or you don't have access to it."
          : "Couldn't load this page. Try reloading."}
      </Centered>
    );
  }
  if (!doc.data) return <Centered>Loading…</Centered>;

  return (
    <article className="mx-auto w-full max-w-3xl px-8 py-16">
      {/* key: start with a fresh draft when you navigate to a different page. */}
      <PageTitle key={doc.data.id} doc={doc.data} />
      <p className="mt-2 text-xs uppercase tracking-wide text-zinc-500">{doc.data.role.toLowerCase()}</p>
    </article>
  );
}
