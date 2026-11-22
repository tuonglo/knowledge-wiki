import type { SaveContentBody } from "@kw/shared";
import type { Editor } from "@tiptap/core";
import { screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { apiFetch, logout as apiLogout } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { fromBase64, toBase64 } from "@/lib/base64";
import { renderWithProviders, testUser } from "@/test/render";
import { PageEditor } from "./page-editor";

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  apiFetch: vi.fn(),
  logout: vi.fn(),
}));
const api = vi.mocked(apiFetch);
/** The order calls reached the "server": proves saves land BEFORE the session ends. */
let calls: string[];

/** A saved page in the same Yjs shape the editor writes (y-prosemirror: elements + text). */
function savedState(text: string): string {
  const doc = new Y.Doc();
  const paragraph = new Y.XmlElement("paragraph");
  paragraph.insert(0, [new Y.XmlText(text)]);
  doc.getXmlFragment("default").insert(0, [paragraph]);
  return toBase64(Y.encodeStateAsUpdate(doc));
}

let saves: SaveContentBody[];

beforeEach(() => {
  saves = [];
  calls = [];
  vi.mocked(apiLogout).mockReset();
  vi.mocked(apiLogout).mockImplementation(async () => void calls.push("logout"));
  api.mockReset();
  api.mockImplementation(async (path, init) => {
    if (path === "/me") return testUser;
    if (path === "/documents/p/content" && !init?.method) return { state: savedState("Hello world"), markdown: "Hello world", version: 4 };
    if (path === "/documents/p/content" && init?.method === "PUT") {
      saves.push(init.body as SaveContentBody);
      calls.push("save");
      return { version: 5 };
    }
    throw new Error(`unexpected ${init?.method ?? "GET"} ${path}`);
  });
});

/** Tiptap puts the editor instance on its DOM node. */
const editorOf = (el: HTMLElement) => (el as HTMLElement & { editor: Editor }).editor;

describe("PageEditor", () => {
  it("shows the saved content", async () => {
    renderWithProviders(<PageEditor docId="p" editable />);
    expect(await screen.findByText("Hello world")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Saved");
  });

  it("autosaves edits: full Yjs state + markdown, from the loaded version", async () => {
    renderWithProviders(<PageEditor docId="p" editable />);
    await screen.findByText("Hello world");
    const editor = editorOf(screen.getByLabelText("Page content"));

    editor.chain().focus("end").insertContent("<h2>Plans</h2><ul><li><p>ship it</p></li></ul>").run();
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Unsaved changes"));

    await waitFor(() => expect(saves).toHaveLength(1), { timeout: 3_000 });
    const [save] = saves;
    expect(save!.baseVersion).toBe(4);
    expect(save!.markdown).toContain("Hello world");
    expect(save!.markdown).toContain("## Plans");
    expect(save!.markdown).toMatch(/- ship it/);

    // The state is a real Yjs update that contains the old AND new content.
    const reloaded = new Y.Doc();
    Y.applyUpdate(reloaded, fromBase64(save!.state));
    const xml = reloaded.getXmlFragment("default").toString();
    expect(xml).toContain("Hello world");
    expect(xml).toContain("Plans");
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Saved"));
  });

  it("logging out right after typing saves the edit first", async () => {
    let logout!: () => Promise<void>;
    function GrabLogout() {
      logout = useAuth().logout;
      return null;
    }
    renderWithProviders(
      <>
        <GrabLogout />
        <PageEditor docId="p" editable />
      </>,
    );
    await screen.findByText("Hello world");
    editorOf(screen.getByLabelText("Page content")).chain().focus("end").insertContent(" last words").run();

    await logout(); // well inside the 1 s debounce
    expect(calls).toEqual(["save", "logout"]);
    expect(saves[0]!.markdown).toContain("last words");
  });

  it("is read-only for viewers and never saves", async () => {
    renderWithProviders(<PageEditor docId="p" editable={false} />);
    await screen.findByText("Hello world");
    expect(screen.getByLabelText("Page content")).toHaveAttribute("contenteditable", "false");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
