import { FORMAT_VERSION, type LevelDoc } from "@/format/level";

/**
 * EXPORT AND IMPORT: the backstop against losing everything.
 *
 * Until there is a cloud, a level exists in exactly one place: this browser's
 * IndexedDB. That is less durable than it sounds. Safari deletes script-created
 * storage after seven days without user interaction, and when eviction happens
 * it takes the WHOLE origin at once: every level, not the oldest few. Clearing
 * site data does the same thing, and young players click things.
 *
 * So a plain file the parent can copy somewhere is not a nice-to-have; it is
 * the only durable copy that exists. It is also the honest, non-manipulative
 * reason to offer an account later: "so you don't lose these", not "sign up to
 * continue".
 */

export interface LevelBundle {
  readonly kind: "pixel-forge-levels";
  readonly version: number;
  readonly exportedAt: string;
  readonly levels: readonly LevelDoc[];
}

export function makeBundle(levels: readonly LevelDoc[]): LevelBundle {
  return {
    kind: "pixel-forge-levels",
    version: FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    levels,
  };
}

/**
 * Parse a bundle, rejecting anything that is not one.
 *
 * A dropped file is untrusted input heading straight for the compiler. A
 * malformed one must fail with a sentence a person can act on, not throw
 * somewhere deep in the renderer three seconds later.
 */
export function parseBundle(text: string): { levels: LevelDoc[] } | { error: string } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { error: "That file isn't a level pack: it isn't even valid JSON." };
  }

  // `JSON.parse` happily returns null, a number or a string. Reading a property
  // off any of those throws, which would turn "the user picked the wrong file"
  // into an unhandled exception.
  if (typeof data !== "object" || data === null) {
    return { error: "That file doesn't contain any levels." };
  }

  const bundle = data as Partial<LevelBundle>;
  // A single level exported on its own is a reasonable thing to hand someone,
  // so accept that shape too rather than being pedantic about the wrapper.
  const levels = Array.isArray(bundle.levels)
    ? bundle.levels
    : isLevelDoc(data)
      ? [data]
      : null;

  if (!levels) return { error: "That file doesn't contain any levels." };

  const valid = levels.filter(isLevelDoc);
  if (valid.length === 0) return { error: "None of the levels in that file could be read." };

  const tooNew = valid.filter((l) => l.minReader > FORMAT_VERSION);
  if (tooNew.length === valid.length) {
    return { error: "These levels were made with a newer version of the app." };
  }

  return { levels: valid.filter((l) => l.minReader <= FORMAT_VERSION) };
}

function isLevelDoc(value: unknown): value is LevelDoc {
  if (typeof value !== "object" || value === null) return false;

  // Deliberately inspected as an untyped record. Casting to Partial<LevelDoc>
  // lets TypeScript apply the DECLARED shape: `areas` is a one-element tuple,
  // so it "knows" the length is 1 and rejects the length check as impossible.
  // The whole point here is that the value has not been proven to have that
  // shape yet, so the checks must run against what is actually there.
  const doc = value as Record<string, unknown>;
  if (typeof doc.id !== "string" || typeof doc.title !== "string") return false;
  if (typeof doc.minReader !== "number") return false;
  if (!Array.isArray(doc.areas) || doc.areas.length === 0) return false;

  const area = doc.areas[0] as Record<string, unknown> | undefined;
  if (!area || typeof area.w !== "number" || typeof area.h !== "number") return false;
  if (!Array.isArray(area.tiles)) return false;
  return area.tiles.length === area.w * area.h;
}

/** Trigger a file download. Browser-only. */
export function downloadBundle(bundle: LevelBundle, filename = "my-levels.json"): void {
  const blob = new Blob([JSON.stringify(bundle, null, 1)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  // Revoking immediately can cancel the download in some browsers; a tick is
  // enough for the navigation to have started.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
