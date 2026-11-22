import type { DocumentDetail, Role } from "@kw/shared";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "@/lib/api";
import { renderWithProviders, testUser } from "@/test/render";
import { PageTitle } from "./page-title";

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  apiFetch: vi.fn(),
}));
const api = vi.mocked(apiFetch);

const page = (role: Role): DocumentDetail => ({
  id: "p",
  title: "Old title",
  parentId: null,
  workspaceId: "w",
  createdAt: "x",
  updatedAt: "x",
  role,
});

beforeEach(() => {
  api.mockReset();
  api.mockImplementation(async (path, init) => {
    if (path === "/me") return testUser;
    if (path === "/documents/p" && init?.method === "PATCH") {
      // PATCH returns the document without `role`.
      const { id, parentId, workspaceId, createdAt, updatedAt } = page("OWNER");
      return { id, parentId, workspaceId, createdAt, updatedAt, title: (init.body as { title: string }).title };
    }
    throw new Error(`unexpected ${path}`);
  });
});

const patched = () => api.mock.calls.filter(([, init]) => init?.method === "PATCH");

describe("PageTitle", () => {
  it("renames on Enter (trimmed)", async () => {
    renderWithProviders(<PageTitle doc={page("EDITOR")} />);
    const input = screen.getByLabelText("Page title");
    fireEvent.change(input, { target: { value: "  New title  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.blur(input); // jsdom doesn't move focus for us
    await waitFor(() => expect(patched()).toHaveLength(1));
    expect(patched()[0]![1]).toMatchObject({ body: { title: "New title" } });
  });

  it("puts the old title back instead of saving a blank one", () => {
    renderWithProviders(<PageTitle doc={page("EDITOR")} />);
    const input = screen.getByLabelText("Page title");
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.blur(input);
    expect(input).toHaveValue("Old title");
    expect(patched()).toHaveLength(0);
  });

  it("doesn't call the API when nothing changed", () => {
    renderWithProviders(<PageTitle doc={page("EDITOR")} />);
    fireEvent.blur(screen.getByLabelText("Page title"));
    expect(patched()).toHaveLength(0);
  });

  it("is plain text for viewers", () => {
    renderWithProviders(<PageTitle doc={page("VIEWER")} />);
    expect(screen.queryByLabelText("Page title")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Old title" })).toBeInTheDocument();
  });
});
