// Short mermaid source strings used by `mermaid.test.ts`. Kept small so the
// browser-side `mermaid.render` call stays fast — the tests only need a real
// mermaid render to populate the cache, not to assert on the SVG output.

export const FLOWCHART = "graph TD;A-->B;";

export const SEQUENCE = "sequenceDiagram\nA->>B: hi";

export const INVALID = "this is not valid mermaid !! @@";
