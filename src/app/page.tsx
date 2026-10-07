import EditorShell from "@/components/EditorShell";
import { UI } from "@/design/tokens";
import { homeMetadata, jsonLdHtml, webApplicationJsonLd } from "./seo";

export const metadata = homeMetadata;

/**
 * A Server Component: no browser work here, it renders the client shell that
 * owns the canvas. Later this is where a shared level's DTO gets fetched.
 *
 * THE GAME FILLS THE SCREEN. There is no max-width container, no page header
 * and no card around the play area, because all three are what made this read
 * as a web page with a game embedded in it rather than as a game. The wordmark
 * lives in a floating dock inside the editor now, so it can get out of the way
 * when you press play. BRAND.name is still crawler-visible through the metadata
 * in layout.tsx, which is the surface that actually matters for it.
 *
 * The keyboard hints that used to live up here are on every control as a title
 * attribute, next to the thing they act on.
 */
export default function Home() {
  return (
    <main style={{ position: "fixed", inset: 0, overflow: "hidden", background: UI.bgDeep }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdHtml(webApplicationJsonLd) }} />
      <EditorShell />
    </main>
  );
}
