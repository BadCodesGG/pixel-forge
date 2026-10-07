import { describe, expect, it } from "vitest";
import { BRAND } from "@/branding";
import { homeMetadata, jsonLdHtml, metadata, webApplicationJsonLd } from "./seo";
import robots from "./robots";
import sitemap from "./sitemap";

describe("share metadata", () => {
  it("sets metadataBase and a self canonical on the home page only", () => {
    expect(String(metadata.metadataBase)).toBe("https://pixel.badcodes.dev/");
    expect(homeMetadata.alternates?.canonical).toBe("/");
    // The root layout's would be inherited by every page, the 404 included.
    expect(metadata.alternates).toBeUndefined();
    expect(metadata.openGraph).not.toHaveProperty("url");
  });

  it("escapes the JSON-LD so no string in it can close its script tag", () => {
    const html = jsonLdHtml({ name: "</script><b>" });
    expect(html).not.toContain("<");
    expect(JSON.parse(html)).toEqual({ name: "</script><b>" });
  });

  it("sets Open Graph with the 1200x630 image and alt", () => {
    const og = metadata.openGraph as Record<string, unknown>;
    expect(og.type).toBe("website");
    expect(og.siteName).toBe("Pixel Forge");
    expect(og.locale).toBe("en_US");
    expect(og.images).toEqual([
      { url: "/og.jpg", width: 1200, height: 630, alt: BRAND.ogAlt },
    ]);
  });

  it("sets a large-image twitter card with the same image", () => {
    const tw = metadata.twitter as Record<string, unknown>;
    expect(tw.card).toBe("summary_large_image");
    expect(tw.images).toEqual((metadata.openGraph as { images: unknown }).images);
  });

  it("has no em dash in crawler-visible copy", () => {
    expect(JSON.stringify([metadata, webApplicationJsonLd])).not.toContain("\u2014");
  });
});

describe("JSON-LD", () => {
  it("links the author and the case study", () => {
    expect(webApplicationJsonLd.author["@id"]).toBe("https://badcodes.dev/#person");
    expect(webApplicationJsonLd.subjectOf.url).toBe("https://badcodes.dev/work/pixel-forge");
    expect(webApplicationJsonLd.image).toBe("https://pixel.badcodes.dev/og.jpg");
    // No contact address, price or rating: none is true of a free app, and an address invites scraping.
    for (const key of ["email", "offers", "aggregateRating"]) expect(webApplicationJsonLd).not.toHaveProperty(key);
    expect(JSON.stringify(webApplicationJsonLd)).not.toMatch(/\w@\w/);
  });
});

describe("credit", () => {
  it("carries the case study href and the exact wording", () => {
    expect(BRAND.credit.href).toBe("https://badcodes.dev/work/pixel-forge");
    expect(BRAND.credit.rel).toBe("author");
    expect(BRAND.credit.text).toBe("built by badcodes");
  });
});

describe("robots and sitemap", () => {
  it("points at the sitemap and lists the home route absolutely", () => {
    expect(robots().sitemap).toBe("https://pixel.badcodes.dev/sitemap.xml");
    expect(sitemap().map((e) => e.url)).toEqual(["https://pixel.badcodes.dev/"]);
  });
});
