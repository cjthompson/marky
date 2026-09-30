import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { diagnosticsToCodeMirror } from "./lint";
import type { Diagnostic } from "./workspace";

function makeDiag(over: Partial<Diagnostic> = {}): Diagnostic {
  return {
    line: 1,
    column: 1,
    end_line: 1,
    end_column: 2,
    rule: "MD000",
    message: "test",
    severity: "warning",
    ...over,
  };
}

describe("diagnosticsToCodeMirror offset shifting", () => {
  it("returns no diagnostics when source is empty", () => {
    const out = diagnosticsToCodeMirror("", []);
    expect(out).toEqual([]);
  });

  it("shifts line numbers when sourceOffset is non-zero", () => {
    // Diagnostic on tab-global line 50 should render as line 1 in the slice.
    const diag = makeDiag({ line: 50, end_line: 50, column: 1, end_column: 2 });
    const slice = "just one line of content";
    const out = diagnosticsToCodeMirror(slice, [diag], 49);
    expect(out).toHaveLength(1);
    // Both from/to should be near the start of the slice.
    expect(out[0].from).toBe(0);
    expect(out[0].to).toBeGreaterThan(0);
  });

  it("drops diagnostics that fall before the block slice", () => {
    // Diagnostic on tab-global line 5 with sourceOffset 10 → before the slice.
    const diag = makeDiag({ line: 5 });
    const slice = "any text here";
    const out = diagnosticsToCodeMirror(slice, [diag], 10);
    expect(out).toEqual([]);
  });

  it("clips diagnostics that straddle the slice's end", () => {
    // Source has 3 lines; diagnostic on line 10 (way past the slice end)
    // should still render — clipped to the last line.
    const diag = makeDiag({ line: 10, end_line: 12, column: 1, end_column: 5 });
    const slice = "a\nb\nc";
    const out = diagnosticsToCodeMirror(slice, [diag], 0);
    expect(out).toHaveLength(1);
    // from/to should be at or beyond the start of the last line.
    expect(out[0].from).toBeGreaterThanOrEqual(slice.indexOf("c"));
  });

  it("maps severity from rumdl to CodeMirror conventions", () => {
    const errDiag = makeDiag({ line: 1, end_line: 1, column: 1, end_column: 1, severity: "error" });
    const infoDiag = makeDiag({ line: 1, end_line: 1, column: 1, end_column: 1, severity: "info" });
    const slice = "x";
    const out = diagnosticsToCodeMirror(slice, [errDiag, infoDiag], 0);
    expect(out[0].severity).toBe("error");
    expect(out[1].severity).toBe("info");
  });
});

describe("debounce helper", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs the lint callback once after the debounce window", async () => {
    const { DebouncedLint } = await import("./lint");
    const dl = new DebouncedLint();
    const run = vi.fn();
    dl.schedule("tab1", {
      id: "tab1",
      filePath: "/tmp/a.md",
      title: "a.md",
      source: "x",
      savedSource: "x",
      mode: "read",
      view: "rendered",
      history: [],
      future: [],
    }, run);

    // No run yet — still inside the 400 ms window.
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(450);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("collapses rapid schedule() calls into a single run", async () => {
    const { DebouncedLint } = await import("./lint");
    const dl = new DebouncedLint();
    const run = vi.fn();
    const tab = {
      id: "tab1",
      filePath: "/tmp/a.md",
      title: "a.md",
      source: "x",
      savedSource: "x",
      mode: "read" as const,
      view: "rendered" as const,
      history: [],
      future: [],
    };
    dl.schedule("tab1", tab, run);
    await vi.advanceTimersByTimeAsync(100);
    dl.schedule("tab1", tab, run);
    await vi.advanceTimersByTimeAsync(100);
    dl.schedule("tab1", tab, run);
    await vi.advanceTimersByTimeAsync(450);
    expect(run).toHaveBeenCalledTimes(1);
  });
});
