import type { MetadataRoute } from "next";

import { SITE_DESCRIPTION, SITE_NAME } from "@/lib/site";

// globals.css :root(다크 기본 테마)의 --bg 값. manifest는 CSS 변수를 못 읽어 리터럴로 둔다.
const THEME_BG = "#0b0e14";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SITE_NAME,
    short_name: SITE_NAME,
    description: SITE_DESCRIPTION,
    lang: "ko",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: THEME_BG,
    theme_color: THEME_BG,
    icons: [
      { src: "/icon/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon/192", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icon/512", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
