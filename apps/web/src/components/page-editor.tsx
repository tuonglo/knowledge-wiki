"use client";

import type { DocumentContent } from "@kw/shared";
import Collaboration from "@tiptap/extension-collaboration";
import Placeholder from "@tiptap/extension-placeholder";
import { Markdown } from "@tiptap/markdown";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useState } from "react";
import * as Y from "yjs";
import { Autosave, type SaveStatus } from "@/lib/autosave";
import { fromBase64 } from "@/lib/base64";
import { loadContent, saveContent, useDocumentContent } from "@/lib/documents";
import { registerPendingSave } from "@/lib/pending-saves";

/**
 * Where the editor's content lives inside the Y.Doc. NOT "body": Step 4's manual test
 * stored a Y.Text under "body", and one name can't hold two Yjs types.
 */
const YJS_FIELD = "default";

/** Loads the page body, then mounts the editor with it. */
export function PageEditor({ docId, editable }: { docId: string; editable: boolean }) {
  const content = useDocumentContent(docId);
  if (content.isError) return <p className="text-sm text-red-600 dark:text-red-400">Couldn&apos;t load this page&apos;s content.</p>;
  if (!content.data) return <p className="text-sm text-zinc-500">Loading…</p>;
  // key: a different page gets a brand-new Y.Doc, editor, and autosave.
  return <LoadedEditor key={docId} docId={docId} editable={editable} initial={content.data} />;
}

function LoadedEditor({ docId, editable, initial }: { docId: string; editable: boolean; initial: DocumentContent }) {
  // Created once per page visit, from the saved state.
  const [ydoc] = useState(() => {
    const doc = new Y.Doc();
    if (initial.state) Y.applyUpdate(doc, fromBase64(initial.state));
    return doc;
  });
  const [status, setStatus] = useState<SaveStatus>({ kind: "saved" });

  const editor = useEditor({
    // The server can't render a Y.Doc it doesn't have: render in the browser only.
    immediatelyRender: false,
    editable,
    extensions: [
      // StarterKit = paragraphs, headings, lists, bold/italic, code, quotes… plus Markdown
      // shortcuts while typing ("# " → heading, "- " → list, "**x**" → bold).
      // Its own undo is off: Collaboration brings Yjs undo, which understands the Y.Doc.
      StarterKit.configure({ undoRedo: false }),
      Collaboration.configure({ document: ydoc, field: YJS_FIELD }),
      Markdown, // adds editor.getMarkdown() for the plain-text copy
      Placeholder.configure({ placeholder: editable ? "Start writing… type # for a heading, - for a list" : "" }),
    ],
    editorProps: {
      attributes: { class: "kw-editor", "aria-label": "Page content" },
    },
  });

  useEffect(() => {
    if (!editor || !editable) return;
    let lastMarkdown = "";
    const autosave = new Autosave({
      ydoc,
      version: initial.version,
      // The editor may be torn down before a final save on leave: reuse the last copy then.
      getMarkdown: () => (editor.isDestroyed ? lastMarkdown : (lastMarkdown = editor.getMarkdown())),
      save: (body) => saveContent(docId, body),
      load: () => loadContent(docId),
      onStatus: setStatus,
    });

    // Closing the tab with unsaved edits: ask the browser to confirm.
    const warn = (e: BeforeUnloadEvent) => {
      if (autosave.hasUnsavedChanges) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    const unregister = registerPendingSave(() => autosave.flush());
    return () => {
      unregister();
      window.removeEventListener("beforeunload", warn);
      void autosave.close(); // navigating to another page: send what's pending
    };
  }, [editor, editable, ydoc, docId, initial.version]);

  return (
    <div className="flex flex-col gap-2">
      {editable && <SaveIndicator status={status} />}
      <EditorContent editor={editor} />
    </div>
  );
}

const LABELS: Record<Exclude<SaveStatus["kind"], "failed">, string> = {
  saved: "Saved",
  pending: "Unsaved changes",
  saving: "Saving…",
  retrying: "Can't reach the server. Retrying…",
};

function SaveIndicator({ status }: { status: SaveStatus }) {
  const failed = status.kind === "failed";
  return (
    <p
      role="status"
      aria-live="polite"
      className={`self-end text-xs ${failed || status.kind === "retrying" ? "text-red-600 dark:text-red-400" : "text-zinc-500"}`}
    >
      {failed ? status.message : LABELS[status.kind]}
    </p>
  );
}
