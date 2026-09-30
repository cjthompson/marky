import { describe, expect, it } from "vitest";
import { folderForPath } from "./folders";
import type { AnnotatedFolder } from "./tauri";

const f = (path: string): AnnotatedFolder => ({
  id: `id-${path}`,
  name: path.split("/").pop() ?? path,
  path,
  added_at: "0",
  repo_root: null,
  repo_name: null,
});

describe("folderForPath", () => {
  it("returns null when path is undefined", () => {
    expect(folderForPath([f("/a")], undefined)).toBeNull();
  });

  it("returns null when no folder contains the path", () => {
    expect(folderForPath([f("/a")], "/b/x.md")).toBeNull();
  });

  it("returns null when path equals but is not strictly inside a folder", () => {
    expect(folderForPath([f("/a")], "/a")).toBeNull();
  });

  it("matches the deepest nested folder", () => {
    const outer = f("/proj");
    const inner = f("/proj/sub");
    expect(folderForPath([outer, inner], "/proj/sub/x.md")).toBe(inner);
  });

  it("matches the deepest nested folder when registered in reverse order", () => {
    const outer = f("/proj");
    const inner = f("/proj/sub");
    expect(folderForPath([inner, outer], "/proj/sub/x.md")).toBe(inner);
  });

  it("does not match a sibling that shares a prefix without the trailing slash", () => {
    const foo = f("/a/foo");
    expect(folderForPath([foo], "/a/foobar/x.md")).toBeNull();
  });

  it("picks the longest match when multiple folders share a prefix", () => {
    const a = f("/a");
    const ab = f("/a/b");
    expect(folderForPath([a, ab], "/a/b/c.md")).toBe(ab);
  });
});