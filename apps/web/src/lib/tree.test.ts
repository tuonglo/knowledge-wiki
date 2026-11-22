import type { DocumentSummary } from "@kw/shared";
import { describe, expect, it } from "vitest";
import { ancestorIds, buildTree, descendantIds, type TreeNode } from "./tree";

const doc = (id: string, parentId: string | null = null): DocumentSummary => ({
  id,
  title: id,
  parentId,
  role: "OWNER",
});

/** Tree → nested ids, easy to compare: ["a", ["b", ["c"]]] style. */
const shape = (nodes: TreeNode[]): unknown[] =>
  nodes.map((n) => (n.children.length ? [n.doc.id, shape(n.children)] : n.doc.id));

//   a          d
//   ├─ b
//   │  └─ c
//   └─ e
const docs = [doc("a"), doc("b", "a"), doc("c", "b"), doc("d"), doc("e", "a")];

describe("buildTree", () => {
  it("nests pages under their parents, keeping order", () => {
    expect(shape(buildTree(docs))).toEqual([["a", [["b", ["c"]], "e"]], "d"]);
  });

  it("puts a page whose parent you can't see at the top level", () => {
    // Shared sub-page: the API returns c but not its parent b.
    expect(shape(buildTree([doc("c", "b-hidden")]))).toEqual(["c"]);
  });

  it("works when a child comes before its parent in the list", () => {
    expect(shape(buildTree([doc("b", "a"), doc("a")]))).toEqual([["a", ["b"]]]);
  });

  it("returns nothing for no pages", () => {
    expect(buildTree([])).toEqual([]);
  });
});

describe("ancestorIds", () => {
  it("lists ancestors, nearest first", () => {
    expect(ancestorIds(docs, "c")).toEqual(["b", "a"]);
  });

  it("stops at a parent you can't see", () => {
    expect(ancestorIds([doc("c", "b-hidden")], "c")).toEqual([]);
  });

  it("doesn't loop forever on a cycle", () => {
    expect(ancestorIds([doc("x", "y"), doc("y", "x")], "x")).toEqual(["y"]);
  });
});

describe("descendantIds", () => {
  it("lists every page underneath", () => {
    expect(descendantIds(docs, "a").sort()).toEqual(["b", "c", "e"]);
  });

  it("is empty for a leaf", () => {
    expect(descendantIds(docs, "c")).toEqual([]);
  });
});
