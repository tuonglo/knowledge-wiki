import { describe, expect, it } from "vitest";
import { DocSavedEvent, roleAllows, roleAtLeast } from "./index";

describe("roleAtLeast", () => {
  it("orders roles VIEWER < EDITOR < OWNER", () => {
    expect(roleAtLeast("OWNER", "EDITOR")).toBe(true);
    expect(roleAtLeast("EDITOR", "EDITOR")).toBe(true);
    expect(roleAtLeast("VIEWER", "EDITOR")).toBe(false);
  });
});

describe("roleAllows", () => {
  it("maps actions to minimum roles", () => {
    expect(roleAllows("VIEWER", "view")).toBe(true);
    expect(roleAllows("VIEWER", "edit")).toBe(false);
    expect(roleAllows("EDITOR", "edit")).toBe(true);
    expect(roleAllows("EDITOR", "manage")).toBe(false);
    expect(roleAllows("OWNER", "manage")).toBe(true);
  });

  it("denies everything when there's no role", () => {
    expect(roleAllows(null, "view")).toBe(false);
  });
});

describe("DocSavedEvent", () => {
  it("rejects negative versions", () => {
    expect(DocSavedEvent.safeParse({ documentId: "d", workspaceId: "w", version: -1 }).success).toBe(false);
  });
});
