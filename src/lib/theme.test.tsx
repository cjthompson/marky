import { describe, it, expect, beforeEach } from "vitest";
import { renderToString } from "react-dom/server";
import { ThemeProvider, useTheme } from "./theme";

function Probe() {
  const { theme, resolved } = useTheme();
  return <span data-testid="probe">{`${theme}:${resolved}`}</span>;
}

describe("ThemeProvider", () => {
  beforeEach(() => {
    // vitest+happy-dom does not expose `localStorage` as a global in every
    // setup; the provider is defensive about that, and so is the test setup.
    if (typeof localStorage !== "undefined") {
      localStorage.clear();
    }
    document.documentElement.classList.remove("dark");
  });

  it("provides a theme context (SSR string render smoke)", () => {
    const html = renderToString(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>
    );
    expect(html).toContain("system:");
  });

  it("throws if useTheme used outside provider", () => {
    expect(() => renderToString(<Probe />)).toThrow();
  });
});
