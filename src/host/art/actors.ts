import { WORLD } from "@/design/tokens";
import type { PixelAnim, PixelSprite } from "./pixels";

/**
 * CHARACTERS AND ITEMS, AS PIXEL ART.
 *
 * Read the note at the top of ./pixels.ts for why these are grids rather than
 * drawing commands. In short: the previous versions were ellipses and bezier
 * curves, which Canvas2D antialiases no matter what coordinates you hand them,
 * so the "pixel art" had soft grey edges at every scale.
 *
 * The outline is BAKED INTO THE GRID rather than applied by a stroke() wrapper.
 * That is what retires the old `outlined()` helper: a stroked outline is a path,
 * a path is antialiased, and one soft dark halo around every character is
 * exactly what made the old art look printed rather than drawn.
 *
 * The hero is a round-headed builder in a cap and dungarees.
 *
 * Every grid is checked by actors.test.ts. A mistyped row does not throw and
 * does not fail to compile - the sprite just shifts by a pixel - so the test is
 * the only thing that catches it.
 */

const HERO_PAL = {
  o: WORLD.outline,
  c: WORLD.hero,
  l: WORLD.heroLit,
  d: WORLD.heroDark,
  s: WORLD.heroSkin,
  b: "#3b2f52",
  u: "#d8dee9",
} as const;

// Head, face and torso, shared by every pose. Only the legs change, so a tweak
// to the face lands on all five poses instead of five places to forget.
const HERO_HEAD = [
  "...oooooo...",
  "..occccccoo.",
  ".occcccccco.",
  ".occcccccco.",
  ".ocssssssco.",
  ".osssssssso.",
  ".ossossosso.",
  ".osssssssso.",
  ".oossssssoo.",
  "..osssssso..",
];

const HERO_BODY = [
  "..occcccco..",
  ".occcccccco.",
  ".ocdddddddo.",
  ".ocdddddddo.",
  ".ocdddddddo.",
  ".oodddddddo.",
  "..oddddddo..",
];

/** Six more rows of torso. Being big is being TALLER, not merely scaled up. */
const HERO_BODY_BIG = [
  "..occcccco..",
  ".occcccccco.",
  ".occcccccco.",
  ".ocdddddddo.",
  ".ocdddddddo.",
  ".ocdddddddo.",
  ".ocdddddddo.",
  ".ocdddddddo.",
  ".ocdddddddo.",
  ".oodddddddo.",
  "..oddddddo..",
  "..oddddddo..",
  "..oddddddo..",
];

const LEGS_IDLE = [
  "..odd..ddo..",
  "..odd..ddo..",
  "..odd..ddo..",
  "..odd..ddo..",
  "..obb..bbo..",
  ".obbbo.obbo.",
  ".oooo..oooo.",
];

/** Mid-stride. The legs genuinely separate, rather than the body bobbing 1px. */
const LEGS_WALK_A = [
  "..odd..ddo..",
  ".odd....ddo.",
  ".odd....ddo.",
  "obb......bbo",
  "obb......bbo",
  "obbo....obbo",
  "ooo......ooo",
];

/** The other half of the stride, legs crossing under the body. */
const LEGS_WALK_B = [
  "...oddddo...",
  "...oddddo...",
  "..odd..ddo..",
  "..odd..ddo..",
  "..obb..bbo..",
  ".obbo..obbo.",
  ".ooo....ooo.",
];

/** Airborne: legs tucked, one arm up. Unmistakable from a walk at a glance. */
const LEGS_JUMP = [
  "..odddddo...",
  ".odd...ddo..",
  ".odd...ddo..",
  "obb......o..",
  "obbo........",
  ".oo.........",
  "............",
];

/**
 * Skidding: braced against the direction of travel, with a puff of dust.
 *
 * The biggest feel upgrade in the whole sprite set for one grid of cost. A turn
 * that shows nothing reads as the controls being unresponsive.
 */
const LEGS_SKID = [
  "..oddddo....",
  "..odd.ddo...",
  "..odd.ddo...",
  "..obb..bbo..",
  ".obbo..obbo.",
  "uoo......oou",
  "u..........u",
];

function hero(id: string, body: readonly string[], legs: readonly string[]): PixelSprite {
  const rows = [...HERO_HEAD, ...body, ...legs];
  return { id, w: 12, h: rows.length, rows, palette: HERO_PAL };
}

export const HERO_SMALL = {
  idle: hero("heroIdle", HERO_BODY, LEGS_IDLE),
  walkA: hero("heroWalkA", HERO_BODY, LEGS_WALK_A),
  walkB: hero("heroWalkB", HERO_BODY, LEGS_WALK_B),
  jump: hero("heroJump", HERO_BODY, LEGS_JUMP),
  skid: hero("heroSkid", HERO_BODY, LEGS_SKID),
};

export const HERO_BIG = {
  idle: hero("heroBigIdle", HERO_BODY_BIG, LEGS_IDLE),
  walkA: hero("heroBigWalkA", HERO_BODY_BIG, LEGS_WALK_A),
  walkB: hero("heroBigWalkB", HERO_BODY_BIG, LEGS_WALK_B),
  jump: hero("heroBigJump", HERO_BODY_BIG, LEGS_JUMP),
  skid: hero("heroBigSkid", HERO_BODY_BIG, LEGS_SKID),
};

const WALKER_PAL = {
  o: WORLD.outline,
  c: WORLD.walker,
  l: WORLD.walkerLit,
  d: WORLD.walkerDark,
  w: "#ffffff",
} as const;

/**
 * The walker, 14x14, two frames.
 *
 * `facing` is now genuinely used, via a mirrored raster. The old version did
 * `void facing;` and drew the same picture both ways, so a walker gave no clue
 * which way it was about to go. That is gameplay information, not decoration -
 * a young player cannot plan a jump without it.
 */
export const WALKER: PixelAnim = {
  id: "walker",
  w: 14,
  h: 14,
  palette: WALKER_PAL,
  frames: [
    [
      "....oooooo....",
      "..oollllllooo.",
      ".ollllllllllo.",
      ".olllcccccllo.",
      "occccccccccco.",
      "occcowccowcco.",
      "occcowccowcco.",
      "occccccccccco.",
      "occccccccccco.",
      ".occcccccccco.",
      ".oddddddddddo.",
      "..oddddddddo..",
      "..oo......oo..",
      "..oo......oo..",
    ],
    [
      "....oooooo....",
      "..oollllllooo.",
      ".ollllllllllo.",
      ".olllcccccllo.",
      "occccccccccco.",
      "occcowccowcco.",
      "occcowccowcco.",
      "occccccccccco.",
      "occccccccccco.",
      ".occcccccccco.",
      ".oddddddddddo.",
      "..oddddddddo..",
      ".oo........oo.",
      ".oo........oo.",
    ],
  ],
};

const SHELL_PAL = {
  o: WORLD.outline,
  c: WORLD.shell,
  l: WORLD.shellLit,
  d: WORLD.shellDark,
  s: WORLD.heroSkin,
  w: "#ffffff",
} as const;

/** Shell walker, 14x16. The head pokes out on the side it is facing. */
export const SHELL_WALKER: PixelAnim = {
  id: "shellWalker",
  w: 14,
  h: 16,
  palette: SHELL_PAL,
  frames: [
    [
      "........oooo..",
      "......ossssso.",
      "......osswsso.",
      "....oosssssso.",
      "..oooosssssoo.",
      ".ollllooooooo.",
      "occcclllllco..",
      "occcccclllco..",
      "occdccccccco..",
      "occddcccccco..",
      "occdddcccdco..",
      ".oddddddddo...",
      "..oooooooo....",
      "..oo....oo....",
      "..oo....oo....",
      "..oo....oo....",
    ],
    [
      "........oooo..",
      "......ossssso.",
      "......osswsso.",
      "....oosssssso.",
      "..oooosssssoo.",
      ".ollllooooooo.",
      "occcclllllco..",
      "occcccclllco..",
      "occdccccccco..",
      "occddcccccco..",
      "occdddcccdco..",
      ".oddddddddo...",
      "..oooooooo....",
      ".oo......oo...",
      ".oo......oo...",
      ".oo......oo...",
    ],
  ],
};

/** A loose shell, 14x12. Wobbles, so a live one is not mistaken for scenery. */
export const SHELL: PixelAnim = {
  id: "shell",
  w: 14,
  h: 12,
  palette: SHELL_PAL,
  frames: [
    [
      "...oooooooo...",
      "..ollllllllo..",
      ".olllwlllllo..",
      "occcclllllcco.",
      "occcccclllcco.",
      "occdcccccccco.",
      "occddccccccco.",
      "occdddcccdcco.",
      ".oddddddddddo.",
      ".oddddddddddo.",
      "..oooooooooo..",
      "..............",
    ],
    [
      "..............",
      "...oooooooo...",
      "..ollllllllo..",
      ".olllwlllllo..",
      "occcclllllcco.",
      "occcccclllcco.",
      "occdcccccccco.",
      "occddccccccco.",
      "occdddcccdcco.",
      ".oddddddddddo.",
      ".oddddddddddo.",
      "..oooooooooo..",
    ],
  ],
};

const COIN_PAL = {
  o: WORLD.outline,
  g: WORLD.coin,
  d: WORLD.coinDark,
  l: WORLD.coinLit,
} as const;

/**
 * The coin, 10x10, four frames.
 *
 * The spin is a WIDTH change - wide, three-quarter, edge-on, three-quarter -
 * not a rotation. That is how a 2D console game spins a coin, and it is the
 * only version that survives being ten pixels tall. The old one was an ellipse
 * squashed by a cosine: a vector idiom, blurred at every step of the cycle.
 */
export const COIN: PixelAnim = {
  id: "coin",
  w: 10,
  h: 10,
  palette: COIN_PAL,
  frames: [
    [
      "...oooo...",
      ".oogggggoo",
      ".oglggdggo",
      ".oglgddggo",
      ".oggdddggo",
      ".oggdddggo",
      ".oggdddggo",
      ".oglgddggo",
      ".oogggggoo",
      "...oooo...",
    ],
    [
      "....oo....",
      "...oggo...",
      "..oglgdo..",
      "..oglddo..",
      "..oggddo..",
      "..oggddo..",
      "..oggddo..",
      "..oglddo..",
      "...oggo...",
      "....oo....",
    ],
    [
      "....oo....",
      "....og....",
      "...ogdo...",
      "...ogdo...",
      "...ogdo...",
      "...ogdo...",
      "...ogdo...",
      "...ogdo...",
      "....og....",
      "....oo....",
    ],
    [
      "....oo....",
      "...oggo...",
      "..odglgo..",
      "..oddlgo..",
      "..oddggo..",
      "..oddggo..",
      "..oddggo..",
      "..oddlgo..",
      "...oggo...",
      "....oo....",
    ],
  ],
};

/**
 * A brilliant-cut gem, 14x14: a flat crown, a girdle line, a pavilion tapering to
 * a point. Lit from the top left, so the left facets are light and the right
 * ones dark, with a few spark pixels on the crown.
 */
function gemSprite(id: string, base: string, lit: string, dark: string): PixelSprite {
  return {
    id,
    w: 14,
    h: 14,
    palette: { o: WORLD.outline, c: base, l: lit, d: dark, w: WORLD.gemSpark },
    rows: [
      "...oooooooo...",
      "..olllwcccdo..",
      ".olllwcccccdo.",
      "olllwwcccccddo",
      "oooooooooooooo",
      ".olllcccccddo.",
      ".olllccccdddo.",
      "..olcccccddo..",
      "..olccccdddo..",
      "...olcccddo...",
      "...occcdddo...",
      "....occddo....",
      ".....oddo.....",
      "......oo......",
    ],
  };
}

/** A pixel heart, 14x14. Two lobes and a point, with a spark on the left lobe. */
function heartSprite(id: string, base: string, lit: string, dark: string): PixelSprite {
  return {
    id,
    w: 14,
    h: 14,
    palette: { o: WORLD.outline, c: base, l: lit, d: dark, w: "#ffffff" },
    rows: [
      "..oooo..oooo..",
      ".owllcooccddo.",
      "olllcccccccddo",
      "olllccccccdddo",
      "olcccccccccddo",
      "occcccccccccdo",
      ".occccccccddo.",
      ".occcccccdddo.",
      "..occccccddo..",
      "..occccddddo..",
      "...occddddo...",
      "....ocdddo....",
      ".....oddo.....",
      "......oo......",
    ],
  };
}

/** Power gem. Makes you big. */
export const GEM = gemSprite("gem", WORLD.gem, WORLD.gemLit, WORLD.gemDark);

/** Extra life. A heart, so it can never be mistaken for the gem. */
export const HEART = heartSprite("heart", WORLD.heart, WORLD.heartLit, WORLD.heartDark);
