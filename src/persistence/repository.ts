import type { LevelDoc, LevelId, StoredLevel } from "@/format/level";

/**
 * THE PERSISTENCE SEAM.
 *
 * Everything above this interface (the editor, the library screen, the share
 * flow) talks only to `LevelRepository`. Today the only implementation writes
 * to IndexedDB. A remote backend behind an API route, or a syncing pair of
 * the two, would implement the same interface.
 *
 * That is the entire reason this interface exists. Adding a backend later is
 * only cheap if nothing above it ever learned where the data lives, and the way
 * that guarantee is kept is by never letting a component import the IndexedDB
 * module directly.
 *
 * ---------------------------------------------------------------------------
 * WHY ownerId EXISTS BEFORE THERE ARE ACCOUNTS
 * ---------------------------------------------------------------------------
 * Every record carries an owner from the very first save, set to a local guest
 * id. When accounts arrive, adopting a guest's work is an UPDATE that rewrites
 * ownerId, not a schema migration, and not a rewrite of anything above this
 * line. Retrofitting an owner column onto data that never had one is the
 * expensive version of this, and it is expensive precisely when it hurts most:
 * after a young player has made sixty levels.
 */
export interface LevelRepository {
  list(): Promise<StoredLevel[]>;
  get(id: LevelId): Promise<StoredLevel | undefined>;
  /** Insert or update. Bumps `rev` and `updatedAt`. */
  save(doc: LevelDoc, ownerId: string): Promise<StoredLevel>;
  remove(id: LevelId): Promise<void>;
  /**
   * Re-parent every record from one owner to another.
   *
   * This is the whole guest-to-account migration, and it is one call because
   * ownership was modelled from day one.
   */
  claimAll(fromOwnerId: string, toOwnerId: string): Promise<number>;
}

/**
 * Who is acting right now.
 *
 * The SHAPE matters more than the current implementation. It mirrors what an
 * auth library returns (including a `loading` state) so that swapping the
 * body of `getCurrentActor` for a real session lookup does not force a
 * `loading` branch to be added at dozens of call sites afterwards. Returning
 * something synchronous and simpler today is the trap: it makes auth look
 * drop-in right up until the day it isn't.
 */
export interface Actor {
  status: "loading" | "authenticated" | "unauthenticated";
  id: string;
}

const GUEST_KEY = "pf.guestId";

/**
 * A stable local identity, created on first use.
 *
 * localStorage is the right home for this one value: it is tiny, it must be
 * readable synchronously at startup, and losing it only means the next session
 * looks like a new guest. Level DATA never goes here: the 5 MB cap and the
 * synchronous API make it wrong for anything of size.
 */
export function getLocalGuestId(): string {
  if (typeof localStorage === "undefined") return "local";
  let id = localStorage.getItem(GUEST_KEY);
  if (!id) {
    id = `guest_${crypto.randomUUID()}`;
    localStorage.setItem(GUEST_KEY, id);
  }
  return id;
}

export function getCurrentActor(): Actor {
  return { status: "unauthenticated", id: getLocalGuestId() };
}
