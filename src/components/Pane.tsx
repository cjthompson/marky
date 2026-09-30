import { useRef, useState } from "react";
import type { PaneState, TabState } from "@/lib/workspace";
import { TabBar } from "@/components/TabBar";
import { Viewer } from "@/components/Viewer";
import { SourceView } from "@/components/SourceView";
import { DocSearch } from "@/components/DocSearch";
import { DiskChangeBanner } from "@/components/DiskChangeBanner";
import { cn } from "@/lib/utils";

interface Props {
  pane: PaneState;
  tabs: Record<string, TabState>;
  isFocused: boolean;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onFocusPane: () => void;
  searchOpen: boolean;
  onSearchClose: () => void;
  /** Commit a spliced block edit (start/end are 1-based, inclusive). */
  onCommitBlock?: (tabId: string, start: number, end: number, newText: string) => void;
  /** Toggle the [ ]/[x] marker on the line. */
  onToggleCheckbox?: (tabId: string, line: number) => void;
  /** Source-view typing updates the tab's source immediately. */
  onSourceEdit?: (tabId: string, source: string) => void;
  /** Disk-change banner callbacks (all only fire when active tab has a notice). */
  onShowChanges?: () => void;
  onRestorePrevious?: () => void;
  onReloadFromDisk?: () => void;
  onKeepMine?: () => void;
  onMerge?: () => void;
  onDismissNotice?: () => void;
}

export function Pane({
  pane,
  tabs,
  isFocused,
  onSelectTab,
  onCloseTab,
  onFocusPane,
  searchOpen,
  onSearchClose,
  onCommitBlock,
  onToggleCheckbox,
  onSourceEdit,
  onShowChanges,
  onRestorePrevious,
  onReloadFromDisk,
  onKeepMine,
  onMerge,
  onDismissNotice,
}: Props) {
  const activeTab = pane.activeTabId ? tabs[pane.activeTabId] : undefined;
  const articleRef = useRef<HTMLElement>(null);
  const [contentNonce, setContentNonce] = useState(0);

  return (
    <div
      data-pane-id={pane.id}
      onMouseDown={onFocusPane}
      className={cn(
        "relative flex min-h-0 min-w-0 flex-1 flex-col",
        isFocused ? "ring-1 ring-ring/30" : ""
      )}
    >
      <TabBar
        pane={pane}
        tabs={tabs}
        isFocused={isFocused}
        onSelect={onSelectTab}
        onClose={onCloseTab}
        onFocusPane={onFocusPane}
      />
      {activeTab?.diskNotice && onShowChanges && onDismissNotice && (
        <DiskChangeBanner
          tab={activeTab}
          onShowChanges={onShowChanges}
          onRestorePrevious={onRestorePrevious}
          onReloadFromDisk={onReloadFromDisk}
          onKeepMine={onKeepMine}
          onMerge={onMerge}
          onDismissNotice={onDismissNotice}
        />
      )}
      <div className="relative flex min-h-0 flex-1">
        {activeTab ? (
          activeTab.view === "source" ? (
            <SourceView
              key={activeTab.id}
              source={activeTab.source}
              editable={activeTab.mode === "edit" && activeTab.filePath !== undefined}
              onSourceChange={onSourceEdit ? (next) => onSourceEdit(activeTab.id, next) : undefined}
              diagnostics={activeTab.diagnostics ?? []}
            />
          ) : (
            <Viewer
              key={activeTab.id}
              source={activeTab.source}
              filePath={activeTab.filePath}
              articleRef={articleRef}
              onRendered={() => setContentNonce((n) => n + 1)}
              mode={activeTab.mode}
              onCommitBlock={onCommitBlock ? (s, e, t) => onCommitBlock(activeTab.id, s, e, t) : undefined}
              onToggleCheckbox={onToggleCheckbox ? (l) => onToggleCheckbox(activeTab.id, l) : undefined}
              diagnostics={activeTab.diagnostics ?? []}
            />
          )
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            Empty pane
          </div>
        )}
        <DocSearch
          open={searchOpen}
          onClose={onSearchClose}
          containerRef={articleRef}
          contentNonce={contentNonce}
        />
      </div>
    </div>
  );
}