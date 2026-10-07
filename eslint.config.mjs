import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/**
 * ENGINE PURITY RULES.
 *
 * `src/engine` is the deterministic simulation. Given the same level bytes and
 * the same input log it must produce bit-identical results on every machine,
 * every browser and every run. That is the design goal: determinism is what
 * would keep replays and independent verification of a run possible later.
 *
 * Determinism is not something you can achieve by being careful; it is
 * something you enforce mechanically. These rules are the enforcement.
 * See the Determinism section of CONTRIBUTING.md (#determinism).
 */
const enginePurity = {
  files: ["src/engine/**/*.ts"],
  rules: {
    // --- No I/O, no DOM, no framework -------------------------------------
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          {
            group: ["react", "react-dom", "next", "next/*", "zustand", "@/app/*", "@/editor/*"],
            message:
              "src/engine must stay headless so it can run in Node so it stays deterministic and testable in Node. Move this to src/app or src/editor.",
          },
        ],
      },
    ],
    "no-restricted-globals": [
      "error",
      { name: "window", message: "src/engine must not touch the DOM." },
      { name: "document", message: "src/engine must not touch the DOM." },
      { name: "navigator", message: "src/engine must not touch the DOM." },
      { name: "localStorage", message: "src/engine must not do I/O." },
      { name: "indexedDB", message: "src/engine must not do I/O." },
      { name: "fetch", message: "src/engine must not do I/O." },
      {
        name: "requestAnimationFrame",
        message: "The engine is driven by the host's loop; it never schedules itself.",
      },
      {
        name: "performance",
        message: "Wall-clock time is nondeterministic. The sim advances in fixed ticks only.",
      },
    ],

    // --- No nondeterministic sources --------------------------------------
    "no-restricted-properties": [
      "error",
      {
        object: "Math",
        property: "random",
        message: "Use the seeded PRNG from engine/math/rng.ts: its state lives in the world snapshot.",
      },
      { object: "Date", property: "now", message: "Wall-clock time is nondeterministic." },
      { object: "performance", property: "now", message: "Wall-clock time is nondeterministic." },
    ],

    // --- Numeric discipline (see engine/math/fixed.ts) ---------------------
    //
    // Bitwise operators coerce to int32. Fixed-point positions exceed int32 as
    // soon as you multiply two of them (a slope interpolation reaches ~4e9), so
    // `(a * b) >> 12` silently returns garbage. All Fixed math goes through
    // fixed.ts, which uses Math.floor and stays inside 2^53.
    "no-bitwise": "error",
    "no-restricted-syntax": [
      "error",
      {
        selector: "NewExpression[callee.name='Date']",
        message: "Wall-clock time is nondeterministic.",
      },
      {
        // Float literals. Every physics constant is an exact integer in
        // 1/4096-px units; a float in the sim means a unit conversion was
        // skipped. Documented conversions belong in comments, not in code.
        selector: "Literal[raw=/^[0-9]*\\.[0-9]+$/]",
        message:
          "No floats in the sim. Express the value as an integer in 1/4096-px units (see engine/math/fixed.ts).",
      },
    ],
  },
};

/**
 * Test relaxations.
 *
 * Floats: tests assert human-readable expectations ("2.5 px/frame") and are
 * clearer for it.
 *
 * Bitwise: composing and inspecting flag words (`TileFlags.SOLID | TileFlags.ICE`)
 * is what bitwise operators are for. The engine-wide ban exists to stop int32
 * coercion of fixed-point COORDINATES; flag words are small by construction and
 * cannot overflow, so the hazard does not apply. Engine source keeps the ban and
 * uses the helpers in core/flags.ts instead.
 */
const engineTestRelaxations = {
  files: ["src/engine/**/*.test.ts"],
  rules: {
    "no-restricted-syntax": "off",
    "no-restricted-properties": "off",
    "no-bitwise": "off",
  },
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  enginePurity,
  engineTestRelaxations,
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
