import type { MetadataRoute } from "next";
import { BRAND } from "@/branding";

// The app has one public route.
export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: `${BRAND.origin}/` }];
}
