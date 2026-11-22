"use client";

import { roleAllows } from "@kw/shared";
import { useParams } from "next/navigation";
import { Centered } from "@/components/centered";
import { PageEditor } from "@/components/page-editor";
import { PageTitle } from "@/components/page-title";
import { ApiError } from "@/lib/api";
import { useDocument } from "@/lib/documents";

/** One page: editable title + rich-text body (read-only for viewers). */
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
      {!roleAllows(doc.data.role, "edit") && (
        <p className="mt-2 text-xs uppercase tracking-wide text-zinc-500">View only</p>
      )}
      <div className="mt-6">
        <PageEditor docId={doc.data.id} editable={roleAllows(doc.data.role, "edit")} />
      </div>
    </article>
  );
}
