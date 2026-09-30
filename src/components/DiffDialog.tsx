import { useEffect, useRef } from "react";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { unifiedMergeView } from "@codemirror/merge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { extensionsForSource } from "@/lib/codemirror";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** "Original" side of the diff. Becomes the `unifiedMergeView` baseline. */
  original: string;
  /** "Modified" side of the diff. Edits here are local; the dialog is read-only. */
  modified: string;
}

/**
 * Read-only diff dialog built on `@codemirror/merge`'s `unifiedMergeView`.
 *
 * Used for both clean-tab ("previous vs current disk content") and dirty-tab
 * ("yours vs disk") flows. The editor is mounted fresh each time `open`
 * flips to `true` so the new strings are picked up; we keep `original`'s EOL
 * so a CRLF file does not visually flatten to LF on a conflict-resolution
 * preview.
 */
export function DiffDialog({ open, onOpenChange, title, original, modified }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);

  useEffect(() => {
    if (!open) return;
    const host = hostRef.current;
    if (!host) return;

    const baseExtensions: Extension[] = [
      ...extensionsForSource(original),
      EditorView.editable.of(false),
      EditorState.readOnly.of(true),
    ];
    const state = EditorState.create({
      doc: modified,
      extensions: [
        ...baseExtensions,
        unifiedMergeView({ original, gutter: true, collapseUnchanged: {} }),
      ],
    });
    const view = new EditorView({ state, parent: host });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [open, original, modified]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="-mx-2 max-h-[60vh] overflow-auto rounded border bg-background">
          <div ref={hostRef} className="cm-mergeView text-sm" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
