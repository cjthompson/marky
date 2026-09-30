import * as React from "react";
import { createPortal } from "react-dom";
import { Pencil, AlertTriangle } from "lucide-react";
import { renderMarkdown } from "@/lib/markdown";
import { highlightCode } from "@/lib/highlight";
import { renderMermaidBlocks, renderMermaidSource } from "@/lib/mermaid";
import { attachCopyButtons } from "@/components/CodeCopyOverlay";
import { handleCopyAsMarkdown } from "@/lib/copyAsMarkdown";
import { BlockEditor } from "@/components/BlockEditor";
import { findEditableBlock, parseSourceMap, toggleTaskAt } from "@/lib/sourceEdit";
import { useTheme } from "@/lib/theme";
import { usePreferences } from "@/lib/preferences";
import type { Diagnostic } from "@/lib/workspace";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

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
  /** Lint diagnostics for the current source. */
  diagnostics?: Diagnostic[];
}

const scrollMemory = new Map<string, number>();

/** Find diagnostics whose line range intersects a block's [start, end] range. */
function diagnosticsForBlock(diags: Diagnostic[], start: number, end: number): Diagnostic[] {
  return diags.filter((d) => d.line >= start && d.line <= end);
}

export function Viewer({
  source,
  filePath,
  articleRef,
  onRendered,
  mode,
  onCommitBlock,
  onToggleCheckbox,
  diagnostics,
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

  // Sync pass before paint: apply any cache hits so the article never flashes
  // plain text. `highlightCode` and `renderMermaidSource` resolve immediately
  // on a hit, so awaiting them here is cheap; misses fall through to the async
  // effect below.
  React.useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;

    const codeBlocks = root.querySelectorAll<HTMLElement>("pre > code[class*='language-']");
    for (const code of Array.from(codeBlocks)) {
      const cls = code.className;
      const match = cls.match(/language-([\w+-]+)/);
      const lang = match?.[1];
      const text = code.textContent || "";
      // Synchronous on cache hits, falls through on a miss.
      void highlightCode(text, lang, resolved).then((highlighted) => {
        const pre = code.parentElement;
        if (!pre || !pre.isConnected || !pre.parentElement) return;
        const tpl = document.createElement("template");
        tpl.innerHTML = highlighted.trim();
        const replacement = tpl.content.firstElementChild;
        if (!replacement) return;
        const sourceMap = pre.getAttribute("data-source-map");
        if (sourceMap) replacement.setAttribute("data-source-map", sourceMap);
        pre.replaceWith(replacement);
      });
    }

    const mermaidBlocks = root.querySelectorAll<HTMLPreElement>("pre.mermaid-pending");
    for (const pre of Array.from(mermaidBlocks)) {
      const source = pre.textContent || "";
      void renderMermaidSource(source, resolved).then((svg) => {
        if (!pre.isConnected || !pre.parentElement) return;
        const wrapper = document.createElement("div");
        wrapper.className = "mermaid-block";
        wrapper.innerHTML = svg;
        const sourceMap = pre.getAttribute("data-source-map");
        if (sourceMap) wrapper.setAttribute("data-source-map", sourceMap);
        pre.replaceWith(wrapper);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html, resolved]);

  React.useEffect(() => {
    const root = ref.current;
    if (!root) return;
    let cancelled = false;

    (async () => {
      const codeBlocks = root.querySelectorAll<HTMLElement>("pre > code[class*='language-']");
      for (const code of Array.from(codeBlocks)) {
        // Skip blocks already replaced by the sync pass — those have no
        // remaining plain-text sibling.
        if (!code.isConnected || !code.parentElement) continue;
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

  // ---------- Margin markers (lint) ---------------------------------------

  const markers = React.useMemo(() => {
    if (!diagnostics || diagnostics.length === 0) return [];
    const root = ref.current;
    if (!root) return [];
    const scroller = scrollerRef.current;
    if (!scroller) return [];
    const scrollerRect = scroller.getBoundingClientRect();
    const seen = new Set<HTMLElement>();
    const out: {
      el: HTMLElement;
      top: number;
      blockStart: number;
      blockEnd: number;
      diags: Diagnostic[];
    }[] = [];
    for (const el of root.querySelectorAll<HTMLElement>("[data-source-map]")) {
      const map = parseSourceMap(el.getAttribute("data-source-map"));
      if (!map) continue;
      const blockDiags = diagnosticsForBlock(diagnostics, map[0], map[1]);
      if (blockDiags.length === 0) continue;
      if (seen.has(el)) continue;
      seen.add(el);
      const rect = el.getBoundingClientRect();
      out.push({
        el,
        top: rect.top - scrollerRect.top + scroller.scrollTop,
        blockStart: map[0],
        blockEnd: map[1],
        diags: blockDiags,
      });
    }
    return out;
  }, [diagnostics, html]);

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
    <div ref={scrollerRef} className="relative h-full w-full overflow-auto print:h-auto print:overflow-visible">
      <article ref={ref} className="markdown-body" dangerouslySetInnerHTML={dangerousHtml} />
      {pencil}
      {markers.map((m) => (
        <Tooltip key={`${m.blockStart}-${m.blockEnd}`}>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={`${m.diags.length} problem${m.diags.length === 1 ? "" : "s"} on lines ${m.blockStart}-${m.blockEnd}`}
              className="marker-button pointer-events-auto absolute z-10 -translate-x-7 translate-y-1 inline-flex h-5 items-center gap-1 rounded px-1.5 text-[10px] font-medium text-destructive hover:bg-destructive hover:text-destructive-foreground"
              style={{
                top: m.top,
                left: -56,
                position: "absolute" as const,
              }}
              onClick={() => openEditorFor(m.el)}
            >
              <AlertTriangle className="h-3 w-3" />
              {m.diags.length}
            </button>
          </TooltipTrigger>
          <TooltipContent side="left">
            <div className="space-y-0.5">
              {m.diags.slice(0, 5).map((d, i) => (
                <div key={`${d.rule}-${d.line}-${i}`} className="text-xs">
                  <span className="font-mono">{d.rule}</span>: {d.message}
                </div>
              ))}
              {m.diags.length > 5 && (
                <div className="text-xs text-muted-foreground">+{m.diags.length - 5} more</div>
              )}
            </div>
          </TooltipContent>
        </Tooltip>
      ))}
      {editing &&
        createPortal(
          <BlockEditor
            initialText={editing.initialText}
            onCommit={handleCommit}
            onCancel={closeEditor}
            diagnostics={diagnosticsForBlock(diagnostics ?? [], editing.blockStart, editing.blockEnd)}
            sourceOffset={editing.blockStart - 1}
          />,
          editing.placeholder,
        )}
    </div>
  );
}
