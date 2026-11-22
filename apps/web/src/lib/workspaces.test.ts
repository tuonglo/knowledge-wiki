import { beforeEach, describe, expect, it } from "vitest";
import { workspace } from "@/test/render";
import { pickWorkspace, rememberWorkspace } from "./workspaces";

describe("pickWorkspace", () => {
  const list = [workspace("a", "Alpha"), workspace("b", "Beta")];

  beforeEach(() => localStorage.clear());

  it("picks the first workspace when nothing is remembered", () => {
    expect(pickWorkspace(list)?.id).toBe("a");
  });

  it("picks the remembered workspace", () => {
    rememberWorkspace("b");
    expect(pickWorkspace(list)?.id).toBe("b");
  });

  it("ignores a remembered workspace you're no longer in", () => {
    rememberWorkspace("gone");
    expect(pickWorkspace(list)?.id).toBe("a");
  });

  it("returns undefined when you have no workspaces", () => {
    expect(pickWorkspace([])).toBeUndefined();
  });
});
