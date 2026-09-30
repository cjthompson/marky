import { useEffect, useReducer, useState, useCallback, useRef } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ThemeProvider } from "@/lib/theme";
import { PreferencesProvider, usePreferences } from "@/lib/preferences";
import { ResizeHandle } from "@/components/ResizeHandle";
import { TooltipProvider } from "@/components/ui/tooltip";
import { FolderSidebar } from "@/components/FolderSidebar";
import { Pane } from "@/components/Pane";
import { TableOfContents } from "@/components/TableOfContents";
import { Toolbar } from "@/components/Toolbar";
import { CommandPalette } from "@/components/CommandPalette";
import { UnsavedChangesDialog } from "@/components/UnsavedChangesDialog";
import {
  tauri,
  onCliTarget,
  onFolderChanged,
  onFileChanged,
  onMenuAction,
  type AnnotatedFolder,
  type MenuAction,
} from "@/lib/tauri";
import { folderForPath, pickAndAddFolder } from "@/lib/folders";
import {
  createInitialState,
  reduce,
  getActivePane,
  getActiveTab,
  isDirty,
  type SplitDirection,
  type TabState,
} from "@/lib/workspace";
import { cn } from "@/lib/utils";

const WELCOME = `# Welcome to Marky

A fast markdown viewer with folder support.

- Press **⌘K** to open the command palette and search files.
- Press **⌘O** to open a file. **⌘F** searches inside the open document.
- Add a folder from the sidebar; it stays available across sessions.
- **⌘\\** splits the active pane vertically. **⌘⇧\\** splits horizontally.
- Drop a file onto the window to open it as a new tab.

Launch from the terminal:

\`\`\`bash
marky README.md       # open a file
marky ./docs/         # open a folder (auto-saved)
\`\`\`
`;

type PendingPrompt =
  | { kind: "toggle-mode"; tabId: string; nextMode: "read" | "edit" }
  | { kind: "close-tab"; tabId: string; paneId: string }
  | { kind: "close-split" }
  | { kind: "quit" };

function AppShell() {
  const [state, dispatch] = useReducer(reduce, undefined, () => createInitialState(WELCOME));
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [searchPaneId, setSearchPaneId] = useState<string | null>(null);
  const [folders, setFolders] = useState<AnnotatedFolder[]>([]);
  const [sidebarRefresh, setSidebarRefresh] = useState(0);
  const [pending, setPending] = useState<PendingPrompt | null>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const {
    zoomIn, zoomOut, zoomReset,
    sidebarLeftWidth, sidebarRightWidth,
    setSidebarWidth, resetSidebarWidth,
  } = usePreferences();

  const activeTab = getActiveTab(state);
  const activePane = getActivePane(state);
  const isSplit = state.panes.length > 1;
  const activeDirty = activeTab ? isDirty(activeTab) : false;

  const refreshFolders = useCallback(async () => {
    setFolders(await tauri.listFoldersGrouped());
    setSidebarRefresh((n) => n + 1);
  }, []);

  const openFile = useCallback(async (path: string) => {
    try {
      const text = await tauri.readFile(path);
      const title = path.split("/").pop() ?? path;
      dispatch({ type: "OPEN_FILE", path, title, source: text });
    } catch (err) {
      console.error("failed to read file", err);
    }
  }, []);

  // Initial load.
  useEffect(() => {
    (async () => {
      const target = await tauri.getInitialTarget();
      if (target.kind === "file") openFile(target.path);
      if (target.kind === "folder") setSidebarRefresh((n) => n + 1);
      refreshFolders();
    })();
  }, [openFile, refreshFolders]);

  // Keep App-level folders in sync whenever folders are added/removed/changed.
  useEffect(() => {
    const off = onFolderChanged(() => {
      refreshFolders();
    });
    return () => {
      off.then((fn) => fn());
    };
  }, [refreshFolders]);

  // Re-read open files when they change on disk.
  useEffect(() => {
    const off = onFileChanged(async (paths) => {
      for (const tab of Object.values(state.tabs)) {
        if (tab.filePath && paths.includes(tab.filePath)) {
          try {
            const text = await tauri.readFile(tab.filePath);
            dispatch({ type: "UPDATE_TAB_SOURCE", tabId: tab.id, source: text });
          } catch {
            // File may have been deleted; ignore
          }
        }
      }
    });
    return () => {
      off.then((fn) => fn());
    };
  }, [state.tabs]);

  // CLI re-target via single-instance.
  useEffect(() => {
    const off = onCliTarget((t) => {
      if (t.kind === "file") openFile(t.path);
      if (t.kind === "folder") {
        // Sidebar will pick up the new folder via its own folder://changed
        // listener, but we also bump refreshNonce and scroll it into view.
        refreshFolders();
        setTimeout(() => {
          sidebarRef.current
            ?.querySelector(`#folder-${cssEscape(folderIdFromPath(t.path) ?? "")}`)
            ?.scrollIntoView({ block: "start" });
        }, 100);
      }
    });
    return () => {
      off.then((fn) => fn());
    };
  }, [openFile, refreshFolders]);

  // Map a path back to a folder id for scroll-into-view (best-effort).
  const [pathToFolderId, setPathToFolderId] = useState<Record<string, string>>({});
  useEffect(() => {
    const map: Record<string, string> = {};
    for (const f of folders) map[f.path] = f.id;
    setPathToFolderId(map);
  }, [folders]);
  function folderIdFromPath(p: string): string | null {
    return pathToFolderId[p] ?? null;
  }

  // File drop opens as new tab.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    (async () => {
      const off = await getCurrentWebview().onDragDropEvent((e) => {
        if (e.payload.type === "drop" && e.payload.paths.length > 0) {
          openFile(e.payload.paths[0]);
        }
      });
      unlisten = off;
    })();
    return () => unlisten?.();
  }, [openFile]);

  const handlePickFile = async () => {
    const picked = await openDialog({
      multiple: false,
      filters: [{ name: "Markdown", extensions: ["md", "markdown", "mdx"] }],
    });
    if (typeof picked === "string") openFile(picked);
  };

  const handleSplit = (d: SplitDirection) => dispatch({ type: "SPLIT", direction: d });
  const handleCloseSplit = () => dispatch({ type: "CLOSE_SPLIT" });
  const handleJumpToFolder = (folderId: string) => {
    sidebarRef.current
      ?.querySelector(`#folder-${cssEscape(folderId)}`)
      ?.scrollIntoView({ block: "start" });
  };

  // --- Save / discard / mode -------------------------------------------------

  const saveTab = useCallback(async (tab: TabState) => {
    if (!tab.filePath || tab.savedSource === undefined) return;
    if (tab.source === tab.savedSource) return;
    try {
      const outcome = await tauri.writeFile(tab.filePath, tab.source, tab.savedSource);
      if (outcome.kind === "saved") {
        dispatch({ type: "SAVED", tabId: tab.id, savedSource: tab.source });
      } else {
        // Conflict: surface the dirty-tab banner via reducer. The banner UI is
        // built by #016; for now just log and leave the tab dirty.
        console.warn("save conflict", tab.filePath);
        dispatch({ type: "DISK_CONFLICT", tabId: tab.id, disk: outcome.disk });
      }
    } catch (err) {
      console.error("save failed", err);
    }
  }, []);

  const discardTab = useCallback(async (tab: TabState) => {
    if (!tab.filePath) return;
    try {
      const text = await tauri.readFile(tab.filePath);
      dispatch({ type: "UPDATE_TAB_SOURCE", tabId: tab.id, source: text });
      // Clear any pending disk notice since the user has reloaded from disk.
      dispatch({ type: "DISMISS_NOTICE", tabId: tab.id });
    } catch (err) {
      console.error("discard failed", err);
    }
  }, []);

  const toggleMode = useCallback(() => {
    const tab = activeTab;
    if (!tab) return;
    // Welcome tab has no file and is always read-only.
    if (!tab.filePath) return;
    const nextMode = tab.mode === "edit" ? "read" : "edit";
    if (nextMode === "read" && isDirty(tab)) {
      setPending({ kind: "toggle-mode", tabId: tab.id, nextMode });
      return;
    }
    dispatch({ type: "SET_MODE", tabId: tab.id, mode: nextMode });
  }, [activeTab]);

  const tryCloseTab = useCallback((tabId: string, paneId: string) => {
    const tab = state.tabs[tabId];
    if (tab && isDirty(tab)) {
      setPending({ kind: "close-tab", tabId, paneId });
      return;
    }
    dispatch({ type: "CLOSE_TAB", tabId, paneId });
  }, [state.tabs]);

  const tryCloseSplit = useCallback(() => {
    // CLOSE_SPLIT drops all tabs in non-active panes. If any of them is
    // dirty, prompt before continuing.
    const keep = state.panes.find((p) => p.id === state.activePaneId) ?? state.panes[0];
    const dropped = state.panes.filter((p) => p.id !== keep.id).flatMap((p) => p.tabIds);
    const dirty = dropped.some((id) => state.tabs[id] && isDirty(state.tabs[id]));
    if (dirty) {
      setPending({ kind: "close-split" });
      return;
    }
    dispatch({ type: "CLOSE_SPLIT" });
  }, [state.panes, state.tabs, state.activePaneId]);

  const saveActiveTab = useCallback(async () => {
    if (!activeTab) return;
    await saveTab(activeTab);
  }, [activeTab, saveTab]);

  const discardActiveTab = useCallback(async () => {
    if (!activeTab) return;
    await discardTab(activeTab);
  }, [activeTab, discardTab]);

  // --- Pending prompt handlers ---------------------------------------------

  const resolvePrompt = useCallback(
    async (action: "save" | "discard" | "cancel") => {
      const p = pending;
      if (!p) return;
      setPending(null);
      if (action === "cancel") return;

      if (action === "save") {
        // Find the tab being acted on and save it before continuing.
        const tabId =
          p.kind === "toggle-mode" ? p.tabId
          : p.kind === "close-tab" ? p.tabId
          : null;
        if (tabId) {
          const tab = state.tabs[tabId];
          if (tab) {
            await saveTab(tab);
            // If the save didn't actually mark the tab clean (conflict), abort.
            const after = state.tabs[tabId];
            if (after && isDirty(after)) return;
          }
        }
      } else {
        // Discard: revert the dirty tab to its savedSource in-memory.
        const tabId =
          p.kind === "toggle-mode" ? p.tabId
          : p.kind === "close-tab" ? p.tabId
          : null;
        if (tabId) {
          const tab = state.tabs[tabId];
          if (tab?.savedSource !== undefined) {
            dispatch({ type: "UPDATE_TAB_SOURCE", tabId, source: tab.savedSource });
            dispatch({ type: "DISMISS_NOTICE", tabId });
          }
        }
      }

      // Continue the action.
      if (p.kind === "toggle-mode") {
        dispatch({ type: "SET_MODE", tabId: p.tabId, mode: p.nextMode });
      } else if (p.kind === "close-tab") {
        dispatch({ type: "CLOSE_TAB", tabId: p.tabId, paneId: p.paneId });
      } else if (p.kind === "close-split") {
        dispatch({ type: "CLOSE_SPLIT" });
      } else if (p.kind === "quit") {
        await getCurrentWindow().destroy();
      }
    },
    [pending, state.tabs, saveTab],
  );

  // --- Window close-requested ----------------------------------------------

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    (async () => {
      const off = await getCurrentWindow().onCloseRequested(async (event) => {
        const anyDirty = Object.values(state.tabs).some((t) => isDirty(t));
        if (anyDirty) {
          event.preventDefault();
          setPending({ kind: "quit" });
        }
      });
      unlisten = off;
    })();
    return () => unlisten?.();
  }, [state.tabs]);

  // --- Menu wiring ---------------------------------------------------------

  // Route native menu actions. Kept in a ref (updated every render) so the
  // listener below is registered exactly once and never sees stale state.
  const menuHandlerRef = useRef<(action: MenuAction) => void>(() => {});
  menuHandlerRef.current = async (action: MenuAction) => {
    switch (action) {
      case "open":
        handlePickFile();
        break;
      case "open-folder": {
        const folder = await pickAndAddFolder();
        if (folder) refreshFolders();
        break;
      }
      case "reload-file": {
        if (activeTab?.filePath) {
          if (isDirty(activeTab)) {
            // Reload on a dirty tab behaves like Discard changes.
            await discardTab(activeTab);
          } else {
            try {
              const text = await tauri.readFile(activeTab.filePath);
              dispatch({ type: "UPDATE_TAB_SOURCE", tabId: activeTab.id, source: text });
            } catch (err) {
              console.error("failed to reload file", err);
            }
          }
        }
        break;
      }
      case "close-tab": {
        const tabId = activePane.activeTabId;
        if (tabId) tryCloseTab(tabId, activePane.id);
        break;
      }
      case "save":
        await saveActiveTab();
        break;
      case "discard-changes":
        await discardActiveTab();
        break;
      case "edit-mode":
        toggleMode();
        break;
      case "undo":
        if (activeTab) dispatch({ type: "UNDO", tabId: activeTab.id });
        break;
      case "redo":
        if (activeTab) dispatch({ type: "REDO", tabId: activeTab.id });
        break;
      case "find":
        setSearchPaneId(state.activePaneId);
        break;
      case "command-palette":
        setPaletteOpen((v) => !v);
        break;
      case "split-right":
        dispatch({ type: "SPLIT", direction: "vertical" });
        break;
      case "split-down":
        dispatch({ type: "SPLIT", direction: "horizontal" });
        break;
      case "close-split":
        tryCloseSplit();
        break;
      case "zoom-in":
        zoomIn();
        break;
      case "zoom-out":
        zoomOut();
        break;
      case "zoom-reset":
        zoomReset();
        break;
      case "rescan-folder": {
        const folder = folderForPath(folders, activeTab?.filePath);
        if (folder) {
          try {
            await tauri.rescanFolder(folder.id);
          } catch (err) {
            console.error("failed to rescan folder", err);
          }
        }
        break;
      }
      case "close-folder": {
        const folder = folderForPath(folders, activeTab?.filePath);
        if (folder) {
          try {
            await tauri.removeFolder(folder.id);
          } catch (err) {
            console.error("failed to close folder", err);
          }
        }
        break;
      }
      case "print":
        window.print();
        break;
      case "reveal": {
        if (activeTab?.filePath) {
          revealItemInDir(activeTab.filePath);
        }
        break;
      }
      case "open-with": {
        if (activeTab?.filePath) {
          try {
            await tauri.openWith(activeTab.filePath);
          } catch (err) {
            console.error("open with failed", err);
          }
        }
        break;
      }
      case "export-html":
      case "export-markdown":
        // TODO(#006)
        break;
    }
  };

  useEffect(() => {
    const off = onMenuAction((action) => menuHandlerRef.current(action));
    return () => {
      off.then((fn) => fn());
    };
  }, []);

  const renderPane = (paneId: string) => {
    const pane = state.panes.find((p) => p.id === paneId)!;
    return (
      <Pane
        key={pane.id}
        pane={pane}
        tabs={state.tabs}
        isFocused={pane.id === state.activePaneId}
        onSelectTab={(tabId) => dispatch({ type: "SWITCH_TAB", paneId: pane.id, tabId })}
        onCloseTab={(tabId) => tryCloseTab(tabId, pane.id)}
        onFocusPane={() => dispatch({ type: "FOCUS_PANE", paneId: pane.id })}
        searchOpen={searchPaneId === pane.id}
        onSearchClose={() => setSearchPaneId(null)}
      />
    );
  };

  const promptAction =
    pending?.kind === "toggle-mode" ? "Switching to Read mode"
    : pending?.kind === "close-tab" ? "Closing this tab"
    : pending?.kind === "close-split" ? "Closing the split"
    : pending?.kind === "quit" ? "Quitting Marky"
    : "";

  return (
    <div className="flex h-full">
      <div ref={sidebarRef} className="flex h-full min-h-0 shrink-0 print:hidden" style={{ width: sidebarLeftWidth }}>
        <FolderSidebar
          activePath={activeTab?.filePath}
          onOpenFile={openFile}
          onOpenPalette={() => setPaletteOpen(true)}
          refreshNonce={sidebarRefresh}
        />
      </div>
      <ResizeHandle
        side="left"
        onResize={(w) => setSidebarWidth("left", w)}
        onReset={() => resetSidebarWidth("left")}
        className="print:hidden"
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <Toolbar
          filePath={activeTab?.filePath}
          onOpenFile={handlePickFile}
          onSplit={handleSplit}
          onCloseSplit={tryCloseSplit}
          isSplit={isSplit}
          onFind={() => setSearchPaneId(state.activePaneId)}
          mode={activeTab?.mode ?? "read"}
          onToggleMode={toggleMode}
          dirty={activeDirty}
          onSave={saveActiveTab}
          onDiscard={discardActiveTab}
        />
        <div className="flex min-h-0 flex-1 print:block">
          <main className="min-w-0 flex-1">
            <div
              className={cn(
                "flex h-full",
                state.split === "horizontal" ? "flex-col" : "flex-row"
              )}
            >
              {state.panes.map((p, i) => (
                <div key={p.id} className={cn("flex min-h-0 min-w-0 flex-1", isSplit && p.id !== state.activePaneId && "print:hidden")}>
                  {renderPane(p.id)}
                  {i < state.panes.length - 1 && (
                    <div
                      className={cn(
                        "shrink-0 bg-border print:hidden",
                        state.split === "horizontal" ? "h-px w-full" : "h-full w-px"
                      )}
                    />
                  )}
                </div>
              ))}
            </div>
          </main>
          {!isSplit && (
            <>
              <ResizeHandle
                side="right"
                onResize={(w) => setSidebarWidth("right", w)}
                onReset={() => resetSidebarWidth("right")}
                className="hidden lg:flex print:hidden"
              />
              <aside className="hidden shrink-0 border-l bg-card/30 lg:block print:hidden" style={{ width: sidebarRightWidth }}>
                <TableOfContents source={activeTab?.source ?? ""} />
              </aside>
            </>
          )}
        </div>
      </div>
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        onOpenFile={openFile}
        onSplit={handleSplit}
        onCloseSplit={handleCloseSplit}
        isSplit={isSplit}
        folders={folders}
        onJumpToFolder={handleJumpToFolder}
      />
      <UnsavedChangesDialog
        open={pending !== null}
        action={promptAction}
        onSave={() => resolvePrompt("save")}
        onDiscard={() => resolvePrompt("discard")}
        onCancel={() => resolvePrompt("cancel")}
      />
    </div>
  );
}

function cssEscape(s: string): string {
  // Minimal escape for use in attribute selectors with UUID-like ids.
  return s.replace(/([^a-zA-Z0-9_-])/g, "\\$1");
}

export default function App() {
  return (
    <ThemeProvider>
      <PreferencesProvider>
        <TooltipProvider delayDuration={300}>
          <AppShell />
        </TooltipProvider>
      </PreferencesProvider>
    </ThemeProvider>
  );
}