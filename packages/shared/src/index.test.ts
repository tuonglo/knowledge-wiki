import { describe, expect, it } from "vitest";
import { DocSavedEvent, roleAtLeast } from "./index";

describe("roleAtLeast", () => {
  it("orders roles VIEWER < EDITOR < OWNER", () => {
    expect(roleAtLeast("OWNER", "EDITOR")).toBe(true);
    expect(roleAtLeast("EDITOR", "EDITOR")).toBe(true);
    expect(roleAtLeast("VIEWER", "EDITOR")).toBe(false);
  });
});

describe("DocSavedEvent", () => {
  it("rejects negative versions", () => {
    expect(DocSavedEvent.safeParse({ documentId: "d", workspaceId: "w", version: -1 }).success).toBe(false);
  });
});
