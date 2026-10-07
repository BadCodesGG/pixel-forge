# Pixel Forge

**Build a platformer course in your browser, play it instantly, send it to someone.**
A level editor and a deterministic 2D platformer engine, in TypeScript.

**Live: [pixel.badcodes.dev](https://pixel.badcodes.dev)**

<!-- demo-video -->

The art, sound, levels, code and names are original: the art is drawn in code and the audio is synthesised in code. The numeric parameters of the retro movement style follow published research into classic NES-era platformer movement (see [Original work](#original-work)). The simulation is its own headless TypeScript build, separate from the editor, so the physics can be tested in Node without a browser.

## What you can do

**Build.** Draw, rub out and drag-fill. Place start and finish flags, terrain and hazard blocks (ground, hard block, brick, ice, platform, two slopes, spikes and pipe), coins, power gems, extra lives, walkers and shell walkers, and four colour-paired warp pipes. Undo and redo a whole gesture at a time. There is a minimap with click-to-jump, zoom and a grid toggle.

**Play.** Press Enter, or Shift+Enter to start from the cursor. Movement is momentum-based with variable jump height, slopes, semisolids, ice and moving platforms. You get enemies to stomp, coins, a power gem that makes you big, spikes, a timer and a goal. Hitstop, screen shake, particles, score popups, chained-stomp scoring and a fully procedural soundtrack are in.

**Keep.** Levels autosave to IndexedDB and reopen where you left off. You can keep several named levels, and Back up / Restore writes every level to a JSON file. That file is currently the only durable copy, see [Durability](#durability).

Keyboard, gamepad, mouse and touch are all supported.

## How it works

```
src/
  engine/     THE SIMULATION. No DOM, no React, no floats, no I/O.
    math/       fixed-point arithmetic and a seeded PRNG
    core/       entity storage, ids, flags, input bitfield, constants
    collision/  tile shapes, tilemap, the resolver, moving platforms
    systems/    player movement, entity behaviour
    styles/     physics constants per game style
    level/      compile a document into a runnable world
    sim.ts      one tick in, one world state out
  format/     the level document, the part registry
  editor/     the edit-time document, commands/undo, the session
  host/       DOM-facing: game loop, input, renderers, sprites, audio
  components/ React chrome
  persistence/ IndexedDB repository, export/import
  design/     colour, size and type tokens
```

The dependency rule is one-way: `engine -> format -> editor / host -> components`. The engine knows nothing about anything to its right.

**Engine separate from the editor.** `src/engine` is typechecked by its own `tsconfig.engine.json` with no DOM lib at all, and ESLint bans React, Next and browser globals inside it. It runs headless in Node, which is what makes the physics testable (and, eventually, verifiable server-side) without a browser.

**Integer maths.** Every position, velocity and acceleration is an integer count of 1/4096 px. There are no floats, no bitwise operators and no clock in the engine, and randomness comes from a seeded PRNG whose state lives in the world snapshot. The simulation produces bit-identical results on every machine, which is the property replays and ghosts would need if they are added.

**LevelDoc.** `LevelDoc` is the serialization shape, not the edit-time shape. The editor holds a mutable `Uint16Array` grid plus a `Map` of objects and materialises the immutable document on save, hash and export. `contentHash` covers authored content only, so autosaves do not change it.

**Append-only part ids.** Parts are identified by a numeric id in a registry. A retired part keeps its row and is marked `retired`; reusing an id would silently rewrite every level anyone has saved.

**Simulation vs presentation.** Anything that can change the outcome of a run (hitstop, screen shake magnitude, the clock) lives in the sim. Particles, score popups and audio live in the host.

## Durability

Levels live in this browser's IndexedDB and nowhere else. That is less safe than it sounds: Safari deletes script-created storage after 7 days without interaction, and it takes the whole origin at once. **Back up** writes a real file, so use it.

Everything above the `LevelRepository` interface is ignorant of where data lives, and every record already carries an `ownerId`, so a different storage backend can be added without touching the editor.

## Running it

Node 22 or 24.

```bash
git clone https://github.com/BadCodesGG/pixel-forge.git
cd pixel-forge
npm install
npm run dev              # http://localhost:3000
```

| Script | What it does |
|---|---|
| `npm run dev` | Next.js dev server |
| `npm run build` | Production build |
| `npm start` | Serve the production build |
| `npm run lint` | ESLint, including the engine import and float rules |
| `npm test` | Vitest, once |
| `npm run test:watch` | Vitest in watch mode |
| `npm run typecheck` | `tsc --noEmit` for the whole app |
| `npm run typecheck:engine` | Typecheck the engine with no DOM lib |
| `npm run check` | lint + typecheck + engine typecheck + tests; run before every commit |

[CONTRIBUTING.md](./CONTRIBUTING.md) has the rules that matter when changing the code. The three that matter most:

1. **No floats, no bitwise, no clock in `src/engine`.**
2. **`LevelDoc` is the serialization shape, not the edit-time shape.**
3. **Part ids are append-only.**

## Original work

The art, sound, levels, code and names are original: sprites are drawn in `src/host/sprites.ts` and audio is synthesised in `src/host/audio.ts`. The retro movement style's numeric parameters (`src/engine/styles/retro.ts`) follow published research into classic NES-era platformer movement. Numbers describing how a game feels are facts, not copied code or assets. No third-party code, ROM data, art, audio or marks are included. The product name lives in one place, `src/branding.ts`.

## Open items

- No onboarding, rewind-on-death or results screen yet
- The timer works but has no editor control (new levels default to 300s)
- No share codes, themes, sub-areas, checkpoints or autoscroll yet

## Licence

[MIT](./LICENSE). The Pixelify Sans and Press Start 2P typefaces are downloaded at build time by `next/font` and served from the app's own origin. They are licensed under the SIL Open Font License 1.1; they are not part of this licence.

Files that are not covered by the MIT licence, and the terms for the BadCodes name and logo, are listed in [NOTICE](NOTICE).
