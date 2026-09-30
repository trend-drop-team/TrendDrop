import type { ReactElement } from "react";

import { C, type CardArt, SHELL_TEXT, WORDMARK, clamp, fitTitleSize } from "@/app/card-art";
import { OG_FONT_FAMILY } from "@/lib/og-font";
import { siteDomain } from "@/lib/site";

/**
 * 인스타 피드·카톡에 그대로 올리는 정사각 공유 카드(이슈 #51 본문 1·2번).
 *
 * 링크 미리보기 카드(og-card.tsx, 1200×630)와 같은 톤·같은 렌더러를 쓰되,
 * 정사각은 세로가 넉넉해 지표를 가로로 늘어놓지 않고 쌓아 크게 보여 준다.
 */
export const SHARE_CARD_SIZE = { width: 1080, height: 1080 };

const PAD = 88;
/** 본문 가용 폭 — 제목 줄 수를 어림잡는 기준. */
const INNER = SHARE_CARD_SIZE.width - PAD * 2;

/** 어떤 길이가 와도 두 줄을 넘지 않도록 잡은 단계. (한글 한 글자 ≈ 폰트 크기) */
const TITLE_STEPS: [number, number][] = [
  [8, 104],
  [16, 84],
  [26, 66],
  [Infinity, 54],
];

function Shell({ children, footerRight }: { children: ReactElement; footerRight: string }) {
  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        padding: `${PAD}px`,
        background: C.bg,
        color: C.text,
        fontFamily: OG_FONT_FAMILY,
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: SHARE_CARD_SIZE.width,
          height: 12,
          backgroundImage: `linear-gradient(90deg, ${C.accent}, ${C.accent2})`,
        }}
      />

      <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
        <div style={{ width: 20, height: 20, borderRadius: 999, background: C.accent }} />
        <div style={{ fontSize: 36, fontWeight: 700, letterSpacing: 9 }}>{WORDMARK}</div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", flex: 1, justifyContent: "center" }}>
        {children}
      </div>

      {/* 스토어 유입이 없으니 여기 적힌 주소가 유일한 재방문 단서다. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          paddingTop: 34,
          borderTop: `1px solid ${C.line}`,
          fontSize: 32,
          color: C.muted,
        }}
      >
        <div style={{ display: "flex", color: C.text, fontWeight: 700 }}>{siteDomain()}</div>
        <div style={{ display: "flex" }}>{footerRight}</div>
      </div>
    </div>
  );
}

function Divider() {
  return <div style={{ display: "flex", height: 1, width: INNER, background: C.line }} />;
}

function SubMetric({ value, label }: { value: string; label: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", fontSize: 48, fontWeight: 700, lineHeight: 1 }}>{value}</div>
      <div style={{ display: "flex", fontSize: 28, color: C.muted, lineHeight: 1 }}>{label}</div>
    </div>
  );
}

export type KeywordSquareInput = {
  rank: number;
  keyword: string;
  category: string;
  growth: string;
  score: number;
  velocity: string;
  updatedAgo: string;
};

/** 키워드 한 장 — "○○ 지금 3위, +142%"를 그림으로. */
export function keywordSquareCard(input: KeywordSquareInput): CardArt {
  const keyword = clamp(input.keyword, 34);
  const category = clamp(input.category, 12);
  const rank = `${input.rank}위`;
  const score = `${input.score}/100`;
  const footerRight = input.updatedAgo ? `${input.updatedAgo} 갱신` : "실시간 트렌드";

  const element = (
    <Shell footerRight={footerRight}>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18, marginBottom: 36 }}>
          <div
            style={{
              display: "flex",
              padding: "12px 32px",
              borderRadius: 999,
              background: C.accentSoft,
              color: C.accent,
              fontSize: 40,
              fontWeight: 700,
            }}
          >
            {rank}
          </div>
          <div
            style={{
              display: "flex",
              padding: "12px 28px",
              borderRadius: 999,
              border: `1px solid ${C.line}`,
              color: C.muted,
              fontSize: 34,
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
            marginBottom: 48,
          }}
        >
          {keyword}
        </div>

        <Divider />

        {/* 상승률이 이 카드의 헤드라인이다 — 가장 크게. */}
        <div style={{ display: "flex", flexDirection: "column", gap: 18, marginTop: 44 }}>
          <div
            style={{
              display: "flex",
              fontSize: 100,
              fontWeight: 700,
              lineHeight: 1,
              color: C.accent,
            }}
          >
            {input.growth}
          </div>
          <div style={{ display: "flex", fontSize: 32, color: C.muted, lineHeight: 1 }}>
            검색 상승률
          </div>
        </div>

        <div style={{ display: "flex", gap: 96, marginTop: 56 }}>
          <SubMetric value={score} label="트렌드 점수" />
          <SubMetric value={input.velocity} label="확산 속도" />
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

export type SquareRow = { rank: number; keyword: string; growth: string };

/** 오늘의 TOP5 한 장. */
export function topFiveSquareCard(rows: SquareRow[]): CardArt {
  const heading = "오늘의 트렌드 TOP 5";
  const shown = rows.slice(0, 5).map((row) => ({ ...row, keyword: clamp(row.keyword, 12) }));
  const footerRight = "24시간 집계";

  const element = (
    <Shell footerRight={footerRight}>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", fontSize: 56, fontWeight: 700, marginBottom: 52 }}>
          {heading}
        </div>

        {shown.length === 0 ? (
          <div style={{ display: "flex", fontSize: 40, color: C.muted }}>지금 집계 중입니다</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {shown.map((row) => (
              <div
                key={row.rank}
                style={{ display: "flex", alignItems: "center", gap: 34, height: 96 }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "center",
                    width: 62,
                    fontSize: 52,
                    fontWeight: 700,
                    color: row.rank === 1 ? C.accent : C.muted,
                  }}
                >
                  {row.rank}
                </div>
                <div style={{ display: "flex", flex: 1, fontSize: 50, fontWeight: 700 }}>
                  {row.keyword}
                </div>
                <div style={{ display: "flex", fontSize: 42, color: C.accent }}>{row.growth}</div>
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
