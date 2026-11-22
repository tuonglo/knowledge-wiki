import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "@/lib/api";
import { renderWithProviders, testUser, workspace } from "@/test/render";
import { CreateWorkspaceForm } from "./create-workspace-form";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: vi.fn() }) }));
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  apiFetch: vi.fn(),
}));
const api = vi.mocked(apiFetch);

beforeEach(() => {
  push.mockReset();
  api.mockReset();
  api.mockImplementation(async (path, init) => {
    if (path === "/me") return testUser;
    if (path === "/workspaces" && init?.method === "POST") return workspace("new-id", "Engineering");
    throw new Error(`unexpected ${path}`);
  });
});

const submit = (name: string) => {
  fireEvent.change(screen.getByLabelText("Workspace name"), { target: { value: name } });
  fireEvent.click(screen.getByRole("button", { name: "Create" }));
};

describe("CreateWorkspaceForm", () => {
  it("rejects a blank name without calling the API", async () => {
    renderWithProviders(<CreateWorkspaceForm />);
    submit("   ");
    expect(await screen.findByRole("alert")).toHaveTextContent("Enter a name");
    expect(api).not.toHaveBeenCalledWith("/workspaces", expect.anything(), expect.anything());
  });

  it("creates the workspace (trimmed name) and opens it", async () => {
    renderWithProviders(<CreateWorkspaceForm />);
    submit("  Engineering  ");
    await waitFor(() => expect(push).toHaveBeenCalledWith("/w/new-id"));
    expect(api).toHaveBeenCalledWith("/workspaces", { method: "POST", body: { name: "Engineering" } }, expect.anything());
  });

  it("shows an error when the API fails", async () => {
    api.mockImplementation(async (path) => {
      if (path === "/me") return testUser;
      throw new Error("boom");
    });
    renderWithProviders(<CreateWorkspaceForm />);
    submit("Engineering");
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't create");
    expect(push).not.toHaveBeenCalled();
  });
});
