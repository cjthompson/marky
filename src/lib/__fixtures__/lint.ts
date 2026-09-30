// Markdown fixtures used by `lint.test.ts`. Kept small so the unit tests stay
// fast — rumdl itself does the heavy parsing.

// MD001 — non-monotonic heading increment: H1 → H3 with H2 skipped.
export const HEADING_INCREMENT = "# H1\n\n### H3 skip\n\n## H2\n";

// MD092 — three-way merge conflict markers from diffy.
export const CONFLICT_MARKERS = "<<<<<<< HEAD\nline1\n=======\nline2\n>>>>>>> branch\n";

// Front matter with an unclosed YAML flow sequence.
export const BAD_FRONTMATTER = "---\ntitle: Test\ninvalid: [unclosed bracket\n---\n\n# Body\n";

// A 200-char single line — proves MD013 is off by default.
export const LONG_LINE = "# H\n\n" + "a".repeat(200);

// Plain markdown without front matter, used to assert no false positive.
export const NO_FRONTMATTER = "# Just a heading\n\nNo front matter here.";
