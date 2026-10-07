import {
  FORMAT_VERSION,
  MARKER_GOAL,
  MARKER_START,
  MIN_READER_VERSION,
  makeCell,
  type LevelDoc,
  type TileCell,
} from "@/format/level";

/**
 * A hand-built physics test room, expressed as an ordinary level document.
 *
 * Every feature the collision resolver supports appears once, left to right, so
 * a person can walk through and exercise each in turn. Unit tests prove the
 * physics is CORRECT; only hands can tell you whether it FEELS right.
 *
 * It is a LevelDoc rather than a special case on purpose: it loads through the
 * same compiler, plays through the same simulation, and opens in the same
 * editor as anything a player makes. A built-in level that took a private path
 * would stop being a test of the real thing.
 */

const GROUND = 1;
const BRICK = 3;
const ICE = 4;
const SEMISOLID = 5;
const SLOPE_R = 6;
const SLOPE_L = 7;
const SPIKE = 8;

export const GREYBOX_W = 120;
export const GREYBOX_H = 27;

export const GREYBOX_MARKERS: readonly { tx: number; text: string }[] = [
  { tx: 2, text: "run + skid" },
  { tx: 18, text: "steps 1-3" },
  { tx: 30, text: "gaps 3/4/5" },
  { tx: 58, text: "steep slopes" },
  { tx: 73, text: "gentle climb" },
  { tx: 85, text: "low overhang" },
  { tx: 94, text: "platforms" },
  { tx: 104, text: "ice" },
];

export function buildGreyboxDoc(): LevelDoc {
  const w = GREYBOX_W;
  const h = GREYBOX_H;
  const tiles = new Array<TileCell>(w * h).fill(0);
  const floorTop = 22;

  const set = (tx: number, ty: number, part: number) => {
    if (tx < 0 || tx >= w || ty < 0 || ty >= h) return;
    tiles[ty * w + tx] = makeCell(part);
  };
  const fill = (tx0: number, ty0: number, tx1: number, ty1: number, part: number) => {
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) set(tx, ty, part);
  };
  const clear = (tx0: number, ty0: number, tx1: number, ty1: number) => {
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        if (tx >= 0 && tx < w && ty >= 0 && ty < h) tiles[ty * w + tx] = 0;
      }
    }
  };

  // Continuous floor, with gaps punched through it later.
  fill(0, floorTop, w - 1, h - 1, GROUND);
  fill(0, floorTop - 6, 0, floorTop - 1, GROUND); // left wall

  // 1. Steps of 1, 2 and 3 tiles. What can you reach without running?
  fill(18, floorTop - 1, 19, floorTop - 1, GROUND);
  fill(21, floorTop - 2, 22, floorTop - 1, GROUND);
  fill(24, floorTop - 3, 25, floorTop - 1, GROUND);

  // 2. Gaps of 3, 4 and 5 tiles. Walk-jump vs run-jump.
  clear(30, floorTop, 32, h - 1);
  clear(38, floorTop, 41, h - 1);
  clear(47, floorTop, 51, h - 1);

  // 3. Steep 1:1 slope up, a plateau, then back down.
  for (let i = 0; i < 4; i++) {
    const tx = 58 + i;
    const ty = floorTop - 1 - i;
    set(tx, ty, SLOPE_R);
    fill(tx, ty + 1, tx, h - 1, GROUND);
  }
  fill(62, floorTop - 4, 65, h - 1, GROUND);
  for (let i = 0; i < 4; i++) {
    const tx = 66 + i;
    const ty = floorTop - 4 + i;
    set(tx, ty, SLOPE_L);
    fill(tx, ty + 1, tx, h - 1, GROUND);
  }

  // 4. A shallower staircase of slopes.
  for (let i = 0; i < 3; i++) {
    const tx = 73 + i * 2;
    const ty = floorTop - 1 - i;
    set(tx, ty, SLOPE_R);
    fill(tx, ty + 1, tx, h - 1, GROUND);
    fill(tx + 1, ty, tx + 1, h - 1, GROUND);
  }
  fill(79, floorTop - 3, 82, h - 1, GROUND);

  // 5. A slope running under a low lid. MUST refuse to climb, never crush.
  set(86, floorTop - 1, SLOPE_R);
  fill(86, floorTop, 86, h - 1, GROUND);
  set(87, floorTop - 2, SLOPE_R);
  fill(87, floorTop - 1, 87, h - 1, GROUND);
  fill(85, floorTop - 3, 90, floorTop - 3, BRICK); // the lid

  // 6. Semisolid platforms: jump up through, land on, drop through.
  fill(94, floorTop - 4, 99, floorTop - 4, SEMISOLID);
  fill(96, floorTop - 8, 101, floorTop - 8, SEMISOLID);

  // 7. Spikes to walk into, then ice to slide on.
  fill(102, floorTop - 1, 103, floorTop - 1, SPIKE);
  fill(104, floorTop, 114, floorTop, ICE);

  fill(w - 1, floorTop - 8, w - 1, floorTop - 1, GROUND); // right wall

  return {
    format: FORMAT_VERSION,
    minReader: MIN_READER_VERSION,
    id: "builtin-greybox",
    title: "Physics test room",
    timeLimit: 0,
    areas: [
      {
        w,
        h,
        tiles,
        objects: [
          { id: 1, part: MARKER_START, tx: 3, ty: floorTop - 2 },
          { id: 2, part: MARKER_GOAL, tx: 117, ty: floorTop - 1 },
        ],
      },
    ],
  };
}
