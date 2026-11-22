import type { DocumentSummary, Role } from "@kw/shared";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "@/lib/api";
import { descendantIds } from "@/lib/tree";
import { renderWithProviders, testUser, workspace } from "@/test/render";
import { PageTree } from "./page-tree";

const push = vi.fn();
let params: { workspaceId: string; docId?: string } = { workspaceId: "w" };
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  useParams: () => params,
}));
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  apiFetch: vi.fn(),
}));
const api = vi.mocked(apiFetch);

const doc = (id: string, title: string, parentId: string | null = null, role: Role = "OWNER"): DocumentSummary => ({
  id,
  title,
  parentId,
  role,
});

//  Guide
//  └─ Setup
//     └─ Docker
//  Notes
let pages: DocumentSummary[];

beforeEach(() => {
  push.mockReset();
  api.mockReset();
  params = { workspaceId: "w" };
  pages = [doc("g", "Guide"), doc("s", "Setup", "g"), doc("d", "Docker", "s"), doc("n", "Notes")];
  api.mockImplementation(async (path, init) => {
    if (path === "/me") return testUser;
    if (path === "/workspaces/w/documents" && !init?.method) return pages;
    if (path === "/workspaces/w/documents" && init?.method === "POST") {
      const body = init.body as { parentId?: string };
      const created = doc("new", "Untitled", body.parentId ?? null);
      pages = [...pages, created];
      return { ...created, workspaceId: "w", createdAt: "x", updatedAt: "x" };
    }
    if (path.startsWith("/documents/") && init?.method === "DELETE") {
      // Like the real API: the page and everything under it (ON DELETE CASCADE).
      const id = path.slice("/documents/".length);
      const gone = new Set([id, ...descendantIds(pages, id)]);
      pages = pages.filter((p) => !gone.has(p.id));
      return undefined;
    }
    throw new Error(`unexpected ${init?.method ?? "GET"} ${path}`);
  });
});

const renderTree = (role: Role = "OWNER") => renderWithProviders(<PageTree workspace={workspace("w", "W", role)} />);

describe("PageTree", () => {
  it("shows top-level pages, collapsed", async () => {
    renderTree();
    expect(await screen.findByRole("link", { name: "Guide" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Notes" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Setup" })).not.toBeInTheDocument();
  });

  it("expands and collapses a page", async () => {
    renderTree();
    fireEvent.click(await screen.findByRole("button", { name: "Expand Guide" }));
    expect(screen.getByRole("link", { name: "Setup" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Collapse Guide" }));
    expect(screen.queryByRole("link", { name: "Setup" })).not.toBeInTheDocument();
  });

  it("opens the path down to the current page and marks it", async () => {
    params = { workspaceId: "w", docId: "d" };
    renderTree();
    const current = await screen.findByRole("link", { name: "Docker" });
    expect(current).toHaveAttribute("aria-current", "page");
  });

  it("creates a sub-page and opens it", async () => {
    renderTree();
    fireEvent.click(await screen.findByRole("button", { name: "Add a page inside Notes" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/w/w/d/new"));
    expect(api).toHaveBeenCalledWith("/workspaces/w/documents", { method: "POST", body: { parentId: "n" } }, expect.anything());
    // The parent expands to show the new page once the list refetches.
    expect(await screen.findByRole("link", { name: "Untitled" })).toBeInTheDocument();
  });

  it("asks before deleting, and says how many sub-pages go with it", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderTree();
    fireEvent.click(await screen.findByRole("button", { name: "Delete Guide" }));
    expect(confirm).toHaveBeenCalledWith('Delete "Guide" and its 2 sub-pages?');
    expect(api).not.toHaveBeenCalledWith("/documents/g", expect.anything());
  });

  it("deleting the open page's ancestor leaves it for the workspace home", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    params = { workspaceId: "w", docId: "d" };
    renderTree();
    fireEvent.click(await screen.findByRole("button", { name: "Delete Guide" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/w/w"));
    expect(screen.queryByRole("link", { name: "Guide" })).not.toBeInTheDocument();
  });

  it("hides actions your role doesn't allow", async () => {
    pages = [doc("v", "Read only", null, "VIEWER"), doc("e", "Editable", null, "EDITOR")];
    renderTree("VIEWER");
    const nav = await screen.findByRole("link", { name: "Read only" });
    expect(screen.queryByRole("button", { name: "New page" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add a page inside Read only" })).not.toBeInTheDocument();
    expect(nav).toBeInTheDocument();
    // EDITOR on a page: can add sub-pages, can't delete.
    const row = screen.getByRole("link", { name: "Editable" }).parentElement!;
    expect(within(row).getByRole("button", { name: "Add a page inside Editable" })).toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: "Delete Editable" })).not.toBeInTheDocument();
  });
});
