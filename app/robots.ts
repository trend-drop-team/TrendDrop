import type { MetadataRoute } from "next";

import { siteUrl } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    // /docs는 관리자 전용(#79) — 크롤러가 404만 받으니 수집 대상에서 뺀다(#140).
    rules: { userAgent: "*", allow: "/", disallow: ["/api/", "/login", "/docs"] },
    sitemap: `${siteUrl()}/sitemap.xml`,
    host: siteUrl(),
  };
}
