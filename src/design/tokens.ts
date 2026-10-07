/**
 * THE DESIGN SYSTEM.
 *
 * One source of truth for colour, size, type and shape - used by the React
 * chrome AND by the canvas renderers, so the palette swatch in the toolbar is
 * literally the same value as the block drawn in the level.
 *
 * ===========================================================================
 * THE ART DIRECTION: CHUNKY PIXEL
 * ===========================================================================
 * Committed to, deliberately, over clean-vector. The engine renders at a fixed
 * 384x216 upscaled by a whole number and every sprite is drawn in code, so
 * pixel art is the direction the renderer already wants. Being halfway between
 * two styles is what made the previous design read as a web app.
 *
 * What that means mechanically, everywhere in this file:
 *
 *   - SQUARE CORNERS. There is no radius token. If you reach for one, the
 *     answer is no.
 *   - AN OUTLINE ON EVERYTHING. Every panel and every button wears the same
 *     dark outline a sprite does, so the interface and the world are made of
 *     the same stuff.
 *   - BEVEL, NOT SHADOW. Light on the top-left, dark on the bottom-right, hard
 *     edges, no blur. Inverting that pair is what "pressed in" looks like.
 *   - HARD DROP SHADOWS. A zero-blur offset block. A blurred shadow is a web
 *     shadow.
 *   - BEVEL COLOURS ARE OPAQUE. Never rgba(255,255,255,.3) over the face: an
 *     alpha highlight goes milky-grey over a saturated colour, which is the
 *     single biggest reason cheap bevels read as plastic. Each tone carries its
 *     own light and dark.
 *
 * ===========================================================================
 * WHO THIS IS FOR, AND WHAT THAT CHANGES
 * ===========================================================================
 * The user is around eight. That is not a vague instruction to "make it fun";
 * it has specific, testable consequences, and every rule below exists because
 * of one of them:
 *
 * 1. READING IS WORK. A young player can read, but decoding a word costs
 *    real attention that is then not available for the task. So every control
 *    leads with a SHAPE (icon) and supports it with one short word. Never a
 *    word alone, and never jargon: "Rub out", not "Eraser tool"; "Finish",
 *    not "Goal marker".
 *
 * 2. MOTOR PRECISION IS LOWER. Small targets get mis-clicked, and a mis-click
 *    in an editor destroys work. Targets are 60px for primary tools and never
 *    below 44px - the documented floor for touch, which this must also support.
 *
 * 3. CONTRAST AND SATURATION CARRY MEANING. Tasteful greys at ~3:1 read as
 *    "off" or "broken" to a young player. Saturated, high-contrast colour reads as
 *    alive. Every text pairing here clears 4.5:1.
 *
 * 4. STATE MUST BE OBVIOUS WITHOUT A LEGEND. The selected tool is not a
 *    slightly-lighter grey - it changes colour, its bevel inverts, it sinks,
 *    and it gains a gold lit edge. Four signals, because one is easy to miss
 *    mid-task and "which tool am I holding?" is the question asked most often.
 *
 * 5. NOTHING SHOULD FEEL PUNISHING. Chunky shapes, generous targets, and
 *    destructive actions as the only red in the interface - so red always
 *    means the same thing.
 */

import type { CSSProperties } from "react";

// ---------------------------------------------------------------------------
// Colour
// ---------------------------------------------------------------------------

/**
 * Interface palette.
 *
 * Deep blue rather than black or grey: it reads as "sky at night" instead of
 * "developer tool", and it makes the saturated accents sing without vibrating.
 *
 * The *Light / *Dark pairs are bevel colours. They are opaque on purpose - see
 * the note at the top of this file.
 */
export const UI = {
  /** Chrome page background. Rarely visible now that the world is full-bleed. */
  bg: "#151c33",
  /** The void around the play canvas. Reads as a console bezel. */
  bgDeep: "#0a0e1c",

  /** Dock and panel bodies. */
  surface: "#242d52",
  /** Raised control faces. */
  surfaceHi: "#2f3c68",
  /** Recessed wells: text fields, the inside of the level shelf. */
  surfaceLo: "#161d38",
  /** Dividers inside a panel. */
  line: "#3a4667",

  /**
   * THE outline. Every panel and every button wears it at SIZE.outline, exactly
   * as every character and tile does. Near-black with a blue cast so it belongs
   * to the same world rather than sitting on top of it.
   */
  ink: "#070b16",

  text: "#ffffff",
  textSoft: "#c2cbe8",
  textDim: "#95a2cc",

  /** Bevel pair for the neutral surface. */
  surfaceLight: "#4d5c9c",
  surfaceDark: "#131936",

  /** Play. The single most important button in the app, so it owns green. */
  go: "#44e08a",
  goLight: "#95f7c1",
  goDark: "#12904f",

  /** Selection / active tool. */
  pick: "#4aa8ff",
  pickLight: "#b3dcff",
  pickDark: "#1a5cab",

  /** Warnings and "you need to do something". */
  warn: "#ffc043",
  warnLight: "#ffe0a0",
  warnDark: "#b87a10",

  /** Destructive. The ONLY red in the interface, so red always means danger. */
  danger: "#ff5a5a",
  dangerLight: "#ffb3ab",
  dangerDark: "#a82a2a",

  /** Rewards, coins, celebration - and the lit edge on a selected control. */
  gold: "#ffd166",
  goldLight: "#fff0b8",
  goldDark: "#c08c10",

  /** Text sitting on a bright button face. */
  onBright: "#06121f",
} as const;

/**
 * World palette.
 *
 * Chosen so each part is distinguishable at a glance AND at minimap scale,
 * where a tile is one or two pixels. That second constraint is why the hues are
 * spread out rather than being a tasteful analogous set: at 2px, "olive" and
 * "moss" are the same colour.
 *
 * Every material is a triple - base, lit, dark. One colour cannot express the
 * lit top edge the whole art direction is built on, and the palette chip in the
 * toolbar needs the same bevel the tile has or the chip is a lie again.
 */
export const WORLD = {
  /** Kept for compatibility. The real sky is SKY_BANDS, below. */
  skyTop: "#2b5fa8",
  skyBottom: "#93cbf6",

  grassTop: "#5fd35f",
  grassTopLit: "#8ef08e",
  earth: "#a86b3c",
  earthDark: "#7d4c28",

  stone: "#8792b5",
  stoneLit: "#b6bfd8",
  stoneDark: "#5d6784",

  brick: "#e07a4a",
  brickLit: "#f2a880",
  brickDark: "#a8522c",

  ice: "#9fe4ff",
  iceLit: "#e2f7ff",
  iceDark: "#5fb8e0",

  wood: "#d19a5c",
  woodLit: "#edc18c",
  woodDark: "#9c6c38",

  spike: "#c3ccdd",
  spikeLit: "#eef2f9",
  spikeDark: "#7a869f",

  coin: "#ffd166",
  coinLit: "#fff4c0",
  coinDark: "#e0a020",

  /** Extra life. Also the damage burst colour: red means a life is at stake. */
  heart: "#ff5a5a",
  heartLit: "#ffb0a4",
  heartDark: "#b52f2f",

  /** Power gem. Violet: no other part is, and it is not the ice block's cyan. */
  gem: "#a77bff",
  gemLit: "#d9c8ff",
  gemDark: "#6a45c8",
  gemSpark: "#f4eeff",

  walker: "#e08a3c",
  walkerLit: "#f6bd84",
  walkerDark: "#a85c1e",

  shell: "#4fd47a",
  shellLit: "#a4f2bd",
  shellDark: "#2a9450",

  hero: "#ff6b52",
  heroLit: "#ffb3a2",
  heroDark: "#c94530",
  heroSkin: "#ffd9b8",

  /**
   * Parallax scenery. Deliberately desaturated and separate from the tile
   * colours: if the background hills are the same green as the ground, the
   * player cannot tell at a glance what they can stand on.
   */
  hillFar: "#3f6f8f",
  hillFarLit: "#527f9c",
  hillNear: "#2f7a4a",
  hillNearLit: "#3f9159",
  cloud: "#eaf4ff",
  cloudShade: "#b9d5ef",

  /** Outline used on every character and item, for readability against any tile. */
  outline: "#171c2e",
} as const;

/**
 * The sky, as hard bands.
 *
 * A gradient is a vector idiom: it makes a smooth ramp that no amount of
 * nearest-neighbour scaling turns into pixel art, and the old renderer
 * allocated a fresh CanvasGradient every frame to get one. Five hard bands is
 * what a console game does and it is also cheaper.
 *
 * `y` is the TOP of the band in logical pixels; the last band runs to the
 * bottom of the 216px view.
 */
export const SKY_BANDS = [
  { y: 0, color: "#2b5fa8" },
  { y: 48, color: "#3a78c4" },
  { y: 88, color: "#4f95dc" },
  { y: 128, color: "#6fb2ec" },
  { y: 160, color: "#93cbf6" },
] as const;

/** Editor-only chrome painted onto the canvas. */
export const EDITOR = {
  /** Behind the level extent, if the sky is not drawn for some reason. */
  background: "#1a2340",
  /** Off the edge of the world. */
  outside: "#080b18",
  grid: "rgba(255,255,255,0.10)",
  gridMajor: "rgba(255,255,255,0.20)",
  cursor: "#ffffff",
  cursorFill: "rgba(255,255,255,0.20)",
  invalid: "rgba(255,90,90,0.40)",
  start: "#4fd47a",
  goal: "#ffd166",
  selection: "rgba(74,168,255,0.28)",
  selectionEdge: "#4aa8ff",
  /** The bevelled frame around the level, same vocabulary as a button. */
  frameLight: "#6b7ba8",
  frameDark: "#070b16",
  /**
   * Behind the minimap.
   *
   * Dark, not sky-blue. Sky was the obvious idea - the level silhouette reads
   * as terrain against it - but on screen a bright panel floating over a bright
   * level stops looking like a plaque and starts looking like a hole. Dark
   * makes it an object sitting on top of the world, which is what it is.
   */
  minimapBack: "#141d33",
  minimapEdge: "#070b16",
  minimapView: "#ffc043",
} as const;

// ---------------------------------------------------------------------------
// What a part looks like
// ---------------------------------------------------------------------------

/**
 * WHAT A PART LOOKS LIKE.
 *
 * `PartDef.color` in src/format/parts.ts is the ORIGINAL GREYBOX colour - an
 * olive-and-brown set that no longer matches anything the sprites actually
 * paint. src/format is append-only and off limits, so it stays exactly as it
 * is. This map is the appearance layer that supersedes it, keyed by the same
 * numeric part id.
 *
 * Everything that needs a part's colour reads THIS, not `def.color`:
 *   - host/tileDraw.ts       small-zoom swatch, unknown-part fallback
 *   - host/editorRenderer.ts minimap, cursor ghost, object fallback
 *   - host/renderer.ts       dying-entity squash, unknown-entity fallback
 *   - components/ui/Controls.tsx  the palette chip
 *
 * One source, so the swatch a young player clicks is the colour that lands in the
 * level. A palette that merely approximates the world is a small lie they have to
 * learn to correct for.
 */
export interface PartArt {
  /** Body fill. This is what a minimap pixel and a 4px tile become. */
  readonly base: string;
  /** Lit top edge. Also the chip's highlight band. */
  readonly lit: string;
  /** Shadow side and internal detail. Also the chip's lowlight band. */
  readonly dark: string;
  /** Silhouette family, so the toolbar chip echoes the world shape. */
  readonly shape: "block" | "plank" | "spiky" | "round" | "creature" | "slopeR" | "slopeL";
}

export const PART_ART: Readonly<Record<number, PartArt>> = {
  1: { base: WORLD.earth, lit: WORLD.grassTop, dark: WORLD.earthDark, shape: "block" },
  2: { base: WORLD.stone, lit: WORLD.stoneLit, dark: WORLD.stoneDark, shape: "block" },
  3: { base: WORLD.brick, lit: WORLD.brickLit, dark: WORLD.brickDark, shape: "block" },
  4: { base: WORLD.ice, lit: WORLD.iceLit, dark: WORLD.iceDark, shape: "block" },
  5: { base: WORLD.wood, lit: WORLD.woodLit, dark: WORLD.woodDark, shape: "plank" },
  6: { base: WORLD.earth, lit: WORLD.grassTop, dark: WORLD.earthDark, shape: "slopeR" },
  7: { base: WORLD.earth, lit: WORLD.grassTop, dark: WORLD.earthDark, shape: "slopeL" },
  8: { base: WORLD.spike, lit: WORLD.spikeLit, dark: WORLD.spikeDark, shape: "spiky" },
  9: { base: WORLD.shell, lit: WORLD.shellLit, dark: WORLD.shellDark, shape: "block" },
  100: { base: WORLD.coin, lit: WORLD.coinLit, dark: WORLD.coinDark, shape: "round" },
  101: { base: WORLD.gem, lit: WORLD.gemLit, dark: WORLD.gemDark, shape: "round" },
  102: { base: WORLD.heart, lit: WORLD.heartLit, dark: WORLD.heartDark, shape: "round" },
  110: { base: WORLD.walker, lit: WORLD.walkerLit, dark: WORLD.walkerDark, shape: "creature" },
  111: { base: WORLD.shell, lit: WORLD.shellLit, dark: WORLD.shellDark, shape: "creature" },
  // Pipe mouths. The colour IS the pairing rule, so these are the one place
  // where a part's colour carries game meaning rather than just identity.
  120: { base: "#4aa8ff", lit: "#b3dcff", dark: "#1a5cab", shape: "round" },
  121: { base: "#ff9e3d", lit: "#ffd0a0", dark: "#b0611a", shape: "round" },
  122: { base: "#ff7ad9", lit: "#ffc2ee", dark: "#b03a92", shape: "round" },
  123: { base: "#e8eef8", lit: "#ffffff", dark: "#8d98ad", shape: "round" },
  /**
   * 900 is SHELL_PART - a runtime-only entity with no PartDef at all, but with
   * a greybox EntityDef.color that the renderer paints when it dies. Listing it
   * here closes that hole.
   */
  900: { base: WORLD.shell, lit: WORLD.shellLit, dark: WORLD.shellDark, shape: "round" },
};

/** An unknown part is still visible. Magenta, so it is obviously a gap. */
const UNKNOWN_ART: PartArt = {
  base: "#c026d3",
  lit: "#f0abfc",
  dark: "#701a75",
  shape: "block",
};

export function partArt(id: number): PartArt {
  return PART_ART[id] ?? UNKNOWN_ART;
}

// ---------------------------------------------------------------------------
// Size
// ---------------------------------------------------------------------------

/**
 * Touch/click targets and the pixel-chrome measurements.
 *
 * 44px is the accepted minimum for an adult finger; young players are less precise,
 * so primary tools get 60 and nothing goes below 44.
 *
 * THERE IS NO RADIUS TOKEN, deliberately. It was removed rather than set to 0
 * so that any surviving rounded corner is a compile error rather than a thing
 * someone has to notice.
 *
 * `shadow` and `press` are chosen together: pressed shadow is shadow - press =
 * 1, so a button's total footprint (height + shadow) is identical at rest and
 * pressed. Only the cap moves. Nothing reflows, and the press reads as depth
 * rather than as a jump.
 *
 * `iconLarge` and `iconSmall` MUST stay multiples of 16 - see Icon.tsx. At a
 * non-multiple, each glyph pixel is a fractional number of screen pixels and
 * adjacent pixels come out different widths.
 */
export const SIZE = {
  toolButton: 60,
  actionButton: 48,
  partTile: 56,
  iconLarge: 32,
  iconSmall: 16,
  gap: 8,

  /** The sprite outline worn by every panel and button. */
  outline: 3,
  /** Width of the inset bevel band. */
  bevel: 3,
  /** Hard drop-shadow offset at rest. */
  shadow: 4,
  /** How far a button travels when pressed. */
  press: 3,
} as const;

/**
 * How much screen the floating docks eat.
 *
 * The canvas renderers read this so the minimap never draws underneath a dock,
 * and the editor's fit-to-view can nudge the level clear of the chrome.
 */
export const LAYOUT = {
  /** Gap between a dock and the edge of the viewport. */
  edge: 12,
  topDock: 76,
  /** Width reserved for the wordmark plaque, so the view dock never sits on it. */
  titlePlaque: 220,
  leftRail: 84,
  /** Two rows of 56px part slots, their captions, and the panel's own padding. */
  bottomBelt: 168,
  /** The belt as one row, on a short landscape screen (globals.css, max-height 500px). */
  shortBelt: 84,
  /**
   * 216 * 2. Below this viewport height the play view drops to 1x, because the
   * scale must be a whole number. Nothing enforces it; it lives here so the
   * number has one home to be quoted from.
   */
  playScale2Height: 432,
} as const;

/**
 * THE ON-SCREEN CONTROLS.
 *
 * Separate from LAYOUT because these are THUMB measurements, not chrome
 * measurements. A 60px tool button is generous under a fingertip and small
 * under a thumb pressed flat against glass by someone who is looking at the
 * other side of the screen.
 *
 * THE HISTORY, so the numbers are not casually shrunk again. The play dock used
 * to sit bottom-right, which is exactly where a right thumb rests, and it
 * covered 66 of the jump button's 76 pixels. Every jump attempt pressed "Build"
 * and threw the player back into the editor. The reported symptom was "I cannot
 * jump on a tablet". Sizes here are the easy half of that fix; the other half
 * is that nothing else may occupy the bottom corners while these are visible.
 */
export const TOUCH = {
  /**
   * Gap from the edge of the viewport. Larger than LAYOUT.edge on purpose: a
   * thumb that lands half off the glass is a missed jump, and the very edge of
   * a screen is not a reliable target on any device.
   */
  edge: 16,
  /** The d-pad. Leaves a 44px-plus target in every direction after the dead zone. */
  pad: 156,
  /** Dead-zone radius from the pad centre, so a resting thumb does not drift. */
  padDead: 14,
  /** A face button. Sized for a thumb, not a fingertip. */
  button: 76,
  /** Between RUN and JUMP: wide enough that one thumb cannot bridge both. */
  buttonGap: 12,
  /**
   * Both, shrunk for a short viewport.
   *
   * A landscape phone is about 390px tall, where a 156px pad would eat 40% of
   * the screen. Applied by measuring the viewport in JS rather than by a CSS
   * media query, because these are load-bearing dimensions and this file exists
   * because load-bearing dimensions do not go through a build step.
   */
  padCompact: 124,
  buttonCompact: 64,
  /** Viewport height below which the compact sizes apply. */
  compactHeight: 480,
} as const;

// ---------------------------------------------------------------------------
// Type
// ---------------------------------------------------------------------------

/**
 * Type scale.
 *
 * Two faces, one system. Pixelify Sans has pixel letterforms with humanist
 * shapes, so it survives being read at 13px by someone who is still learning to
 * read. Press Start 2P is iconic but very wide with a single weight, so it is
 * reserved for the wordmark and big HUD numerals, where being read at a glance
 * matters more than being read as prose.
 *
 * Sizes are NUMBERS, not "13px" strings, because they go into inline style
 * objects. The display sizes are multiples of 8 - Press Start 2P is drawn on an
 * 8px grid and renders cleanest there.
 */
export const TYPE = {
  ui: "var(--font-ui), ui-sans-serif, system-ui, sans-serif",
  display: "var(--font-display), var(--font-ui), ui-monospace, monospace",

  tiny: 11,
  tinyWeight: 700,
  label: 13,
  labelWeight: 700,
  body: 15,
  bodyWeight: 600,
  title: 20,
  titleWeight: 700,

  /** Display face, over the world. */
  hud: 16,
  wordmark: 24,
  displayTracking: "0.04em",
} as const;

// ---------------------------------------------------------------------------
// Tone
// ---------------------------------------------------------------------------

/**
 * A control's colour role.
 *
 * There is no "pick" tone: it used to exist and was byte-identical to
 * "neutral", because selection is expressed by the ON half of every tone rather
 * than by a separate tone.
 */
export type Tone = "neutral" | "go" | "warn" | "danger";

export interface ToneSpec {
  /** Rest. */
  face: string;
  fg: string;
  hi: string;
  lo: string;
  /** Selected / latched. */
  onFace: string;
  onFg: string;
  onHi: string;
  onLo: string;
}

/**
 * Hand-picked, no colour maths - a table you can eyeball in one screen.
 *
 * Note every `onHi` is gold. That is the lit edge on a selected control, and it
 * is the signal that has to survive being seen from across the room.
 */
export const TONE: Record<Tone, ToneSpec> = {
  neutral: {
    face: UI.surfaceHi,
    fg: UI.text,
    hi: UI.surfaceLight,
    lo: UI.surfaceDark,
    onFace: UI.pick,
    onFg: UI.onBright,
    onHi: UI.gold,
    onLo: UI.pickDark,
  },
  go: {
    face: UI.go,
    fg: "#04321c",
    hi: UI.goLight,
    lo: UI.goDark,
    onFace: UI.go,
    onFg: "#04321c",
    onHi: UI.gold,
    onLo: UI.goDark,
  },
  warn: {
    face: UI.warn,
    fg: "#3a2400",
    hi: UI.warnLight,
    lo: UI.warnDark,
    onFace: UI.warn,
    onFg: "#3a2400",
    onHi: UI.goldLight,
    onLo: UI.warnDark,
  },
  danger: {
    face: UI.surfaceHi,
    fg: UI.dangerLight,
    hi: UI.surfaceLight,
    lo: UI.surfaceDark,
    onFace: UI.danger,
    onFg: "#3a0808",
    onHi: UI.dangerLight,
    onLo: UI.dangerDark,
  },
};

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------

/**
 * A style object that may also carry CSS custom properties.
 *
 * React's CSSProperties has no index signature, and the pixel button hands its
 * numbers to hand-written CSS through custom properties - that is how an
 * inline-styled control gets real :hover and :active states without a single
 * Tailwind arbitrary class. (The Tailwind JIT has twice silently dropped
 * newly-added arbitrary-value classes in this project; load-bearing dimensions
 * do not go through it.)
 */
export interface PixelStyle extends CSSProperties {
  [key: `--${string}`]: string | number | undefined;
}

/**
 * THE recipe. Every panel and every button is this.
 *
 * Deliberately does NOT set boxShadow or transform. It emits two shadow recipes
 * as custom properties and lets the `.pf-press` rule in globals.css choose
 * between them on :hover / :active / [data-sunk]. The down variant swaps the
 * highlight and lowlight so the bevel INVERTS, which is the strongest available
 * "this is pushed in" signal and costs nothing.
 */
export function bevel(spec: {
  face: string;
  fg: string;
  hi: string;
  lo: string;
  ink?: string;
  /** Bevel band width. Defaults to SIZE.bevel. */
  width?: number;
  /** Hard drop-shadow offset. 0 for something that sits flush. */
  shadow?: number;
}): PixelStyle {
  const w = spec.width ?? SIZE.bevel;
  const ink = spec.ink ?? UI.ink;
  const drop = spec.shadow ?? SIZE.shadow;
  const down = Math.max(0, drop - SIZE.press);

  const insetUp = `inset ${w}px ${w}px 0 0 ${spec.hi}, inset -${w}px -${w}px 0 0 ${spec.lo}`;
  const insetDown = `inset ${w}px ${w}px 0 0 ${spec.lo}, inset -${w}px -${w}px 0 0 ${spec.hi}`;

  return {
    background: spec.face,
    color: spec.fg,
    border: `${SIZE.outline}px solid ${ink}`,
    borderRadius: 0,
    boxSizing: "border-box",
    "--pf-shadow": drop > 0 ? `${insetUp}, ${drop}px ${drop}px 0 0 ${ink}` : insetUp,
    "--pf-shadow-down": down > 0 ? `${insetDown}, ${down}px ${down}px 0 0 ${ink}` : insetDown,
    "--pf-press": `${SIZE.press}px`,
  };
}

/** The bevel for a control in a given tone, rest or latched. */
export function toneStyle(tone: Tone, on = false, shadow?: number): PixelStyle {
  const t = TONE[tone];
  return bevel({
    face: on ? t.onFace : t.face,
    fg: on ? t.onFg : t.fg,
    hi: on ? t.onHi : t.hi,
    lo: on ? t.onLo : t.lo,
    shadow,
  });
}

/**
 * An inset bevel - light on the bottom-right, dark on the top-left. A WELL, the
 * opposite of a button. Text fields and the inside of the level shelf.
 */
export function well(face: string = UI.surfaceLo): PixelStyle {
  const w = SIZE.bevel;
  return {
    background: face,
    border: `${SIZE.outline}px solid ${UI.ink}`,
    borderRadius: 0,
    boxSizing: "border-box",
    boxShadow: `inset ${w}px ${w}px 0 0 ${UI.surfaceDark}, inset -${w}px -${w}px 0 0 ${UI.surfaceLight}`,
  };
}

/** Hard, zero-blur drop shadow for things that are not buttons. */
export function hardShadow(offset: number = SIZE.shadow, color: string = UI.ink): string {
  return `${offset}px ${offset}px 0 0 ${color}`;
}

/**
 * An 8-way hard text outline - the text equivalent of the sprite outline.
 *
 * For DOM text that sits directly on the world with no panel behind it. A
 * blurred shadow would fail exactly where this is needed, which is over a busy
 * tile.
 */
export function textOutline(w = 2, color: string = UI.ink): string {
  return [
    `${w}px ${w}px 0 ${color}`,
    `-${w}px ${w}px 0 ${color}`,
    `${w}px -${w}px 0 ${color}`,
    `-${w}px -${w}px 0 ${color}`,
    `0 ${w}px 0 ${color}`,
    `0 -${w}px 0 ${color}`,
    `${w}px 0 0 ${color}`,
    `-${w}px 0 0 ${color}`,
    `0 ${w * 2}px 0 rgba(0,0,0,0.45)`,
  ].join(", ");
}
