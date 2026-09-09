import fs from "node:fs/promises";
import path from "node:path";

export type DocEntry = {
  slug: string;
  title: string;
  description: string;
  filePath: string;
};

export const docs: DocEntry[] = [
  {
    slug: "ui-feature-roadmap",
    title: "UI/UX 기능 로드맵",
    description: "실시간 랭킹·타임머신·커맨드 팔레트 등 남은 UI 작업과 바이럴/공유 플랜 정리",
    filePath: "ui-feature-roadmap.md",
  },
  {
    slug: "trend-services-research",
    title: "트렌드 서비스 조사",
    description: "해외·국내 트렌드 서비스 특징과 차별화 포인트를 정리한 문서",
    filePath: "trend-services-research.md",
  },
  {
    slug: "google-api-research",
    title: "Google 트렌드 소스 정리",
    description: "TrendDrop 외부 트렌드 수집에 실제로 쓸 Google 계열 소스를 정리한 문서",
    filePath: "google-api-research.md",
  },
  {
    slug: "google-api-setup",
    title: "Google 수집 소스 세팅",
    description: "YouTube Data API와 Google News RSS 기준의 MVP 세팅 문서",
    filePath: "google-api-setup.md",
  },
  {
    slug: "tiktok-api-research",
    title: "TikTok API 조사",
    description: "TikTok 공식 API의 활용 가능 범위와 비용/제약을 정리한 문서",
    filePath: "tiktok-api-research.md",
  },
  {
    slug: "prior-research-review",
    title: "사전 조사 리뷰",
    description: "이전 조사 결과의 공백과 다음 조사 우선순위를 검토한 문서",
    filePath: "prior-research-review.md",
  },
  {
    slug: "naver-api-research",
    title: "Naver API 조사",
    description: "네이버 검색광고·검색 API 기반 트렌드 활용 가능성을 정리한 문서",
    filePath: "naver-api-research.md",
  },
  {
    slug: "kakao-bigkinds-research",
    title: "Kakao·BigKinds 조사",
    description: "카카오 계열 데이터와 BigKinds Open API 활용 가능성을 정리한 문서",
    filePath: "kakao-bigkinds-research.md",
  },
];

const docsDir = path.join(process.cwd(), "docs");

export function getDocList() {
  return docs;
}

export function getDocBySlug(slug: string) {
  return docs.find((entry) => entry.slug === slug) ?? null;
}

export async function readDocContent(slug: string) {
  const doc = getDocBySlug(slug);

  if (!doc) {
    return null;
  }

  const fullPath = path.join(docsDir, doc.filePath);
  const content = await fs.readFile(fullPath, "utf8");

  return {
    ...doc,
    content,
  };
}
