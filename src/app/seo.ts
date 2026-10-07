import type { Metadata } from "next";
import { BRAND } from "@/branding";

/**
 * Share and search metadata, kept out of layout.tsx so a node test can import
 * it without pulling in next/font. Every string comes from BRAND.
 */
const OG_IMAGE = {
  url: "/og.jpg",
  width: 1200,
  height: 630,
  alt: BRAND.ogAlt,
};

export const metadata: Metadata = {
  metadataBase: new URL(BRAND.origin),
  title: BRAND.name,
  description: BRAND.description,
  // No canonical or og:url here: the root layout's would be inherited by every page, the 404 included.
  openGraph: {
    type: "website",
    siteName: BRAND.name,
    locale: "en_US",
    title: BRAND.name,
    description: BRAND.description,
    images: [OG_IMAGE],
  },
  twitter: {
    card: "summary_large_image",
    title: BRAND.name,
    description: BRAND.description,
    images: [OG_IMAGE],
  },
};

/** The home page's own metadata: a self canonical. */
export const homeMetadata: Metadata = {
  alternates: { canonical: "/" },
};

/** JSON-LD for an inline script tag: "<" is escaped so no string in it can close the tag. */
export function jsonLdHtml(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

/** The one WebApplication node the home page emits. No email, price or rating. */
export const webApplicationJsonLd = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: BRAND.name,
  url: BRAND.origin,
  description: BRAND.description,
  applicationCategory: "GameApplication",
  operatingSystem: "Any (web browser)",
  image: `${BRAND.origin}/og.jpg`,
  author: {
    "@type": "Person",
    "@id": BRAND.credit.authorId,
    name: BRAND.credit.authorName,
    url: BRAND.credit.siteUrl,
  },
  subjectOf: { "@type": "WebPage", url: BRAND.credit.href },
} as const;
