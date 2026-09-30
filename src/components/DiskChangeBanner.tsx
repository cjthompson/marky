import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { TabState } from "@/lib/workspace";

interface Props {
  tab: TabState;
  onShowChanges: () => void;
  onRestorePrevious?: () => void;
  onReloadFromDisk?: () => void;
  onKeepMine?: () => void;
  onMerge?: () => void;
  onDismissNotice: () => void;
}

/**
 * Two-mode banner shown at the top of a pane when the on-disk content of
 * the active tab's file diverges from what's in memory.
 *
 * - `reloaded` notice: disk content matched `savedSource` exactly OR the
 *   tab was clean, so we reloaded `source`/`savedSource` and recorded
 *   `previous` for Restore.
 * - `conflict` notice: tab was dirty, so we kept `source` and recorded the
 *   disk version. The user picks Reload / Keep mine / Merge.
 *
 * The banner is read-only: every action dispatches a reducer action via
 * the callbacks wired in `App.tsx`.
 */
export function DiskChangeBanner({
  tab,
  onShowChanges,
  onRestorePrevious,
  onReloadFromDisk,
  onKeepMine,
  onMerge,
  onDismissNotice,
}: Props) {
  const notice = tab.diskNotice;
  if (!notice) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="print:hidden flex items-center gap-2 border-b bg-muted/40 px-3 py-1.5 text-xs text-foreground"
    >
      <span className="flex-1 truncate">
        {notice.kind === "reloaded"
          ? "File was changed on disk and reloaded"
          : "File changed on disk while you have unsaved changes"}
      </span>
      {notice.kind === "reloaded" ? (
        <>
          <Button variant="ghost" size="xs" onClick={onShowChanges}>
            Show changes
          </Button>
          <Button variant="outline" size="xs" onClick={onRestorePrevious}>
            Restore current version
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={onDismissNotice}
            aria-label="Dismiss notice"
            title="Dismiss"
          >
            <X />
          </Button>
        </>
      ) : (
        <>
          <Button variant="ghost" size="xs" onClick={onShowChanges}>
            Show changes
          </Button>
          <Button variant="ghost" size="xs" onClick={onReloadFromDisk}>
            Reload from disk
          </Button>
          <Button variant="outline" size="xs" onClick={onKeepMine}>
            Keep mine
          </Button>
          <Button variant="outline" size="xs" onClick={onMerge}>
            Merge changes
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={onDismissNotice}
            aria-label="Dismiss notice"
            title="Dismiss"
          >
            <X />
          </Button>
        </>
      )}
    </div>
  );
}
