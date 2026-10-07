# Contributing

Thanks for looking. Most of the rules below exist because breaking them fails
quietly: the tests still pass, the game still runs, and something is subtly
wrong months later. Read this before changing anything.

## Setup

Node 22 or 24.

```bash
npm install
npm run dev            # http://localhost:3000
npm run test:watch
npm run check          # lint + typecheck + engine typecheck + tests
```

Run `npm run check` before opening a pull request. There is no CI workflow in
this repository, so that command is the gate.

## The one-way dependency rule

```
engine  ->  format  ->  editor / host  ->  components
```

`src/engine` may not import React, Next, the DOM, or anything to its right. This
is enforced two ways: ESLint `no-restricted-imports` / `no-restricted-globals`,
and `tsconfig.engine.json`, which typechecks the engine with no DOM lib at all.
If a browser type appears in an engine signature, that build fails.

## Determinism

The simulation must produce bit-identical results on every machine and every
run. That is the design goal: determinism is what would keep replays, ghosts and
server-side verification possible later. None of those exist yet.

Inside `src/engine`:

- **No floats.** Every position, velocity and acceleration is an integer count
  of 1/4096 px. Float literals are an ESLint error.
- **No bitwise operators.** They coerce to int32, and fixed-point coordinates
  exceed int32 as soon as you multiply two of them. `(a * b) >> 12` silently
  returns a different number with a different sign. The exceptions are
  file-scoped and documented: `math/rng.ts`, `core/flags.ts`, `core/input.ts`.
- **No `Date`, `performance` or `Math.random`.** Randomness comes from the seeded
  PRNG whose state lives in the world snapshot.
- **Two rounding conventions, and they differ on purpose.** Scaling operations
  round toward zero so `f(-x) === -f(x)`; coordinate-to-cell conversions round
  down so the grid stays monotone across zero. Merging them breaks one or the
  other. `fixed.test.ts` pins both.

## Format rules

- **Part ids are append-only.** To retire a part, leave the row and mark it
  `retired`. Reusing an id silently rewrites every level anyone has saved.
- **`LevelDoc` is the serialization shape, not the edit-time shape.** The editor
  holds a mutable `Uint16Array` grid plus a `Map` of objects; `toDoc()`
  materialises the immutable document on save, hash and export. A pencil drag
  over a sorted array is quadratic on the most common gesture in the app.
- **`contentHash` covers authored content only**: no ids, titles or timestamps.
  Otherwise every autosave changes the hash, and the hash could not tell you
  whether a level has changed since it was last checked.

## Simulation vs presentation

Anything that can change the outcome of a run lives in the sim; anything that
cannot lives in the host.

- **In the sim:** hitstop (it genuinely freezes the world, which is why a stomp
  feels like it connects), screen shake magnitude, the clock.
- **In the host:** particles, score popups, audio. Putting these in the sim
  would make every visual tweak a determinism change that would invalidate
  any recorded replay.

## React rules

- The game loop never touches React state. `GameLoop` and `EditorSession` live
  in refs and mutate plain objects; the HUD polls at 8-10 Hz.
- Browser globals only inside effects, never at module scope. A `window`
  reference at module scope breaks the production prerender.
- `ssr: false` is illegal in a Server Component. The chain is `page.tsx`
  (server) -> `EditorShell` (`"use client"`, does the dynamic import) ->
  `Editor`.

## Pitfalls we have already hit

- **The Tailwind JIT can drop newly added arbitrary-value classes.** It has
  happened twice, once collapsing a container to 2px and once rendering every
  control at half size. Load-bearing dimensions come from `src/design/tokens.ts`
  as inline styles for exactly this reason. Do not move them back into utility
  classes.
- **Keep comments and UI strings plain ASCII.** `controls.test.ts` asserts it
  for the controls guide.

## Testing

Physics tests assert human-meaningful outcomes ("a standing jump clears about
four blocks"), not byte constants, so a failure says what changed about the
feel. Jump-height assertions are deliberately banded: a discrete per-frame
integration lands a few pixels off the closed form, and pretending otherwise
would be false precision. Tighten against playtesting before narrowing them.

When a test fails, check whether the test is wrong before the code is. Several
early failures were tests measuring the wrong stretch of level. For example,
running for 120 ticks drove the player into a wall, where `vx` correctly went to
zero and looked like "running is broken".

## Originality

Contributions must be original work. The art, sound, levels, code and names here
are original, and the retro movement style's numeric parameters follow published
research into classic NES-era platformer movement. Numbers describing how a game
feels are facts, not copied code or assets. Do not add third-party code, ROM
data, art, audio or marks. Art is drawn in code and audio is synthesised in code.

By contributing you agree your work is released under the [MIT licence](./LICENSE).
