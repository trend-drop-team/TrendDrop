import type { Metadata } from "next";

import { fetchApiOr } from "@/lib/api-client";
import { getDocList } from "@/lib/docs";
import type { CategoryRow } from "@/types/api/category";
import type { TrendRow } from "@/types/api/trend";

import AppNav from "./app-nav";
import CommandPalette from "./command-palette";
import "./globals.css";

export const metadata: Metadata = {
  title: "TrendDrop",
  description: "SNS 기반 트렌드 탐색 웹앱 프로토타입",
};

// 첫 페인트 전에 저장된 테마를 적용해 FOUC(테마 깜빡임)를 막는다.
const themeScript = `try{var t=localStorage.getItem('td-theme');if(t==='warm'||t==='dark')document.documentElement.dataset.theme=t;}catch(e){}`;

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // filePath는 클라이언트로 내보내지 않는다.
  const paletteDocs = getDocList().map(({ slug, title, description }) => ({
    slug,
    title,
    description,
  }));

  // 커맨드 팔레트는 모든 화면에 떠 있으므로 검색 대상도 여기서 한 번만 받아 내려준다.
  //
  // 실패해도 던지지 않는다(fetchApiOr). 루트 레이아웃에서 난 에러는 app/error.tsx가 잡지 못하고
  // global-error.tsx까지 올라가, 부가 기능인 ⌘K 검색 목록 하나 때문에 모든 페이지가 통째로
  // 에러 화면이 된다. 목록이 비면 팔레트만 조용히 비고 본문은 그대로 보인다.
  const [categoryResult, trendResult] = await Promise.all([
    // 여기서 읽는 건 data뿐이라 meta까지 요구하는 ApiResult 대신 좁게 받는다(폴백에 가짜 meta를 지어내지 않도록).
    fetchApiOr<{ data: CategoryRow[] }>("/api/categories", { data: [] }),
    fetchApiOr<{ data: TrendRow[] }>("/api/trends", { data: [] }),
  ]);

  const categories = categoryResult.data.map((category) => category.name);
  const paletteKeywords = trendResult.data.map((row) => ({
    keyword: row.keyword,
    slug: row.slug,
    category: row.category,
    rank: row.rank,
  }));

  return (
    <html lang="ko" data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <AppNav />
        {children}
        {/* getDocList()는 fs를 쓰는 서버 전용이라 여기서 호출해 props로 내려준다. */}
        <CommandPalette docs={paletteDocs} categories={categories} keywords={paletteKeywords} />
      </body>
    </html>
  );
}
