import { describe, expect, it } from "vitest";
import { createInitialState, reduce, getActivePane, getActiveTab, isDirty } from "./workspace";

const open = (state: ReturnType<typeof createInitialState>, path: string, source = "x") =>
  reduce(state, { type: "OPEN_FILE", path, title: path, source });

describe("workspace reducer", () => {
  it("starts with one welcome tab in one pane", () => {
    const s = createInitialState("welcome");
    expect(s.panes).toHaveLength(1);
    expect(Object.keys(s.tabs)).toHaveLength(1);
    expect(getActiveTab(s)?.title).toBe("Welcome");
  });

  it("OPEN_FILE adds a new tab and activates it", () => {
    let s = createInitialState("w");
    s = open(s, "/a.md");
    expect(getActivePane(s).tabIds).toHaveLength(2);
    expect(getActiveTab(s)?.filePath).toBe("/a.md");
  });

  it("OPEN_FILE on an already-open path switches to existing tab instead of duplicating", () => {
    let s = createInitialState("w");
    s = open(s, "/a.md");
    s = open(s, "/b.md");
    s = open(s, "/a.md"); // same path again
    expect(getActivePane(s).tabIds).toHaveLength(3);
    expect(getActiveTab(s)?.filePath).toBe("/a.md");
  });

  it("CLOSE_TAB removes the tab and picks a sibling as active", () => {
    let s = createInitialState("w");
    s = open(s, "/a.md");
    s = open(s, "/b.md"); // active is b
    const pane = getActivePane(s);
    const aTabId = pane.tabIds[1]; // a is index 1
    s = reduce(s, { type: "CLOSE_TAB", tabId: aTabId, paneId: pane.id });
    expect(getActivePane(s).tabIds).toHaveLength(2);
    expect(getActiveTab(s)?.filePath).toBe("/b.md");
  });

  it("SPLIT creates an empty new pane and switches focus to it", () => {
    let s = createInitialState("w");
    s = open(s, "/a.md");
    s = reduce(s, { type: "SPLIT", direction: "vertical" });
    expect(s.panes).toHaveLength(2);
    expect(s.split).toBe("vertical");
    const newPane = s.panes[1];
    expect(s.activePaneId).toBe(newPane.id);
    expect(newPane.tabIds).toEqual([]);
    expect(newPane.activeTabId).toBeNull();
  });

  it("OPEN_FILE goes into the active (new) pane after split", () => {
    let s = createInitialState("w");
    s = open(s, "/a.md");
    s = reduce(s, { type: "SPLIT", direction: "vertical" });
    s = open(s, "/c.md");
    const right = s.panes[1];
    expect(right.tabIds.map((id) => s.tabs[id].filePath)).toContain("/c.md");
  });

  it("CLOSE_SPLIT collapses to the focused pane", () => {
    let s = createInitialState("w");
    s = open(s, "/a.md");
    s = reduce(s, { type: "SPLIT", direction: "horizontal" });
    s = open(s, "/c.md");
    s = reduce(s, { type: "CLOSE_SPLIT" });
    expect(s.panes).toHaveLength(1);
    expect(s.split).toBeNull();
    expect(getActiveTab(s)?.filePath).toBe("/c.md");
  });

  it("closing the last tab in the second pane collapses split automatically", () => {
    let s = createInitialState("w");
    s = open(s, "/a.md");
    s = reduce(s, { type: "SPLIT", direction: "vertical" });
    s = open(s, "/c.md"); // populates the empty new pane
    const newPane = s.panes[1];
    const onlyTab = newPane.activeTabId!;
    s = reduce(s, { type: "CLOSE_TAB", tabId: onlyTab, paneId: newPane.id });
    expect(s.panes).toHaveLength(1);
    expect(s.split).toBeNull();
  });

  it("UPDATE_TAB_SOURCE mutates only the targeted tab", () => {
    let s = createInitialState("w");
    s = open(s, "/a.md", "old");
    const tabId = getActiveTab(s)!.id;
    s = reduce(s, { type: "UPDATE_TAB_SOURCE", tabId, source: "new" });
    expect(s.tabs[tabId].source).toBe("new");
  });

  it("FOCUS_PANE switches active pane only when the id exists", () => {
    let s = createInitialState("w");
    s = open(s, "/a.md");
    s = reduce(s, { type: "SPLIT", direction: "vertical" });
    const left = s.panes[0].id;
    s = reduce(s, { type: "FOCUS_PANE", paneId: left });
    expect(s.activePaneId).toBe(left);

    const before = s.activePaneId;
    s = reduce(s, { type: "FOCUS_PANE", paneId: "nonexistent" });
    expect(s.activePaneId).toBe(before);
  });
});

describe("edit-mode reducer transitions", () => {
  it("OPEN_FILE seeds savedSource equal to source (clean)", () => {
    const s = open(createInitialState("w"), "/a.md", "hello");
    const tab = getActiveTab(s)!;
    expect(isDirty(tab)).toBe(false);
    expect(tab.savedSource).toBe("hello");
  });

  it("COMMIT_EDIT sets source, pushes history, clears future", () => {
    let s = createInitialState("w");
    s = open(s, "/a.md", "v1");
    const tabId = getActiveTab(s)!.id;
    s = reduce(s, { type: "COMMIT_EDIT", tabId, source: "v2" });
    let t = s.tabs[tabId];
    expect(t.source).toBe("v2");
    expect(t.history).toEqual(["v1"]);
    expect(t.future).toEqual([]);

    s = reduce(s, { type: "COMMIT_EDIT", tabId, source: "v3" });
    t = s.tabs[tabId];
    expect(t.history).toEqual(["v1", "v2"]);
  });

  it("UNDO/REDO swap source between history and future", () => {
    let s = createInitialState("w");
    s = open(s, "/a.md", "v1");
    const tabId = getActiveTab(s)!.id;
    s = reduce(s, { type: "COMMIT_EDIT", tabId, source: "v2" });
    s = reduce(s, { type: "UNDO", tabId });
    expect(s.tabs[tabId].source).toBe("v1");
    expect(s.tabs[tabId].future).toEqual(["v2"]);
    s = reduce(s, { type: "REDO", tabId });
    expect(s.tabs[tabId].source).toBe("v2");
    expect(s.tabs[tabId].future).toEqual([]);
  });

  it("SAVED records savedSource and clears disk notice", () => {
    let s = createInitialState("w");
    s = open(s, "/a.md", "v1");
    const tabId = getActiveTab(s)!.id;
    s = reduce(s, { type: "DISK_CONFLICT", tabId, disk: "from-disk" });
    s = reduce(s, { type: "SAVED", tabId, savedSource: "v1" });
    expect(s.tabs[tabId].savedSource).toBe("v1");
    expect(s.tabs[tabId].diskNotice).toBeUndefined();
  });

  it("DISK_RELOADED overwrites source + savedSource and records previous", () => {
    let s = createInitialState("w");
    s = open(s, "/a.md", "v1");
    const tabId = getActiveTab(s)!.id;
    s = reduce(s, { type: "DISK_RELOADED", tabId, source: "v2", previous: "v1" });
    expect(s.tabs[tabId].source).toBe("v2");
    expect(s.tabs[tabId].savedSource).toBe("v2");
    expect(s.tabs[tabId].diskNotice).toEqual({ kind: "reloaded", previous: "v1" });
  });

  it("RESTORE_PREVIOUS brings back previous, makes tab dirty, switches to edit", () => {
    let s = createInitialState("w");
    s = open(s, "/a.md", "v1");
    const tabId = getActiveTab(s)!.id;
    s = reduce(s, { type: "DISK_RELOADED", tabId, source: "v2", previous: "v1" });
    s = reduce(s, { type: "RESTORE_PREVIOUS", tabId });
    expect(s.tabs[tabId].source).toBe("v1");
    expect(s.tabs[tabId].savedSource).toBe("v2");
    expect(s.tabs[tabId].mode).toBe("edit");
    expect(s.tabs[tabId].diskNotice).toBeUndefined();
    expect(isDirty(s.tabs[tabId])).toBe(true);
  });

  it("KEEP_MINE pins savedSource to disk without touching source", () => {
    let s = createInitialState("w");
    s = open(s, "/a.md", "v1");
    const tabId = getActiveTab(s)!.id;
    s = reduce(s, { type: "DISK_CONFLICT", tabId, disk: "from-disk" });
    s = reduce(s, { type: "COMMIT_EDIT", tabId, source: "mine" });
    s = reduce(s, { type: "KEEP_MINE", tabId, disk: "from-disk" });
    expect(s.tabs[tabId].source).toBe("mine");
    expect(s.tabs[tabId].savedSource).toBe("from-disk");
    expect(isDirty(s.tabs[tabId])).toBe(true);
  });

  it("APPLY_MERGE replaces source with merged and pins savedSource to disk", () => {
    let s = createInitialState("w");
    s = open(s, "/a.md", "v1");
    const tabId = getActiveTab(s)!.id;
    s = reduce(s, { type: "DISK_CONFLICT", tabId, disk: "from-disk" });
    s = reduce(s, { type: "APPLY_MERGE", tabId, merged: "merged-with-markers" });
    expect(s.tabs[tabId].source).toBe("merged-with-markers");
    expect(s.tabs[tabId].savedSource).toBe("from-disk");
    expect(s.tabs[tabId].diskNotice).toBeUndefined();
  });

  it("SET_MODE and SET_VIEW update the tab only", () => {
    let s = createInitialState("w");
    s = open(s, "/a.md", "v1");
    const tabId = getActiveTab(s)!.id;
    s = reduce(s, { type: "SET_MODE", tabId, mode: "edit" });
    s = reduce(s, { type: "SET_VIEW", tabId, view: "source" });
    expect(s.tabs[tabId].mode).toBe("edit");
    expect(s.tabs[tabId].view).toBe("source");
  });

  it("DISMISS_NOTICE clears diskNotice only", () => {
    let s = createInitialState("w");
    s = open(s, "/a.md", "v1");
    const tabId = getActiveTab(s)!.id;
    s = reduce(s, { type: "DISK_CONFLICT", tabId, disk: "x" });
    s = reduce(s, { type: "DISMISS_NOTICE", tabId });
    expect(s.tabs[tabId].diskNotice).toBeUndefined();
    expect(s.tabs[tabId].source).toBe("v1");
  });

  it("SET_DIAGNOSTICS records diagnostics on the tab", () => {
    let s = createInitialState("w");
    s = open(s, "/a.md", "v1");
    const tabId = getActiveTab(s)!.id;
    const diags = [
      { line: 1, column: 1, end_line: 1, end_column: 4, rule: "MD001", message: "x", severity: "warning" as const },
    ];
    s = reduce(s, { type: "SET_DIAGNOSTICS", tabId, diagnostics: diags });
    expect(s.tabs[tabId].diagnostics).toEqual(diags);
  });

  it("DISK_RELOADED twice keeps the original previous (does not overwrite with in-between source)", () => {
    let s = createInitialState("w");
    s = open(s, "/a.md", "v1");
    const tabId = getActiveTab(s)!.id;
    s = reduce(s, { type: "DISK_RELOADED", tabId, source: "v2", previous: "v1" });
    expect(s.tabs[tabId].diskNotice).toEqual({ kind: "reloaded", previous: "v1" });
    // Second reload — caller passes the current `source` ("v2") as `previous`.
    // The reducer must ignore that and keep the original "v1" so Restore can
    // bring back the pre-first-reload content.
    s = reduce(s, { type: "DISK_RELOADED", tabId, source: "v3", previous: "v2" });
    expect(s.tabs[tabId].source).toBe("v3");
    expect(s.tabs[tabId].savedSource).toBe("v3");
    expect(s.tabs[tabId].diskNotice).toEqual({ kind: "reloaded", previous: "v1" });
  });

  it("KEEP_MINE on a clean tab still works without a prior COMMIT_EDIT", () => {
    let s = createInitialState("w");
    s = open(s, "/a.md", "v1");
    const tabId = getActiveTab(s)!.id;
    s = reduce(s, { type: "DISK_CONFLICT", tabId, disk: "from-disk" });
    // Tab is still clean (source === savedSource === "v1"); the user picks
    // Keep mine so the next ⌘S will overwrite disk without a conflict.
    expect(isDirty(s.tabs[tabId])).toBe(false);
    s = reduce(s, { type: "KEEP_MINE", tabId, disk: "from-disk" });
    expect(s.tabs[tabId].source).toBe("v1");
    expect(s.tabs[tabId].savedSource).toBe("from-disk");
    expect(s.tabs[tabId].diskNotice).toBeUndefined();
  });

  it("APPLY_MERGE on a reloaded notice is a no-op", () => {
    let s = createInitialState("w");
    s = open(s, "/a.md", "v1");
    const tabId = getActiveTab(s)!.id;
    s = reduce(s, { type: "DISK_RELOADED", tabId, source: "v2", previous: "v1" });
    const before = s.tabs[tabId];
    s = reduce(s, { type: "APPLY_MERGE", tabId, merged: "merged" });
    expect(s.tabs[tabId]).toEqual(before);
  });
});
