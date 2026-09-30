/**
 * Frontend wrapper around the Rust `lint_markdown` command plus a helper that
 * converts our `Diagnostic[]` into the shape `@codemirror/lint` wants.
 *
 * The `lintEnabled` preference gates every call site — see `App.tsx`. The 400
 * ms debounce for Source view typing lives in `App.tsx` keyed by tab id, so a
 * slow parse on one tab doesn't stall another.
 */
import { type Extension } from "@codemirror/state";
import {
  lintGutter,
  setDiagnosticsEffect,
  type Diagnostic as CmDiagnostic,
} from "@codemirror/lint";
import { tauri, type Diagnostic } from "@/lib/tauri";
import type { TabState } from "@/lib/workspace";

const DEBOUNCE_MS = 400;

/** Fetch lint diagnostics for a tab's current source. */
export async function runLintFor(tab: TabState): Promise<Diagnostic[]> {
  if (!tab.filePath) return [];
  try {
    return await tauri.lintMarkdown(tab.filePath, tab.source);
  } catch {
    return [];
  }
}

/**
 * Map our `Diagnostic` (1-indexed line/col) to `@codemirror/lint`'s
 * `Diagnostic` (0-indexed document offsets). `sourceOffset` subtracts from
 * line/col so a block-local slice (BlockEditor) shows the right ranges.
 *
 * Lines that fall outside the slice get clipped to the slice's last line;
 * the plan calls this "rendered clipped" rather than dropped, so a
 * diagnostic that straddles a block boundary still surfaces a hint.
 */
export function diagnosticsToCodeMirror(
  source: string,
  diagnostics: Diagnostic[],
  sourceOffset = 0,
): CmDiagnostic[] {
  const lines = source.split("\n");
  const out: CmDiagnostic[] = [];
  for (const d of diagnostics) {
    const localLine = d.line - sourceOffset;
    if (localLine < 1) continue;
    const lastLine = lines.length;
    const endLocalLine = Math.min(Math.max(d.end_line - sourceOffset, localLine), lastLine);

    const from = lineColToOffset(lines, localLine, d.column);
    const to = lineColToOffset(lines, endLocalLine, d.end_column);
    if (to <= from) {
      out.push(buildCmDiagnostic(source, lines, sourceOffset, d, from, from + 1));
      continue;
    }
    out.push(buildCmDiagnostic(source, lines, sourceOffset, d, from, to));
  }
  return out;
}

function buildCmDiagnostic(
  source: string,
  lines: string[],
  sourceOffset: number,
  d: Diagnostic,
  from: number,
  to: number,
): CmDiagnostic {
  const severity =
    d.severity === "error"
      ? "error"
      : d.severity === "warning"
        ? "warning"
        : "info";
  const cm: CmDiagnostic = {
    from,
    to,
    severity,
    message: d.message,
    source: d.rule,
  };
  if (d.fix) {
    const fix = d.fix;
    cm.actions = [
      {
        name: "Apply fix",
        apply: (view) => {
          // Translate the (from_line, from_col, to_line, to_col) back to
          // document offsets in the editor's local coordinate system.
          const doc = view.state.doc.toString();
          const localLines = doc.split("\n");
          const a = lineColToOffset(localLines, fix.from_line - sourceOffset, fix.from_col);
          const b = lineColToOffset(localLines, fix.to_line - sourceOffset, fix.to_col);
          view.dispatch({ changes: { from: a, to: b, insert: fix.replacement } });
        },
      },
    ];
  }
  // Quiet the unused-source warning while keeping the variable for future
  // debugging helpers.
  void source;
  void lines;
  return cm;
}

/**
 * Build the lint extensions to install at editor mount time. Callers wire
 * these into `EditorState.create.extensions`; the lint gutter and underlines
 * become visible immediately. Returns an array so editors can mix it with
 * their other extensions.
 */
export function lintDiagnosticsStatic(
  source: string,
  diagnostics: Diagnostic[],
  sourceOffset = 0,
): Extension[] {
  const cm: Extension[] = [
    lintGutter(),
    setDiagnosticsEffect.of(diagnosticsToCodeMirror(source, diagnostics, sourceOffset)) as unknown as Extension,
  ];
  return cm;
}

/** Convert (1-indexed line, 1-indexed column) to a 0-indexed doc offset. */
function lineColToOffset(lines: string[], line: number, col: number): number {
  const lineIdx = Math.max(1, Math.min(lines.length, line)) - 1;
  let offset = 0;
  for (let i = 0; i < lineIdx; i++) offset += lines[i].length + 1;
  const lineText = lines[lineIdx] ?? "";
  const charOffset = Math.max(0, Math.min(lineText.length, col - 1));
  // Use byte length so the offset lines up with CodeMirror's positions
  // (which are character offsets, but our column is 1-indexed char count —
  // for ASCII text the two coincide).
  offset += lineText.slice(0, charOffset).length;
  return offset;
}

/** Per-tab debounced lint runner. Keyed by tab id so independent tabs don't share state. */
export class DebouncedLint {
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private lastSeq = new Map<string, number>();

  schedule(tabId: string, tab: TabState, run: (diags: Diagnostic[]) => void) {
    const seq = (this.lastSeq.get(tabId) ?? 0) + 1;
    this.lastSeq.set(tabId, seq);
    const prev = this.timers.get(tabId);
    if (prev) clearTimeout(prev);
    const timer = setTimeout(async () => {
      const diags = await runLintFor(tab);
      if (this.lastSeq.get(tabId) !== seq) return;
      run(diags);
    }, DEBOUNCE_MS);
    this.timers.set(tabId, timer);
  }

  cancel(tabId: string) {
    const prev = this.timers.get(tabId);
    if (prev) clearTimeout(prev);
    this.timers.delete(tabId);
  }

  flush() {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }
}

export const DEFAULT_DEBOUNCE_MS = DEBOUNCE_MS;
