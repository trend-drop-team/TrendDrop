import type { ReactElement } from "react";

import { siteDomain } from "@/lib/site";

/**
 * 공유용 카드 아트가 공통으로 쓰는 토큰과 헬퍼.
 *
 * 링크 미리보기(1200×630, `og-card.tsx`)와 정사각 공유 카드(1080×1080,
 * `share-card/card.tsx`)가 같은 색·같은 브랜드 문구를 쓰도록 여기 모아 둔다.
 */

/** 다크 애널리틱스 토큰(globals.css :root)을 satori가 읽을 수 있는 리터럴로 옮긴 것. */
export const C = {
  bg: "#0b0e14",
  text: "#e6eaf0",
  muted: "#8a93a6",
  accent: "#3ddc84",
  accent2: "#38bdf8",
  accentSoft: "rgba(61, 220, 132, 0.14)",
  line: "rgba(255, 255, 255, 0.10)",
};

/** 카드 하나 = 그릴 엘리먼트 + 거기 실제로 쓰인 문자열(폰트 서브셋 요청용). */
export type CardArt = { element: ReactElement; text: string[] };

export const WORDMARK = "TRENDDROP";

/** 모든 카드에 공통으로 박히는 글자 — 폰트 서브셋 요청에 항상 포함해야 한다. */
export const SHELL_TEXT = [WORDMARK, siteDomain()];

/** 아무리 줄여도 안 들어가는 길이는 잘라 낸다. */
export function clamp(text: string, max: number): string {
  const chars = [...text];
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join("")}…`;
}

/**
 * 글자 수에 따라 제목 크기를 고른다.
 * satori에는 "칸에 맞춰 줄어드는 폰트"가 없어 렌더 전에 정해야 한다.
 */
export function fitTitleSize(text: string, steps: [number, number][]): number {
  const length = [...text].length;
  for (const [maxLength, size] of steps) {
    if (length <= maxLength) return size;
  }
  return steps[steps.length - 1][1];
}
