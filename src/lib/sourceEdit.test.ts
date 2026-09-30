import { describe, expect, it } from "vitest";
import {
  blockForLine,
  detectEol,
  findEditableBlock,
  lineForElement,
  parseSourceMap,
  replaceLines,
  splitLines,
  toggleTaskAt,
} from "./sourceEdit";

describe("detectEol", () => {
  it("defaults to LF when no CRLF present", () => {
    expect(detectEol("a\nb\n")).toBe("\n");
    expect(detectEol("a\nb")).toBe("\n");
  });

  it("returns CRLF when present anywhere", () => {
    expect(detectEol("a\r\nb\n")).toBe("\r\n");
    expect(detectEol("\r\n")).toBe("\r\n");
  });
});

describe("replaceLines", () => {
  it("replaces a middle range with LF", () => {
    expect(replaceLines("a\nb\nc\nd\n", 2, 3, "B-X\n", "\n")).toBe("a\nB-X\nd\n");
  });

  it("replaces the first line", () => {
    expect(replaceLines("a\nb\nc\n", 1, 1, "A-new\n", "\n")).toBe("A-new\nb\nc\n");
  });

  it("replaces the last line preserving the trailing newline", () => {
    expect(replaceLines("a\nb\nc\n", 3, 3, "C-new\n", "\n")).toBe("a\nb\nC-new\n");
  });

  it("omits the trailing newline when source had none", () => {
    expect(replaceLines("a\nb\nc", 3, 3, "C-new\n", "\n")).toBe("a\nb\nC-new");
  });

  it("preserves CRLF end-to-end", () => {
    const crlf = "a\r\nb\r\nc\r\n";
    const out = replaceLines(crlf, 2, 2, "B-x\r\n", "\r\n");
    expect(out).toBe("a\r\nB-x\r\nc\r\n");
    expect(detectEol(out)).toBe("\r\n");
  });

  it("handles an empty replacement (line deletion)", () => {
    expect(replaceLines("a\nb\nc\nd\n", 2, 3, "", "\n")).toBe("a\nd\n");
  });
});

describe("splitLines", () => {
  it("splits LF sources and drops the trailing empty entry", () => {
    expect(splitLines("a\nb\n", "\n")).toEqual(["a", "b"]);
  });

  it("returns empty array for empty input", () => {
    expect(splitLines("", "\n")).toEqual([]);
  });

  it("splits CRLF sources", () => {
    expect(splitLines("a\r\nb\r\n", "\r\n")).toEqual(["a", "b"]);
  });
});

describe("parseSourceMap", () => {
  it("parses well-formed values", () => {
    expect(parseSourceMap("12,34")).toEqual([12, 34]);
  });

  it("returns null for malformed values", () => {
    expect(parseSourceMap(null)).toBeNull();
    expect(parseSourceMap("abc,def")).toBeNull();
    expect(parseSourceMap("12")).toBeNull();
  });
});

describe("findEditableBlock", () => {
  function build(html: string): HTMLElement {
    const root = document.createElement("div");
    root.innerHTML = html;
    return root;
  }

  it("returns the deepest element with a source map", () => {
    const root = build(
      '<div data-source-map="1,5"><p data-source-map="1,1">hi</p><p data-source-map="2,5">there</p></div>',
    );
    const target = root.querySelectorAll("p")[1];
    const r = findEditableBlock(target as HTMLElement)!;
    expect(r.element.getAttribute("data-source-map")).toBe("2,5");
    expect(r.start).toBe(2);
    expect(r.end).toBe(5);
  });

  it("promotes to the whole table when target is inside one", () => {
    const root = build(
      '<table data-source-map="10,20"><tr><td data-source-map="11,12">cell</td></tr></table>',
    );
    const cell = root.querySelector("td")!;
    const r = findEditableBlock(cell as HTMLElement)!;
    expect(r.element.tagName.toLowerCase()).toBe("table");
    expect(r.start).toBe(10);
  });

  it("promotes to the whole pre/code block", () => {
    const root = build(
      '<pre data-source-map="3,8"><code data-source-map="4,4">x</code>more</pre>',
    );
    const code = root.querySelector("code")!;
    const r = findEditableBlock(code as HTMLElement)!;
    expect(r.element.tagName.toLowerCase()).toBe("pre");
    expect(r.start).toBe(3);
  });

  it("returns null when no source map is found above the target", () => {
    const root = build("<div>orphan</div>");
    const div = root.querySelector("div")!;
    expect(findEditableBlock(div as HTMLElement)).toBeNull();
  });
});

describe("toggleTaskAt", () => {
  it("flips [ ] to [x]", () => {
    expect(toggleTaskAt("- [ ] task\n", 1)).toBe("- [x] task\n");
  });

  it("flips [x] to [ ]", () => {
    expect(toggleTaskAt("- [x] task\n", 1)).toBe("- [ ] task\n");
  });

  it("flips uppercase [X] to [ ]", () => {
    expect(toggleTaskAt("* [X] task\n", 1)).toBe("* [ ] task\n");
  });

  it("leaves non-task lines alone", () => {
    expect(toggleTaskAt("plain line\n", 1)).toBe("plain line\n");
  });

  it("operates on the right line", () => {
    expect(toggleTaskAt("a\n- [ ] task\nc\n", 2)).toBe("a\n- [x] task\nc\n");
    expect(toggleTaskAt("a\n- [ ] task\nc\n", 1)).toBe("a\n- [ ] task\nc\n");
  });
});

describe("blockForLine / lineForElement", () => {
  function build(html: string): HTMLElement {
    const root = document.createElement("div");
    root.innerHTML = html;
    return root;
  }

  it("returns the element whose range contains the line", () => {
    const root = build(
      '<p data-source-map="1,3">a</p><p data-source-map="4,6">b</p>',
    );
    expect(blockForLine(root as HTMLElement, 5)?.textContent).toBe("b");
    expect(blockForLine(root as HTMLElement, 99)).toBeNull();
  });

  it("round-trips with lineForElement", () => {
    const root = build('<p data-source-map="7,9">x</p>');
    const el = root.querySelector("p")!;
    expect(lineForElement(el as HTMLElement)).toBe(7);
    expect(blockForLine(root as HTMLElement, 7)).toBe(el);
  });
});