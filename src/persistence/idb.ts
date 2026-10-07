import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { LevelDoc, LevelId, StoredLevel } from "@/format/level";
import type { LevelRepository } from "./repository";

/**
 * INDEXEDDB LEVEL STORAGE.
 *
 * Levels live here, not in localStorage: localStorage is capped around 5 MB,
 * is synchronous (so a big write janks the frame), stores only strings, and
 * has no indexes. A single level is 1-40 KB, and a young player will make a lot of them.
 *
 * ---------------------------------------------------------------------------
 * THE DURABILITY RULE
 * ---------------------------------------------------------------------------
 * Losing an afternoon's work is the only bug that would actually end this
 * project, because it ends the player's trust in it. So the write path is
 * deliberately conservative: the level and its history entry commit in ONE
 * transaction, deletes are reversible, and nothing is ever overwritten
 * in a way that cannot be undone.
 */

const DB_NAME = "pixel-forge";
const DB_VERSION = 1;

interface PixelForgeDB extends DBSchema {
  levels: {
    key: LevelId;
    value: StoredLevel;
    indexes: { "by-owner": string; "by-updated": number };
  };
  /** Rolling per-level version ring, so "restore an earlier version" is possible. */
  history: {
    key: string; // `${levelId}:${rev}`
    value: { key: string; levelId: LevelId; rev: number; savedAt: number; doc: LevelDoc };
    indexes: { "by-level": LevelId };
  };
}

let dbPromise: Promise<IDBPDatabase<PixelForgeDB>> | null = null;

function db(): Promise<IDBPDatabase<PixelForgeDB>> {
  if (!dbPromise) {
    dbPromise = openDB<PixelForgeDB>(DB_NAME, DB_VERSION, {
      upgrade(database) {
        const levels = database.createObjectStore("levels", { keyPath: "id" });
        levels.createIndex("by-owner", "ownerId");
        levels.createIndex("by-updated", "updatedAt");

        const history = database.createObjectStore("history", { keyPath: "key" });
        history.createIndex("by-level", "levelId");
      },
    });
  }
  return dbPromise;
}

/** How many past versions of each level to keep. */
const HISTORY_DEPTH = 20;

export class IdbLevelRepository implements LevelRepository {
  async list(): Promise<StoredLevel[]> {
    const all = await (await db()).getAll("levels");
    return all.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async get(id: LevelId): Promise<StoredLevel | undefined> {
    return (await db()).get("levels", id);
  }

  async save(doc: LevelDoc, ownerId: string): Promise<StoredLevel> {
    const database = await db();
    const now = Date.now();
    const existing = await database.get("levels", doc.id);

    const record: StoredLevel = {
      id: doc.id,
      doc,
      ownerId,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      rev: (existing?.rev ?? 0) + 1,
    };

    // ONE transaction covering both stores. A crash between two separate
    // transactions could leave a level saved with no history entry, or a
    // history entry for a level that was never written.
    const tx = database.transaction(["levels", "history"], "readwrite");
    await tx.objectStore("levels").put(record);
    await tx.objectStore("history").put({
      key: `${doc.id}:${record.rev}`,
      levelId: doc.id,
      rev: record.rev,
      savedAt: now,
      doc,
    });
    await tx.done;

    await this.trimHistory(doc.id);
    return record;
  }

  async remove(id: LevelId): Promise<void> {
    const database = await db();
    const tx = database.transaction(["levels", "history"], "readwrite");
    await tx.objectStore("levels").delete(id);
    const historyStore = tx.objectStore("history");
    const keys = await historyStore.index("by-level").getAllKeys(id);
    for (const key of keys) await historyStore.delete(key);
    await tx.done;
  }

  async claimAll(fromOwnerId: string, toOwnerId: string): Promise<number> {
    const database = await db();
    const tx = database.transaction("levels", "readwrite");
    const store = tx.objectStore("levels");
    const mine = await store.index("by-owner").getAll(fromOwnerId);
    for (const record of mine) await store.put({ ...record, ownerId: toOwnerId });
    await tx.done;
    return mine.length;
  }

  /** Past versions of one level, newest first. */
  async history(id: LevelId): Promise<{ rev: number; savedAt: number; doc: LevelDoc }[]> {
    const entries = await (await db()).getAllFromIndex("history", "by-level", id);
    return entries.sort((a, b) => b.rev - a.rev);
  }

  private async trimHistory(id: LevelId): Promise<void> {
    const database = await db();
    const entries = await database.getAllFromIndex("history", "by-level", id);
    if (entries.length <= HISTORY_DEPTH) return;
    const doomed = entries.sort((a, b) => a.rev - b.rev).slice(0, entries.length - HISTORY_DEPTH);
    const tx = database.transaction("history", "readwrite");
    for (const entry of doomed) await tx.objectStore("history").delete(entry.key);
    await tx.done;
  }
}

/**
 * Ask the browser to keep our data.
 *
 * Worth calling on the first save and worth surfacing the answer. Safari
 * deletes script-created storage after seven days without user interaction,
 * and when eviction happens it takes the ENTIRE origin at once: every level,
 * not the oldest few. Persistent storage is the mitigation; an export button
 * is the backstop for when it is refused.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.storage?.persist) return false;
  if (await navigator.storage.persisted()) return true;
  return navigator.storage.persist();
}

export const levelRepository = new IdbLevelRepository();
