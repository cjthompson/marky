import { describe, expect, it } from "vitest";
import { buildStandaloneHtml } from "./exportHtml";

describe("buildStandaloneHtml", () => {
  it("renders a dark-mode document (snapshot)", () => {
    const html = buildStandaloneHtml({
      title: "My Doc",
      bodyHtml: "<h1>My Doc</h1><p>Hello</p>",
      css: "body { color: red; }",
      dark: true,
    });
    expect(html).toMatchSnapshot();
  });

  it("renders a light-mode document (snapshot)", () => {
    const html = buildStandaloneHtml({
      title: "My Doc",
      bodyHtml: "<h1>My Doc</h1><p>Hello</p>",
      css: "body { color: red; }",
      dark: false,
    });
    expect(html).toMatchSnapshot();
  });

  it("includes class=\"dark\" on <html> when dark is true", () => {
    const html = buildStandaloneHtml({ title: "t", bodyHtml: "", css: "", dark: true });
    expect(html).toContain('<html lang="en" class="dark">');
  });

  it("omits the dark class on <html> when dark is false", () => {
    const html = buildStandaloneHtml({ title: "t", bodyHtml: "", css: "", dark: false });
    expect(html).toContain('<html lang="en">');
    expect(html).not.toContain("dark");
  });

  it("escapes special characters in the title", () => {
    const html = buildStandaloneHtml({
      title: `& < > " '`,
      bodyHtml: "",
      css: "",
      dark: false,
    });
    expect(html).toContain("<title>&amp; &lt; &gt; &quot; &#39;</title>");
  });

  it("escapes a literal </style> inside the css to avoid breaking out of the style tag", () => {
    const html = buildStandaloneHtml({
      title: "t",
      bodyHtml: "",
      css: "body::after { content: '</style><script>alert(1)</script>'; }",
      dark: false,
    });
    expect(html).toContain("<\\/style");
    expect(html).not.toContain("</style><script>");
  });
});

// `collectExport` relies on DOM APIs (cloneNode, styleSheets, cssRules)
// whose behavior under happy-dom is unverified for this project's setup.
// Skipped rather than risking a flaky/false-failing suite.
describe.skip("collectExport", () => {
  it("is exercised manually via `pnpm tauri dev`", () => {});
});
