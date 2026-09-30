/**
 * Workspace state: tabs distributed across one or two panes.
 *
 * Invariants:
 *   - There are always 1 or 2 panes.
 *   - Every tab id in `tabOrder` exists in `tabs`.
 *   - Each tab id appears in exactly one pane.
 *   - `activePaneId` is one of the panes.
 *   - A pane with no tabs is allowed momentarily during reduction;
 *     `closeEmptyPane()` is invoked at the end of every action.
 */

export type SplitDirection = "horizontal" | "vertical";

export type TabMode = "read" | "edit";
export type TabView = "rendered" | "source";

export interface Diagnostic {
  line: number;
  column: number;
  end_line: number;
  end_column: number;
  rule: string;
  message: string;
  severity: "error" | "warning" | "info";
  fix?: {
    from_line: number;
    from_col: number;
    to_line: number;
    to_col: number;
    replacement: string;
  };
}

export type DiskNotice =
  | { kind: "reloaded"; previous: string }
  | { kind: "conflict"; disk: string };

export interface TabState {
  id: string;
  filePath?: string;
  title: string;
  source: string;
  /** Source content last saved to disk; missing means a tab with no file. */
  savedSource?: string;
  mode: TabMode;
  view: TabView;
  /** Pre-commit source snapshots, newest at the end. Capped at 100 entries. */
  history: string[];
  /** Redo stack. */
  future: string[];
  /** Disk-reload notice awaiting user acknowledgement. */
  diskNotice?: DiskNotice;
  /** Lint diagnostics for the current source. */
  diagnostics?: Diagnostic[];
}

export function isDirty(tab: TabState): boolean {
  if (!tab.filePath) return false;
  return tab.source !== tab.savedSource;
}

export interface PaneState {
  id: string;
  tabIds: string[];
  activeTabId: string | null;
}

export interface WorkspaceState {
  tabs: Record<string, TabState>;
  panes: PaneState[];
  activePaneId: string;
  split: SplitDirection | null;
  nextTabId: number;
  nextPaneId: number;
}

export type Action =
  | { type: "OPEN_FILE"; path: string; title: string; source: string; paneId?: string }
  | { type: "OPEN_WELCOME"; source: string }
  | { type: "UPDATE_TAB_SOURCE"; tabId: string; source: string }
  | { type: "CLOSE_TAB"; tabId: string; paneId: string }
  | { type: "SWITCH_TAB"; paneId: string; tabId: string }
  | { type: "FOCUS_PANE"; paneId: string }
  | { type: "SPLIT"; direction: SplitDirection }
  | { type: "CLOSE_SPLIT" }
  | { type: "COMMIT_EDIT"; tabId: string; source: string }
  | { type: "SAVED"; tabId: string; savedSource: string }
  | { type: "UNDO"; tabId: string }
  | { type: "REDO"; tabId: string }
  | { type: "SET_MODE"; tabId: string; mode: TabMode }
  | { type: "SET_VIEW"; tabId: string; view: TabView }
  | { type: "DISK_RELOADED"; tabId: string; source: string; previous: string }
  | { type: "DISK_CONFLICT"; tabId: string; disk: string }
  | { type: "RESTORE_PREVIOUS"; tabId: string }
  | { type: "KEEP_MINE"; tabId: string; disk: string }
  | { type: "APPLY_MERGE"; tabId: string; merged: string }
  | { type: "DISMISS_NOTICE"; tabId: string }
  | { type: "SET_DIAGNOSTICS"; tabId: string; diagnostics: Diagnostic[] };

const WELCOME_TITLE = "Welcome";
const HISTORY_CAP = 100;

export function createInitialState(welcomeSource: string): WorkspaceState {
  const tabId = "t0";
  const paneId = "p0";
  return {
    tabs: {
      [tabId]: {
        id: tabId,
        title: WELCOME_TITLE,
        source: welcomeSource,
        mode: "read",
        view: "rendered",
        history: [],
        future: [],
      },
    },
    panes: [{ id: paneId, tabIds: [tabId], activeTabId: tabId }],
    activePaneId: paneId,
    split: null,
    nextTabId: 1,
    nextPaneId: 1,
  };
}

function findTabByPath(state: WorkspaceState, path: string): { paneId: string; tabId: string } | null {
  for (const pane of state.panes) {
    for (const tabId of pane.tabIds) {
      if (state.tabs[tabId]?.filePath === path) {
        return { paneId: pane.id, tabId };
      }
    }
  }
  return null;
}

function withPane(state: WorkspaceState, paneId: string, fn: (p: PaneState) => PaneState): WorkspaceState {
  return { ...state, panes: state.panes.map((p) => (p.id === paneId ? fn(p) : p)) };
}

function withTab(state: WorkspaceState, tabId: string, fn: (t: TabState) => TabState): WorkspaceState {
  const existing = state.tabs[tabId];
  if (!existing) return state;
  return { ...state, tabs: { ...state.tabs, [tabId]: fn(existing) } };
}

function pushHistory(history: string[], entry: string): string[] {
  const next = [...history, entry];
  return next.length > HISTORY_CAP ? next.slice(next.length - HISTORY_CAP) : next;
}

/**
 * Drop empty panes when we have a split. If the split collapses to one pane,
 * clear `split` so the layout returns to a single view.
 */
function compact(state: WorkspaceState): WorkspaceState {
  const nonEmpty = state.panes.filter((p) => p.tabIds.length > 0);
  if (nonEmpty.length === state.panes.length) return state;

  // If everything is empty, keep one pane with a fresh welcome-less state.
  // (Caller is expected to push a tab immediately; this is a transient state.)
  if (nonEmpty.length === 0) return state;

  const activeStillThere = nonEmpty.some((p) => p.id === state.activePaneId);
  return {
    ...state,
    panes: nonEmpty,
    split: nonEmpty.length === 1 ? null : state.split,
    activePaneId: activeStillThere ? state.activePaneId : nonEmpty[0].id,
  };
}

export function reduce(state: WorkspaceState, action: Action): WorkspaceState {
  switch (action.type) {
    case "OPEN_FILE": {
      const existing = findTabByPath(state, action.path);
      if (existing) {
        return {
          ...withPane(state, existing.paneId, (p) => ({ ...p, activeTabId: existing.tabId })),
          activePaneId: existing.paneId,
        };
      }
      const tabId = `t${state.nextTabId}`;
      const paneId = action.paneId ?? state.activePaneId;
      const newTab: TabState = {
        id: tabId,
        filePath: action.path,
        title: action.title,
        source: action.source,
        savedSource: action.source,
        mode: "read",
        view: "rendered",
        history: [],
        future: [],
      };
      return {
        ...state,
        tabs: { ...state.tabs, [tabId]: newTab },
        panes: state.panes.map((p) =>
          p.id === paneId ? { ...p, tabIds: [...p.tabIds, tabId], activeTabId: tabId } : p
        ),
        activePaneId: paneId,
        nextTabId: state.nextTabId + 1,
      };
    }

    case "OPEN_WELCOME": {
      const tabId = `t${state.nextTabId}`;
      const paneId = state.activePaneId;
      return {
        ...state,
        tabs: {
          ...state.tabs,
          [tabId]: {
            id: tabId,
            title: WELCOME_TITLE,
            source: action.source,
            mode: "read",
            view: "rendered",
            history: [],
            future: [],
          },
        },
        panes: state.panes.map((p) =>
          p.id === paneId ? { ...p, tabIds: [...p.tabIds, tabId], activeTabId: tabId } : p
        ),
        nextTabId: state.nextTabId + 1,
      };
    }

    case "UPDATE_TAB_SOURCE": {
      const t = state.tabs[action.tabId];
      if (!t) return state;
      return {
        ...state,
        tabs: { ...state.tabs, [action.tabId]: { ...t, source: action.source } },
      };
    }

    case "CLOSE_TAB": {
      const pane = state.panes.find((p) => p.id === action.paneId);
      if (!pane || !pane.tabIds.includes(action.tabId)) return state;
      const idx = pane.tabIds.indexOf(action.tabId);
      const remaining = pane.tabIds.filter((id) => id !== action.tabId);
      const nextActive =
        pane.activeTabId === action.tabId
          ? remaining[Math.min(idx, remaining.length - 1)] ?? null
          : pane.activeTabId;

      const { [action.tabId]: _removed, ...restTabs } = state.tabs;

      const updated: WorkspaceState = {
        ...state,
        tabs: restTabs,
        panes: state.panes.map((p) =>
          p.id === pane.id ? { ...p, tabIds: remaining, activeTabId: nextActive } : p
        ),
      };
      return compact(updated);
    }

    case "SWITCH_TAB": {
      return {
        ...withPane(state, action.paneId, (p) =>
          p.tabIds.includes(action.tabId) ? { ...p, activeTabId: action.tabId } : p
        ),
        activePaneId: action.paneId,
      };
    }

    case "FOCUS_PANE": {
      if (!state.panes.some((p) => p.id === action.paneId)) return state;
      return { ...state, activePaneId: action.paneId };
    }

    case "SPLIT": {
      if (state.panes.length >= 2) {
        // Already split; only update direction.
        return { ...state, split: action.direction };
      }
      const newPaneId = `p${state.nextPaneId}`;
      // Start the new pane empty. Cloning the active tab caused two Viewers
      // to highlight the same source concurrently and step on each other's
      // pre.outerHTML swaps — that locked the renderer up.
      return {
        ...state,
        panes: [...state.panes, { id: newPaneId, tabIds: [], activeTabId: null }],
        activePaneId: newPaneId,
        split: action.direction,
        nextPaneId: state.nextPaneId + 1,
      };
    }

    case "CLOSE_SPLIT": {
      if (state.panes.length < 2) return state;
      // Keep the active pane, drop the others.
      const keep = state.panes.find((p) => p.id === state.activePaneId) ?? state.panes[0];
      const droppedTabIds = state.panes
        .filter((p) => p.id !== keep.id)
        .flatMap((p) => p.tabIds);
      const restTabs = { ...state.tabs };
      for (const id of droppedTabIds) delete restTabs[id];
      return {
        ...state,
        tabs: restTabs,
        panes: [keep],
        split: null,
        activePaneId: keep.id,
      };
    }

    case "COMMIT_EDIT": {
      return withTab(state, action.tabId, (t) => ({
        ...t,
        source: action.source,
        history: pushHistory(t.history, t.source),
        future: [],
      }));
    }

    case "SAVED": {
      return withTab(state, action.tabId, (t) => ({
        ...t,
        savedSource: action.savedSource,
        diskNotice: undefined,
      }));
    }

    case "UNDO": {
      return withTab(state, action.tabId, (t) => {
        if (t.history.length === 0) return t;
        const prev = t.history[t.history.length - 1];
        return {
          ...t,
          source: prev,
          history: t.history.slice(0, -1),
          future: [...t.future, t.source],
        };
      });
    }

    case "REDO": {
      return withTab(state, action.tabId, (t) => {
        if (t.future.length === 0) return t;
        const next = t.future[t.future.length - 1];
        return {
          ...t,
          source: next,
          history: [...t.history, t.source],
          future: t.future.slice(0, -1),
        };
      });
    }

    case "SET_MODE": {
      return withTab(state, action.tabId, (t) => ({ ...t, mode: action.mode }));
    }

    case "SET_VIEW": {
      return withTab(state, action.tabId, (t) => ({ ...t, view: action.view }));
    }

    case "DISK_RELOADED": {
      return withTab(state, action.tabId, (t) => {
        // If a reloaded notice is already up, keep the original `previous`
        // so repeated disk reloads (e.g. Claude rewriting a plan) keep the
        // pre-first-reload content for Restore until the banner is dismissed.
        const previous =
          t.diskNotice?.kind === "reloaded" ? t.diskNotice.previous : action.previous;
        return {
          ...t,
          source: action.source,
          savedSource: action.source,
          diskNotice: { kind: "reloaded", previous },
        };
      });
    }

    case "DISK_CONFLICT": {
      return withTab(state, action.tabId, (t) => ({
        ...t,
        diskNotice: { kind: "conflict", disk: action.disk },
      }));
    }

    case "RESTORE_PREVIOUS": {
      return withTab(state, action.tabId, (t) => {
        if (!t.diskNotice || t.diskNotice.kind !== "reloaded") return t;
        const disk = t.savedSource ?? "";
        return {
          ...t,
          source: t.diskNotice.previous,
          savedSource: disk,
          mode: "edit",
          diskNotice: undefined,
        };
      });
    }

    case "KEEP_MINE": {
      return withTab(state, action.tabId, (t) => ({
        ...t,
        savedSource: action.disk,
        diskNotice: undefined,
      }));
    }

    case "APPLY_MERGE": {
      return withTab(state, action.tabId, (t) => {
        if (!t.diskNotice || t.diskNotice.kind !== "conflict") return t;
        return {
          ...t,
          source: action.merged,
          savedSource: t.diskNotice.disk,
          diskNotice: undefined,
        };
      });
    }

    case "DISMISS_NOTICE": {
      return withTab(state, action.tabId, (t) => ({ ...t, diskNotice: undefined }));
    }

    case "SET_DIAGNOSTICS": {
      return withTab(state, action.tabId, (t) => ({ ...t, diagnostics: action.diagnostics }));
    }
  }
}

export function getActivePane(state: WorkspaceState): PaneState {
  return state.panes.find((p) => p.id === state.activePaneId) ?? state.panes[0];
}

export function getActiveTab(state: WorkspaceState): TabState | undefined {
  const pane = getActivePane(state);
  return pane.activeTabId ? state.tabs[pane.activeTabId] : undefined;
}