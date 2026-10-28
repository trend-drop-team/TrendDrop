import type { Metadata, Viewport } from "next";
import { Noto_Sans_KR, Space_Grotesk } from "next/font/google";
import Script from "next/script";

import { getDocList } from "@/lib/docs";
import { SITE_DESCRIPTION, SITE_NAME, SITE_TITLE, siteUrl } from "@/lib/site";

import AppNav from "./app-nav";
import CommandPalette from "./command-palette";
import "./globals.css";

export const metadata: Metadata = {
  // 상대 경로 OG 이미지를 절대 주소로 펴는 기준. 없으면 카톡·슬랙이 그림을 못 불러온다.
  metadataBase: new URL(siteUrl()),
  title: { default: SITE_TITLE, template: `%s · ${SITE_NAME}` },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  // 링크를 붙였을 때 뜨는 카드. 이미지는 app/opengraph-image.tsx가 자동으로 붙인다.
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    locale: "ko_KR",
    url: "/",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
};

// viewport-fit=cover가 있어야 globals.css의 safe-area-inset 처리가 iPhone 홈 인디케이터를 피해 동작한다.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // 홈 화면 앱의 상태표시줄 색 — 기본(다크) 테마의 --bg와 같다.
  themeColor: "#0b0e14",
};

// 첫 페인트 전에 저장된 테마를 적용해 FOUC(테마 깜빡임)를 막는다.
const themeScript = `try{var t=localStorage.getItem('td-theme');if(t==='warm'||t==='dark')document.documentElement.dataset.theme=t;}catch(e){}`;

// 본문. Noto Sans KR은 용량이 커서 실제 쓰이는 굵기만 받는다(기본 400 + globals.css의 600/700/800/900).
const notoSansKr = Noto_Sans_KR({
  subsets: ["latin"],
  weight: ["400", "600", "700", "800", "900"],
  display: "swap",
  variable: "--font-noto-sans-kr",
});

// 제목·숫자. 사이트 전체에서 bold(700)로만 쓰인다.
const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["700"],
  display: "swap",
  variable: "--font-space-grotesk",
});

export default function RootLayout({
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

  return (
    <html
      lang="ko"
      data-theme="dark"
      suppressHydrationWarning
      className={`${notoSansKr.variable} ${spaceGrotesk.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <Script
          src="https://t1.kakaocdn.net/kakao_js_sdk/2.8.2/kakao.min.js"
          strategy="afterInteractive"
        />
        <AppNav />
        {children}
        {/* getDocList()는 fs를 쓰는 서버 전용이라 여기서 호출해 props로 내려준다.
            키워드·카테고리는 레이아웃에서 받지 않는다 — 팔레트를 처음 열 때 백엔드 API로 지연 로딩한다(#87). */}
        <CommandPalette docs={paletteDocs} />
      </body>
    </html>
  );
}
