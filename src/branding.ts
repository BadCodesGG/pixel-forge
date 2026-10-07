/**
 * THE single source of the product's public identity.
 *
 * Everything user-visible or crawler-visible reads from here: the page <title>,
 * the PWA manifest, OG tags, the JSON-LD data, robots.txt, the sitemap and the
 * author credit in the HOW TO PLAY panel.
 *
 * WHY IT IS ONE FILE: keeping every one of those strings behind one constant
 * means the project's public identity is a one-line change, and there is
 * exactly one place to look when it needs to change.
 *
 * The rule: no character names, no franchise names, no publisher names.
 */
export const BRAND = {
  /** Product name. Appears in the title bar, the manifest and the header. */
  name: "Pixel Forge",
  /** Used for the PWA manifest short_name (12 chars max is the usable budget). */
  shortName: "PixelForge",
  tagline: "Build a level. Play it. Send it to a friend.",
  description:
    "A level maker and platformer you can play in your browser. Build courses, test them instantly, and keep them in a file you can send to a friend.",
  /** Default nickname for a brand-new local profile. Never the OS or account name. */
  defaultAuthorName: "Builder",
  /** Where the app lives. metadataBase, canonical and the JSON-LD url all derive from this. */
  origin: "https://pixel.badcodes.dev",
  /** Share-card alt text. */
  ogAlt: "Pixel Forge: build a level, play it, send it to a friend",
  /** The author credit: shown in the HOW TO PLAY panel and linked to the case study. */
  credit: {
    text: "built by badcodes",
    href: "https://badcodes.dev/work/pixel-forge",
    rel: "author",
    siteUrl: "https://badcodes.dev",
    authorId: "https://badcodes.dev/#person",
    authorName: "Layth Abdelqader",
  },
} as const;
