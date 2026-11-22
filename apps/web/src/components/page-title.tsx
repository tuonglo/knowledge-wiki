"use client";

import { type DocumentDetail, roleAllows, UpdateDocumentBody } from "@kw/shared";
import { useState } from "react";
import { useRenameDocument } from "@/lib/documents";

/**
 * The page title: plain text if you can only view, an input if you can edit.
 * Saves on Enter or when you click away; Escape cancels.
 */
export function PageTitle({ doc }: { doc: DocumentDetail }) {
  const rename = useRenameDocument(doc.workspaceId);
  const [draft, setDraft] = useState(doc.title);
  const [error, setError] = useState<string | null>(null);

  if (!roleAllows(doc.role, "edit")) {
    return <h1 className="text-4xl font-bold">{doc.title}</h1>;
  }

  const save = () => {
    const parsed = UpdateDocumentBody.safeParse({ title: draft });
    if (!parsed.success) {
      setDraft(doc.title); // empty or too long: put the old title back
      return;
    }
    if (parsed.data.title === doc.title) return;
    setError(null);
    rename.mutate(
      { id: doc.id, title: parsed.data.title },
      {
        onError: () => {
          setDraft(doc.title);
          setError("Couldn't rename the page.");
        },
      },
    );
  };

  return (
    <div>
      <h1>
        <input
          aria-label="Page title"
          value={draft}
          maxLength={200}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur(); // blur → save
            if (e.key === "Escape") {
              setDraft(doc.title);
              // Blur after the reset has rendered, so save() sees the old title.
              requestAnimationFrame(() => (e.target as HTMLInputElement).blur());
            }
          }}
          className="w-full bg-transparent text-4xl font-bold outline-none placeholder:text-zinc-400"
          placeholder="Untitled"
        />
      </h1>
      {error && (
        <p role="alert" className="mt-1 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
