import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async rewrites() {
    if (process.env.NODE_ENV !== "production") return [];
    return {
      // /ui-kit(#123)은 개발 전용 미리보기. 페이지 안의 notFound()는 loading.tsx 스트리밍 뒤라
      // 운영에서 200으로 나간다 — 라우트에 닿기 전에 없는 경로로 돌려 진짜 404를 낸다.
      beforeFiles: [{ source: "/ui-kit", destination: "/__dev-only-page" }],
      afterFiles: [],
      fallback: [],
    };
  },
};

export default nextConfig;
