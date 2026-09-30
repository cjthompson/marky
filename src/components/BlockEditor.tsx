import { useEffect, useRef } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { extensionsForSource } from "@/lib/codemirror";
import { detectEol } from "@/lib/sourceEdit";

interface Props {
  /** Source lines that this block replaces. */
  initialText: string;
  /** Save the new source and close. If the editor is unchanged, no-op. */
  onCommit: (text: string) => void;
  /** Close without saving. */
  onCancel: () => void;
}

/**
 * Inline CodeMirror editor used by Viewer to edit a single block in place.
 *
 * The editor owns its initial text; on `Esc` or `⌘Enter` it commits; on
 * click-outside it commits. The editor does not write back on every
 * keystroke — it returns the final text to the parent so the source map
 * and history get updated exactly once per commit.
 */
export function BlockEditor({ initialText, onCommit, onCancel }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const state = EditorState.create({
      doc: initialText,
      extensions: [
        ...extensionsForSource(initialText || "\n"),
        EditorView.domEventHandlers({
          // Click outside the editor → commit.
          click: (event, view) => {
            const target = event.target as Node;
            if (!view.dom.contains(target)) {
              commit(view);
              return true;
            }
            return false;
          },
        }),
        EditorView.theme({
          "&": { minHeight: "1.5em" },
          ".cm-scroller": { fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, monospace)" },
        }),
      ],
    });

    const view = new EditorView({ state, parent: host });
    viewRef.current = view;
    view.focus();

    const commit = (v: EditorView) => {
      const text = v.state.doc.toString();
      if (text === initialText) {
        onCancel();
      } else {
        // Preserve the line ending of the original block.
        const eol = detectEol(text) || detectEol(initialText);
        const finalText = text.endsWith("\n") ? text : text + eol;
        onCommit(finalText);
      }
    };

    // Wire Esc / ⌘Enter to commit. Kept outside the React render so the
    // listener captures the `commit` closure above.
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!viewRef.current) return;
      if (e.key === "Escape") {
        e.preventDefault();
        commit(viewRef.current);
      } else if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        commit(viewRef.current);
      }
    };
    host.addEventListener("keydown", handleKeyDown);

    return () => {
      host.removeEventListener("keydown", handleKeyDown);
      view.destroy();
      viewRef.current = null;
    };
    // We intentionally do not re-run on `initialText`/`onCommit` changes —
    // the editor instance is built once per block; the parent creates a
    // new BlockEditor to re-mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={hostRef} className="block-editor my-2 rounded border border-border bg-background" />;
}