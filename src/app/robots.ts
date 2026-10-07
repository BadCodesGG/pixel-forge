import type { MetadataRoute } from "next";
import { BRAND } from "@/branding";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/" },
    sitemap: `${BRAND.origin}/sitemap.xml`,
  };
}
