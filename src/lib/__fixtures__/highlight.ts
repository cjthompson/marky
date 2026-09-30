// Short TS (and a couple of other-language) snippets used by `highlight.test.ts`.
// Keep these tiny — Shiki grammar loading is expensive in unit tests, and the
// tests only care that the cache key round-trips correctly.

export const TS_SAMPLE = "const x: number = 1;";

export const PY_SAMPLE = "def greet(name: str) -> str:\n    return f'hi {name}'";

export const BASH_SAMPLE = "echo hello";

// Same code, second language — exercises the "different lang" miss case.
export const TS_AS_JSON = "{\"x\": 1}";
