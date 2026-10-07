import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LAYOUT } from "@/design/tokens";

// The short-landscape layout lives in globals.css because the docks' layout is inline style, but the
// canvas fit and the renderer's insets read LAYOUT.shortBelt. The two must agree, or the level view
// is sized for a belt that is not there.
const css = readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8").replace(/\r\n/g, "\n");
const block = css.slice(css.indexOf("@media (max-height: 500px)"));
const px = (selector: string, prop: string) => {
  const rule = block.slice(block.indexOf(selector));
  const m = rule.slice(0, rule.indexOf("}")).match(new RegExp(`${prop}:\\s*(\\d+)px`));
  return m ? Number(m[1]) : NaN;
};

describe("short landscape layout", () => {
  it("draws the belt at LAYOUT.shortBelt", () => {
    expect(px(".pf-belt {", "height")).toBe(LAYOUT.shortBelt);
  });

  it("sits the rail and the play dock just above it", () => {
    expect(px(".pf-godock {", "bottom")).toBe(LAYOUT.shortBelt + LAYOUT.edge * 2);
  });
});
