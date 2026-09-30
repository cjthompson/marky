import { useEffect, useRef } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { extensionsForSource } from "@/lib/codemirror";
import { lintDiagnosticsStatic } from "@/lib/lint";
import type { Diagnostic } from "@/lib/workspace";

interface Props {
  source: string;
  /** Called on every edit. Debouncing to ~400 ms lives in the parent. */
  onSourceChange?: (next: string) => void;
  /** Set true when the user is in Edit mode; false in Read mode. */
  editable: boolean;
  /** Lint diagnostics for the current source (1-indexed line/col). */
  diagnostics?: Diagnostic[];
}

/**
 * Full-document CodeMirror editor used as the Source view for a tab.
 *
 * Read mode shows the source as a non-editable view with markdown
 * highlighting and folding; Edit mode lets the user type and pushes every
 * change up through `onSourceChange`. Lint diagnostics surface as gutter
 * marks, underlines, and hover messages via `@codemirror/lint`. Quick-fix
 * actions appear when rumdl attaches a `fix` payload.
 */
export function SourceView({ source, onSourceChange, editable, diagnostics }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const state = EditorState.create({
      doc: source,
      extensions: [
        ...extensionsForSource(source),
        lintDiagnosticsStatic(source, diagnostics ?? []),
        EditorView.editable.of(editable),
        EditorState.readOnly.of(!editable),
        onSourceChange
          ? EditorView.updateListener.of((u) => {
              if (u.docChanged) onSourceChange(u.state.doc.toString());
            })
          : [],
      ],
    });
    const view = new EditorView({ state, parent: host });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Re-mount on source mode flips; we keep the editor fresh on `source`
    // changes too, so the textarea tracks the workspace reducer exactly.
  }, [source, editable, onSourceChange, diagnostics]);

  // Keep CodeMirror's `editable` in sync with the prop without remounting
  // the whole view.
  useEffect(() => {
    viewRef.current?.dispatch({ effects: [] });
  }, [editable]);

  return <div ref={hostRef} className="h-full overflow-auto p-4" />;
}
