import { describe, expect, it } from "vitest";
import { createEmptyLevel, MARKER_GOAL, MARKER_START } from "@/format/level";
import { buildGreyboxDoc } from "@/engine/greybox";
import { compileLevel, validateLevel } from "@/engine/level/compile";
import { EditorSession, MAX_STACK } from "./session";

function session() {
  return new EditorSession(createEmptyLevel("test-level"));
}

describe("drawing", () => {
  it("paints tiles and records one undo entry per gesture", () => {
    // THE point of stroke coalescing. A pencil drag fires dozens of pointer
    // events; without batching, undoing one stroke takes forty presses of
    // ctrl+Z and the editor feels broken.
    const s = session();
    s.activePart = 1;
    s.beginStroke("Draw");
    for (let tx = 5; tx < 25; tx++) s.paint(tx, 5);
    s.endStroke();

    expect(s.doc.partAt(10, 5)).toBe(1);
    expect(s.history.depth).toBe(1);

    s.undo();
    expect(s.doc.partAt(10, 5)).toBe(0);
    s.redo();
    expect(s.doc.partAt(10, 5)).toBe(1);
  });

  it("writes each cell once however much the pointer jitters over it", () => {
    const s = session();
    s.activePart = 1;
    s.beginStroke("Draw");
    for (let i = 0; i < 50; i++) s.paint(7, 7);
    s.endStroke();
    s.undo();
    // If revisits were recorded, the undo would only peel back one layer.
    expect(s.doc.partAt(7, 7)).toBe(0);
  });

  it("leaves no undo entry for a gesture that changed nothing", () => {
    const s = session();
    s.activePart = 1;
    s.beginStroke("Draw");
    s.paint(4, 4);
    s.endStroke();
    const depth = s.history.depth;

    // Painting the same part over itself is a no-op.
    s.beginStroke("Draw");
    s.paint(4, 4);
    s.endStroke();
    expect(s.history.depth).toBe(depth);
  });

  it("erases with the eraser tool", () => {
    const s = session();
    s.activePart = 1;
    s.beginStroke("Draw");
    s.paint(9, 9);
    s.endStroke();

    s.tool = "eraser";
    s.beginStroke("Erase");
    s.paint(9, 9);
    s.endStroke();
    expect(s.doc.partAt(9, 9)).toBe(0);
  });

  it("fills a rectangle regardless of which corner it was dragged from", () => {
    const s = session();
    s.activePart = 2;
    s.beginStroke("Fill");
    s.fillRect(12, 8, 9, 5); // dragged up-and-left
    s.endStroke();
    for (let ty = 5; ty <= 8; ty++) {
      for (let tx = 9; tx <= 12; tx++) expect(s.doc.partAt(tx, ty)).toBe(2);
    }
    expect(s.doc.partAt(8, 5)).toBe(0);
  });

  it("ignores edits outside the level rather than throwing", () => {
    const s = session();
    s.activePart = 1;
    s.beginStroke("Draw");
    s.paint(-5, 3);
    s.paint(9999, 3);
    s.paint(3, -1);
    s.endStroke();
    expect(s.history.depth).toBe(0);
  });
});

describe("undo history", () => {
  it("discards the redo branch once a new edit is made", () => {
    const s = session();
    s.activePart = 1;
    s.beginStroke("a");
    s.paint(3, 3);
    s.endStroke();
    s.undo();
    expect(s.history.canRedo).toBe(true);

    s.beginStroke("b");
    s.paint(4, 4);
    s.endStroke();
    // The future you could have had is not the future you are now in.
    expect(s.history.canRedo).toBe(false);
  });

  it("restores the original value when a cell is painted twice in one stroke", () => {
    const s = session();
    s.activePart = 1;
    s.beginStroke("first");
    s.paint(6, 6);
    s.endStroke();

    s.activePart = 3;
    s.beginStroke("second");
    s.paint(6, 6);
    s.endStroke();

    s.undo();
    expect(s.doc.partAt(6, 6)).toBe(1); // back to the first part, not to empty
  });
});

describe("markers", () => {
  it("moves the existing marker instead of creating a second one", () => {
    // A level has exactly one start. Enforcing it at placement means the editor
    // can never reach a state the author has to be told to fix.
    const s = session();
    s.placeMarker(MARKER_START, 10, 10);
    s.placeMarker(MARKER_START, 20, 12);
    const starts = s.doc.allObjects().filter((o) => o.part === MARKER_START);
    expect(starts).toHaveLength(1);
    expect(starts[0]).toMatchObject({ tx: 20, ty: 12 });
  });

  it("undoes a marker move back to where it was", () => {
    const s = session();
    const before = s.doc.findByPart(MARKER_GOAL);
    s.placeMarker(MARKER_GOAL, 44, 9);
    s.undo();
    expect(s.doc.findByPart(MARKER_GOAL)).toMatchObject({
      tx: before!.tx,
      ty: before!.ty,
    });
  });
});

describe("objects", () => {
  it("places an enemy without disturbing the terrain under it", () => {
    // Objects and tiles are separate planes. Dropping an enemy onto ground
    // must not erase the ground: that two-plane split is the whole reason
    // the format keeps them apart.
    const s = session();
    s.activePart = 1;
    s.beginStroke("floor");
    s.paint(20, 10);
    s.endStroke();
    s.placeObject("walker", 20, 10);
    expect(s.doc.partAt(20, 10)).toBe(1);
    expect(s.doc.objectAt(20, 10)?.part).toBe("walker");
  });

  it("undoes placing an object", () => {
    // The bug this guards: object placement bypassed the history entirely, so
    // Ctrl+Z worked on blocks and silently did nothing on enemies. An undo you
    // cannot trust is worse than no undo.
    const s = session();
    s.placeObject("coin", 15, 9);
    expect(s.doc.objectAt(15, 9)).toBeDefined();
    s.undo();
    expect(s.doc.objectAt(15, 9)).toBeUndefined();
    s.redo();
    expect(s.doc.objectAt(15, 9)?.part).toBe("coin");
  });

  it("undoes removing an object", () => {
    const s = session();
    s.placeObject("walker", 22, 9);
    s.removeObjectAt(22, 9);
    expect(s.doc.objectAt(22, 9)).toBeUndefined();
    s.undo();
    expect(s.doc.objectAt(22, 9)?.part).toBe("walker");
  });

  it("stacks a different object on top of an existing one", () => {
    const s = session();
    s.placeObject("shellWalker", 30, 9);
    s.placeObject("walker", 30, 9);
    // A walker riding a shell walker is a different obstacle from either alone,
    // so the editor keeps both rather than collapsing the cell.
    expect(s.doc.objectsAt(30, 9).map((o) => o.part)).toEqual(["shellWalker", "walker"]);
  });

  it("replaces rather than stacking the SAME thing on itself, in ONE undo step", () => {
    const s = session();
    s.placeObject("coin", 30, 9);
    s.placeObject("coin", 30, 9);
    expect(s.doc.objectsAt(30, 9)).toHaveLength(1);

    const depth = s.history.depth;
    s.undo();
    // One click must cost one press of undo, even though it was remove+add.
    expect(s.history.depth).toBe(depth - 1);
    expect(s.doc.objectAt(30, 9)?.part).toBe("coin");
  });

  it("stops stacking at MAX_STACK", () => {
    const s = session();
    s.placeObject("coin", 31, 9);
    s.placeObject("walker", 31, 9);
    s.placeObject("shellWalker", 31, 9);
    expect(s.doc.objectsAt(31, 9)).toHaveLength(MAX_STACK);

    // The fourth replaces the top of the pile rather than growing it, so a
    // stack can never get taller than the player can see coming.
    s.placeObject("growCap", 31, 9);
    const parts = s.doc.objectsAt(31, 9).map((o) => o.part);
    expect(parts).toHaveLength(MAX_STACK);
    expect(parts[MAX_STACK - 1]).toBe("growCap");
  });

  it("takes a stack apart from the top", () => {
    const s = session();
    s.placeObject("shellWalker", 32, 9);
    s.placeObject("walker", 32, 9);

    expect(s.removeObjectAt(32, 9)).toBe(true);
    // The one that vanishes is the one on top - removing from underneath would
    // look like the wrong thing disappeared.
    expect(s.doc.objectsAt(32, 9).map((o) => o.part)).toEqual(["shellWalker"]);

    expect(s.removeObjectAt(32, 9)).toBe(true);
    expect(s.doc.objectsAt(32, 9)).toHaveLength(0);
  });

  it("compiles a stack into spawn records that know their height", () => {
    const s = session();
    s.placeObject("shellWalker", 33, 9);
    s.placeObject("walker", 33, 9);

    const area = compileLevel(s.doc.toDoc()).spawns.filter((sp) => sp.tx === 33 && sp.ty === 9);
    expect(area.map((sp) => sp.stack)).toEqual([0, 1]);
  });

  it("refuses to delete the start and finish flags", () => {
    const s = session();
    const start = s.doc.findByPart(MARKER_START)!;
    expect(s.removeObjectAt(start.tx, start.ty)).toBe(false);
    expect(s.doc.findByPart(MARKER_START)).toBeDefined();
  });
});

describe("validation", () => {
  it("reports a missing finish as an error and a missing start as a warning", () => {
    const doc = createEmptyLevel("x");
    const stripped = {
      ...doc,
      areas: [{ ...doc.areas[0], objects: [] }] as typeof doc.areas,
    };
    const issues = validateLevel(stripped);
    expect(issues.some((i) => i.severity === "error")).toBe(true);
    expect(issues.some((i) => i.severity === "warning")).toBe(true);
  });

  it("passes a level built from the template", () => {
    expect(validateLevel(createEmptyLevel("x"))).toHaveLength(0);
  });
});

describe("test play", () => {
  it("never refuses to run an unfinished level", () => {
    // Build a bit, try it, build more: refusing to run a level without a goal
    // breaks the only loop that matters.
    const doc = createEmptyLevel("x");
    const s = new EditorSession({
      ...doc,
      areas: [{ ...doc.areas[0], objects: [] }] as typeof doc.areas,
    });
    expect(s.blockingIssues.length).toBeGreaterThan(0);
    s.play();
    expect(s.mode).toBe("play");
    s.sim.step();
    expect(Number.isFinite(s.sim.player.x)).toBe(true);
  });

  it("picks up edits made since the last play", () => {
    const s = session();
    s.activePart = 1;
    s.beginStroke("wall");
    s.fillRect(30, 10, 30, 20);
    s.endStroke();
    s.play();
    expect(s.sim.map.isSolid(30, 15)).toBe(true);
  });

  it("spawns at an arbitrary tile without moving the start flag", () => {
    // "Play from here" is one of the highest-frequency actions in an editor.
    // Writing the transient spawn into the document would quietly relocate the
    // real start every time it is used.
    const s = session();
    const before = { ...s.doc.findByPart(MARKER_START)! };
    s.play({ tx: 55, ty: 8 });
    expect(s.doc.findByPart(MARKER_START)).toMatchObject({
      tx: before.tx,
      ty: before.ty,
    });
  });
});

describe("camera", () => {
  it("maps screen points to tiles through zoom and pan", () => {
    const s = session();
    s.camera.zoom = 2;
    s.camera.x = 160;
    s.camera.y = 80;
    // 32 screen px at 2x = 16 world px = 1 tile past the camera origin.
    expect(s.screenToTile(32, 32)).toEqual({ tx: 11, ty: 6 });
  });

  it("zooms to fit the whole level in view", () => {
    const s = session();
    s.zoomToFit(800, 400);
    const visibleTiles = 800 / s.camera.zoom / 16;
    expect(visibleTiles).toBeGreaterThanOrEqual(s.doc.width * 0.9);
  });
});

describe("document round trip", () => {
  it("survives edit -> serialize -> reload unchanged", () => {
    const s = session();
    s.activePart = 3;
    s.beginStroke("edit");
    s.fillRect(20, 12, 26, 14);
    s.endStroke();
    s.placeMarker(MARKER_GOAL, 40, 11);

    const reloaded = new EditorSession(s.doc.toDoc());
    expect(reloaded.doc.partAt(23, 13)).toBe(3);
    expect(reloaded.doc.findByPart(MARKER_GOAL)).toMatchObject({ tx: 40, ty: 11 });
    expect(reloaded.doc.toDoc()).toEqual(s.doc.toDoc());
  });

  it("loads the built-in test room through the ordinary path", () => {
    // The greybox must not get a private code path, or it stops being a test
    // of the real thing.
    const s = new EditorSession(buildGreyboxDoc());
    expect(s.doc.width).toBe(120);
    s.play();
    expect(s.sim.map.isSolid(5, 22)).toBe(true);
  });
});
