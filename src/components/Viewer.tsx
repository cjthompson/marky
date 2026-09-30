import * as React from "react";
import { createPortal } from "react-dom";
import { Pencil } from "lucide-react";
import { renderMarkdown } from "@/lib/markdown";
import { highlightCode } from "@/lib/highlight";
import { renderMermaidBlocks } from "@/lib/mermaid";
import { attachCopyButtons } from "@/components/CodeCopyOverlay";
import { handleCopyAsMarkdown } from "@/lib/copyAsMarkdown";
import { BlockEditor } from "@/components/BlockEditor";
import { findEditableBlock, parseSourceMap, replaceLines, toggleTaskAt } from "@/lib/sourceEdit";
import { useTheme } from "@/lib/theme";
import { usePreferences } from "@/lib/preferences";

interface Props {
  source: string;
  filePath?: string;
  articleRef?: React.RefObject<HTMLElement | null>;
  onRendered?: () => void;
  mode: "read" | "edit";
  /** Commit a spliced block edit (start/end are 1-based, inclusive). */
  onCommitBlock?: (start: number, end: number, newText: string) => void;
  /** Persist a checkbox toggle for the line containing `el`. */
  onToggleCheckbox?: (line: number) => void;
}

const scrollMemory = new Map<string, number>();

export function Viewer({
  source,
  filePath,
  articleRef,
  onRendered,
  mode,
  onCommitBlock,
  onToggleCheckbox,
}: Props) {
  const internalRef = React.useRef<HTMLElement>(null);
  const ref = (articleRef ?? internalRef) as React.RefObject<HTMLElement | null>;
  const scrollerRef = React.useRef<HTMLDivElement>(null);
  const { resolved } = useTheme();
  const { copyAsMarkdown } = usePreferences();
  const [html, setHtml] = React.useState("");
  const [editing, setEditing] = React.useState<{
    placeholder: HTMLElement;
    blockStart: number;
    blockEnd: number;
    initialText: string;
  } | null>(null);
  const [hoverEl, setHoverEl] = React.useState<HTMLElement | null>(null);

  // Keep onRendered fresh without making it a dep — otherwise every parent
  // re-render produces a new fn ref, retriggers the highlight effect, and the
  // resulting outerHTML swap visibly flickers code blocks back to plain text.
  const onRenderedRef = React.useRef(onRendered);
  React.useEffect(() => {
    onRenderedRef.current = onRendered;
  }, [onRendered]);

  React.useEffect(() => {
    setHtml(renderMarkdown(source));
  }, [source]);

  // Re-render: cancel any open block edit; the parent's source has changed
  // and the editor's `initialText` is stale.
  React.useEffect(() => {
    setEditing(null);
  }, [source]);

  React.useEffect(() => {
    const root = ref.current;
    if (!root) return;
    let cancelled = false;

    (async () => {
      const codeBlocks = root.querySelectorAll<HTMLElement>("pre > code[class*='language-']");
      for (const code of Array.from(codeBlocks)) {
        const cls = code.className;
        const match = cls.match(/language-([\w+-]+)/);
        const lang = match?.[1];
        const text = code.textContent || "";
        try {
          const highlighted = await highlightCode(text, lang, resolved);
          if (cancelled) return;
          const pre = code.parentElement;
          if (!pre || !pre.isConnected) continue;
          const tpl = document.createElement("template");
          tpl.innerHTML = highlighted.trim();
          const replacement = tpl.content.firstElementChild;
          if (replacement) {
            const sourceMap = pre.getAttribute("data-source-map");
            if (sourceMap) replacement.setAttribute("data-source-map", sourceMap);
            pre.replaceWith(replacement);
          }
        } catch {
          // leave plain on failure
        }
      }
      if (cancelled) return;
      attachCopyButtons(root as HTMLElement);
      await renderMermaidBlocks(root as HTMLElement, resolved);
      if (!cancelled) onRenderedRef.current?.();
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html, resolved]);

  React.useEffect(() => {
    const el = scrollerRef.current;
    if (!el || !filePath) return;
    const saved = scrollMemory.get(filePath) ?? 0;
    el.scrollTop = saved;
    const onScroll = () => scrollMemory.set(filePath, el.scrollTop);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [filePath, html]);

  // Intercept copy events to write original markdown source to clipboard.
  React.useEffect(() => {
    const root = ref.current;
    if (!root || !copyAsMarkdown) return;
    const onCopy = (e: ClipboardEvent) => {
      handleCopyAsMarkdown(e, root as HTMLElement, source);
    };
    root.addEventListener("copy", onCopy);
    return () => root.removeEventListener("copy", onCopy);
  }, [source, copyAsMarkdown]);

  // ---------- Pencil + hover ----------------------------------------------

  React.useEffect(() => {
    const root = ref.current;
    if (!root || !onCommitBlock) return;

    const handlePointerMove = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target || !root.contains(target)) {
        setHoverEl(null);
        return;
      }
      const block = findEditableBlock(target);
      setHoverEl(block?.element ?? null);
    };
    const handlePointerLeave = () => setHoverEl(null);
    root.addEventListener("pointermove", handlePointerMove);
    root.addEventListener("pointerleave", handlePointerLeave);
    return () => {
      root.removeEventListener("pointermove", handlePointerMove);
      root.removeEventListener("pointerleave", handlePointerLeave);
    };
  }, [onCommitBlock]);

  // ---------- Open / close block editor ------------------------------------

  const openEditorFor = React.useCallback(
    (el: HTMLElement) => {
      if (!onCommitBlock) return;
      const block = findEditableBlock(el);
      if (!block) return;
      // Pull the existing source lines out of `source`.
      const startLine = block.start;
      const endLine = block.end;
      const eol = source.includes("\r\n") ? "\r\n" : "\n";
      const lines = source.replace(/\r\n/g, "\n").split("\n");
      const slice = lines.slice(startLine - 1, endLine).join("\n");

      // Build a placeholder of the same tag and hide the original.
      const placeholder = document.createElement(block.element.tagName);
      const sourceMap = block.element.getAttribute("data-source-map");
      if (sourceMap) placeholder.setAttribute("data-source-map", sourceMap);
      block.element.style.display = "none";
      block.element.parentElement?.insertBefore(placeholder, block.element);

      setEditing({
        placeholder,
        blockStart: startLine,
        blockEnd: endLine,
        initialText: slice,
      });
    },
    [onCommitBlock, source],
  );

  const closeEditor = React.useCallback(() => {
    setEditing(null);
    // Show the hidden original element again.
    const hidden = ref.current?.querySelectorAll<HTMLElement>("[style*='display: none']");
    hidden?.forEach((el) => {
      if (el.style.display === "none") el.style.display = "";
    });
  }, []);

  const handleCommit = React.useCallback(
    (text: string) => {
      if (!editing) return;
      if (onCommitBlock) {
        onCommitBlock(editing.blockStart, editing.blockEnd, text);
      }
      closeEditor();
    },
    [editing, onCommitBlock, closeEditor],
  );

  // ---------- Event delegation: dblclick, click, checkbox ------------------

  React.useEffect(() => {
    const root = ref.current;
    if (!root) return;

    const onDblClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target || !root.contains(target)) return;
      openEditorFor(target);
    };

    const onClick = (event: MouseEvent) => {
      if (mode !== "edit") return;
      const target = event.target as HTMLElement | null;
      if (!target || !root.contains(target)) return;
      // Skip links/buttons/checkboxes that handle their own click.
      const link = (event.target as HTMLElement).closest("a, button, input, label, .task-list-item input");
      if (link) return;
      // Skip if the user is selecting text (drag-select).
      if (window.getSelection()?.toString()) return;
      openEditorFor(target);
    };

    const onCheckboxClick = (event: MouseEvent) => {
      if (mode !== "edit") return;
      const target = event.target as HTMLElement | null;
      if (!target) return;
      const cb = target.closest('input[type="checkbox"]') as HTMLInputElement | null;
      if (!cb) return;
      // Native toggle already happened; we override and edit the source line.
      event.preventDefault();
      const li = cb.closest("li");
      const lineAttr = li?.parentElement?.parentElement?.getAttribute("data-source-map");
      // We don't have a 1:1 mapping; fall back to the task-list item's map.
      const liMap = li?.getAttribute("data-source-map") ?? li?.parentElement?.getAttribute("data-source-map");
      const map = parseSourceMap(liMap ?? lineAttr);
      if (map && onToggleCheckbox) {
        onToggleCheckbox(map[0]);
      }
    };

    root.addEventListener("dblclick", onDblClick);
    root.addEventListener("click", onClick);
    root.addEventListener("click", onCheckboxClick, true);
    return () => {
      root.removeEventListener("dblclick", onDblClick);
      root.removeEventListener("click", onClick);
      root.removeEventListener("click", onCheckboxClick, true);
    };
  }, [mode, openEditorFor, onToggleCheckbox]);

  // ---------- Render -------------------------------------------------------

  const dangerousHtml = React.useMemo(() => ({ __html: html }), [html]);

  // Pencil button (rendered absolutely in the scroller so it floats with the
  // hovered block). Only show in Edit mode OR for hover-only affordance.
  const pencil = hoverEl && !editing && onCommitBlock ? (
    <button
      type="button"
      aria-label="Edit block"
      className="pointer-events-auto absolute z-10 -translate-x-6 translate-y-1 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
      style={{
        // Place it just to the left of the hovered element's bounding box.
        top: hoverEl.getBoundingClientRect().top - (scrollerRef.current?.getBoundingClientRect().top ?? 0) + scrollerRef.current!.scrollTop,
        left: -28,
        position: "absolute" as const,
      }}
      onMouseDown={(e) => {
        e.preventDefault();
        openEditorFor(hoverEl);
      }}
    >
      <Pencil className="h-3.5 w-3.5" />
    </button>
  ) : null;

  return (
    <div ref={scrollerRef} className="relative h-full w-full overflow-auto">
      <article ref={ref} className="markdown-body" dangerouslySetInnerHTML={dangerousHtml} />
      {pencil}
      {editing &&
        createPortal(
          <BlockEditor
            initialText={editing.initialText}
            onCommit={handleCommit}
            onCancel={closeEditor}
          />,
          editing.placeholder,
        )}
    </div>
  );
}