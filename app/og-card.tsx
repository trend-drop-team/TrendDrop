import type { ReactElement } from "react";

import { C, type CardArt, SHELL_TEXT, WORDMARK, clamp, fitTitleSize } from "@/app/card-art";
import { OG_FONT_FAMILY } from "@/lib/og-font";
import { siteDomain } from "@/lib/site";

/** 카톡·슬랙·X가 공통으로 기대하는 링크 미리보기 비율(1.91:1). */
export const OG_SIZE = { width: 1200, height: 630 };

export type OgCard = CardArt;

/** 가로로 넓고 세로가 얕아, 긴 키워드는 한 줄에 맞춰 빨리 줄인다. */
const TITLE_STEPS: [number, number][] = [
  [9, 88],
  [14, 70],
  [20, 56],
  [Infinity, 44],
];

function Shell({
  children,
  footerRight,
}: {
  children: ReactElement;
  footerRight: string;
}) {
  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        padding: "52px 72px 44px",
        background: C.bg,
        color: C.text,
        fontFamily: OG_FONT_FAMILY,
      }}
    >
      {/* 브랜드 색 한 줄 — 어느 서비스 카드인지 썸네일 크기에서도 구분되게. */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: OG_SIZE.width,
          height: 8,
          backgroundImage: `linear-gradient(90deg, ${C.accent}, ${C.accent2})`,
        }}
      />

      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <div style={{ width: 16, height: 16, borderRadius: 999, background: C.accent }} />
        <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: 7 }}>{WORDMARK}</div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", flex: 1, justifyContent: "center" }}>
        {children}
      </div>

      {/* 스토어 유입이 없으므로 카드에 적힌 이 주소가 유일한 재방문 단서다. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          paddingTop: 26,
          borderTop: `1px solid ${C.line}`,
          fontSize: 26,
          color: C.muted,
        }}
      >
        <div style={{ display: "flex", color: C.text, fontWeight: 700 }}>{siteDomain()}</div>
        <div style={{ display: "flex" }}>{footerRight}</div>
      </div>
    </div>
  );
}

function Metric({ value, label, accent }: { value: string; label: string; accent?: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", fontSize: 44, fontWeight: 700, color: accent ? C.accent : C.text }}>
        {value}
      </div>
      <div style={{ display: "flex", fontSize: 22, color: C.muted }}>{label}</div>
    </div>
  );
}

export type KeywordCardInput = {
  rank: number;
  keyword: string;
  category: string;
  growth: string;
  score: number;
  velocity: string;
  updatedAgo: string;
};

/** 키워드 하나짜리 카드 — "○○ 지금 3위, +142%"를 한 장으로(이슈 #51 본문 2번). */
export function keywordCard(input: KeywordCardInput): OgCard {
  const keyword = clamp(input.keyword, 26);
  const category = clamp(input.category, 12);
  const rank = `${input.rank}위`;
  const score = `${input.score}/100`;
  const footerRight = input.updatedAgo ? `${input.updatedAgo} 갱신` : "실시간 트렌드";

  const element = (
    <Shell footerRight={footerRight}>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 30 }}>
          <div
            style={{
              display: "flex",
              padding: "8px 22px",
              borderRadius: 999,
              background: C.accentSoft,
              color: C.accent,
              fontSize: 30,
              fontWeight: 700,
            }}
          >
            {rank}
          </div>
          <div
            style={{
              display: "flex",
              padding: "8px 20px",
              borderRadius: 999,
              border: `1px solid ${C.line}`,
              color: C.muted,
              fontSize: 26,
            }}
          >
            {category}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            fontSize: fitTitleSize(keyword, TITLE_STEPS),
            fontWeight: 700,
            lineHeight: 1.2,
            letterSpacing: -1,
          }}
        >
          {keyword}
        </div>

        <div style={{ display: "flex", gap: 64, marginTop: 44 }}>
          <Metric value={input.growth} label="검색 상승률" accent />
          <Metric value={score} label="트렌드 점수" />
          <Metric value={input.velocity} label="확산 속도" />
        </div>
      </div>
    </Shell>
  );

  return {
    element,
    text: [
      ...SHELL_TEXT,
      keyword,
      category,
      rank,
      score,
      input.growth,
      input.velocity,
      footerRight,
      "검색 상승률트렌드 점수확산 속도",
    ],
  };
}

export type TopRow = { rank: number; keyword: string; growth: string };

/** 오늘의 TOP5 카드 — 홈 링크를 붙였을 때 뜨는 그림(이슈 #51 본문 1번). */
export function topFiveCard(rows: TopRow[]): OgCard {
  const heading = "오늘의 트렌드 TOP 5";
  const shown = rows.slice(0, 5).map((row) => ({ ...row, keyword: clamp(row.keyword, 18) }));
  const footerRight = "24시간 집계";

  const element = (
    <Shell footerRight={footerRight}>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", fontSize: 40, fontWeight: 700, marginBottom: 30 }}>
          {heading}
        </div>

        {shown.length === 0 ? (
          <div style={{ display: "flex", fontSize: 30, color: C.muted }}>
            지금 집계 중입니다
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {shown.map((row) => (
              <div
                key={row.rank}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 26,
                  height: 52,
                  paddingLeft: 4,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "center",
                    width: 46,
                    fontSize: 34,
                    fontWeight: 700,
                    color: row.rank === 1 ? C.accent : C.muted,
                  }}
                >
                  {row.rank}
                </div>
                <div style={{ display: "flex", flex: 1, fontSize: 38, fontWeight: 700 }}>
                  {row.keyword}
                </div>
                <div style={{ display: "flex", fontSize: 30, color: C.accent }}>{row.growth}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Shell>
  );

  return {
    element,
    text: [
      ...SHELL_TEXT,
      heading,
      footerRight,
      "지금 집계 중입니다",
      ...shown.map((row) => `${row.rank}${row.keyword}${row.growth}`),
    ],
  };
}
