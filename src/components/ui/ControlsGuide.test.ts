import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ControlsGuide } from "./ControlsGuide";

describe("ControlsGuide credit", () => {
  it("opens the case study in a new tab, so leaving cannot drop unsaved level edits", () => {
    const html = renderToStaticMarkup(
      createElement(ControlsGuide, {
        scheme: "keys",
        compact: false,
        touchActive: false,
        override: null,
        onSetOverride: () => {},
        onClose: () => {},
      }),
    );
    const link = html.match(/<a [^>]*rel="author[^"]*"[^>]*>/)?.[0] ?? "";
    expect(link).toContain('href="https://badcodes.dev/work/pixel-forge"');
    expect(link).toContain('target="_blank"');
    expect(link).toContain('rel="author noopener"');
  });
});
