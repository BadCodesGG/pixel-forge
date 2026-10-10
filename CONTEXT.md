# Context

Glossary for Pixel Forge, a browser level editor and deterministic 2D platformer engine. Terms are
used as defined here in code, tests and docs. See README.md and CONTRIBUTING.md for the rules.

## Terms

- **Engine**: `src/engine`. The headless simulation. No DOM, React, floats, bitwise operators or clock.
- **Sim**: the engine's tick function (`sim.ts`): one input in, one world state out.
- **World**: the engine's entity storage and snapshot, including the PRNG state.
- **Fixed-point**: every position, velocity and acceleration is an integer count of 1/4096 px.
- **Style**: a set of physics constants for a game feel. `retro` is the only one (`styles/retro.ts`).
- **Hitstop**: a sim-side freeze of the world on a stomp. It changes run outcomes, so it lives in the sim.
- **Host**: `src/host`. DOM-facing code: game loop, input, renderers, sprites, audio.
- **Presentation**: particles, score popups and audio. Lives in the host, never in the sim.
- **LevelDoc**: the immutable serialization shape of a level (`format/level.ts`). Not the edit-time shape.
- **Edit-time document**: the editor's mutable `Uint16Array` grid plus a `Map` of objects. `toDoc()` makes a LevelDoc.
- **contentHash**: hash of authored content only (no ids, titles or timestamps), so autosaves do not change it.
- **Part**: a placeable thing (terrain, hazard, pickup, enemy, pipe, flag), identified by a numeric id in the registry (`format/parts.ts`).
- **Retired part**: a part whose row stays in the registry, marked `retired`. Ids are append-only and never reused.
- **Command**: an undoable editor action (`editor/commands.ts`). Undo and redo act on a whole gesture.
- **Session**: `EditorSession`, the editor's runtime state. Lives in a ref, never in React state.
- **Compile**: turn a LevelDoc into a runnable world (`engine/level/compile.ts`).
- **Repository**: the `LevelRepository` interface over IndexedDB. Every record carries an `ownerId`.
- **Back up / Restore**: export or import every level as one JSON file. The only durable copy.
- **Semisolid**: a platform solid only from above.
- **Warp pipe**: one of four colour-paired pipes that teleport the player.
- **Gem**: the power pickup that makes the player big.
- **Walker / shell walker**: the two enemy kinds.
- **Dependency rule**: `engine -> format -> editor / host -> components`; nothing imports to its right.
