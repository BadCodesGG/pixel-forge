"use client";

import dynamic from "next/dynamic";
import { TYPE, UI } from "@/design/tokens";

/**
 * The SSR boundary.
 *
 * `ssr: false` is not allowed inside a Server Component -- Next errors out and
 * tells you to move it to a Client Component, which is what this file is.
 * Keeping it as a separate one-purpose wrapper means the engine, the canvas and
 * IndexedDB never enter the server render path and never land in the initial
 * JS chunk.
 *
 * The placeholder occupies EXACTLY the box the editor will: same position, same
 * background. It used to be a differently-sized rounded box in a different
 * colour, so every load flashed and shifted before settling.
 */
const Editor = dynamic(() => import("./Editor"), {
  ssr: false,
  loading: () => (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "grid",
        placeItems: "center",
        background: UI.bgDeep,
        color: UI.textDim,
        fontFamily: TYPE.display,
        fontSize: 12,
        letterSpacing: TYPE.displayTracking,
      }}
    >
      <span className="pf-blink">LOADING</span>
    </div>
  ),
});

export default function EditorShell() {
  return <Editor />;
}
