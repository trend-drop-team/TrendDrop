import { ADSENSE_CLIENT, isAdsenseClientValid } from "@/lib/adsense";

// 광고 판매자 인증 파일. ca-pub-XXXX → pub-XXXX. 설정 전에는 404.
export function GET() {
  if (!isAdsenseClientValid(ADSENSE_CLIENT)) {
    return new Response("Not Found", { status: 404 });
  }
  const publisher = ADSENSE_CLIENT.replace(/^ca-/, "");
  return new Response(`google.com, ${publisher}, DIRECT, f08c47fec0942fa0\n`, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
}
