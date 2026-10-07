import type { Viewport } from "next";
import { Pixelify_Sans, Press_Start_2P } from "next/font/google";
import { TYPE, UI, type PixelStyle } from "@/design/tokens";
import "./globals.css";

/**
 * ONE TYPE SYSTEM, TWO FACES.
 *
 * Pixelify Sans carries every label: it is a pixel face with humanist
 * letterforms, so it still reads at 13px by someone who is eight. Press Start
 * 2P is the arcade face, reserved for the wordmark and big HUD numerals - it is
 * very wide and has a single weight, so using it for prose would cost real
 * reading effort for no gain.
 *
 * The variables are named by ROLE, not by typeface, so swapping a face later is
 * a one-line change here rather than a find-and-replace.
 *
 * Pixelify Sans is a variable font (400-700), so `weight` is omitted. Press
 * Start 2P is a single static weight, and next/font requires `weight` for
 * static faces.
 */
const ui = Pixelify_Sans({
  variable: "--font-ui",
  subsets: ["latin"],
  display: "swap",
});

const display = Press_Start_2P({
  variable: "--font-display",
  subsets: ["latin"],
  weight: "400",
  display: "swap",
});

// Every crawler-visible string comes from BRAND. See src/branding.ts for why
// that matters - the page title is a real trademark surface, unlike the code.
// The metadata lives in seo.ts so a node test can import it without next/font.
export { metadata } from "./seo";

/**
 * The game owns the viewport. `viewportFit: "cover"` puts the world under the
 * notch on a phone, and user scaling is off because a pinch during play is a
 * mis-hit, not a zoom request.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: UI.bgDeep,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  // Colours come from src/design/tokens.ts - the same values the canvas
  // renderers use, so the interface and the game are one world. They are set
  // INLINE rather than as utility classes because an inline style on <body>
  // cannot be beaten by a cascade layer, which is the exact failure that left
  // this page white and in Arial for the whole of the previous design pass.
  const bodyStyle: PixelStyle = {
    background: UI.bgDeep,
    color: UI.text,
    fontFamily: TYPE.ui,
    fontWeight: TYPE.bodyWeight,
  };

  return (
    <html lang="en" className={`${ui.variable} ${display.variable} antialiased`}>
      <body style={bodyStyle}>{children}</body>
    </html>
  );
}
