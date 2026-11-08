"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { COMMAND_OPEN_EVENT } from "./command-palette";
import { apiUrl } from "@/lib/api-url";

type Chip = { keyword: string; slug: string };

const CHIP_COUNT = 8;

/**
 * 데스크톱 웹 왼쪽 브랜드 패널. 넓은 화면에선 앱을 오른쪽 앱 칼럼(휴대폰 폭)으로 보여 주고,
 * 남는 왼쪽에 로고·검색·지금 뜨는 키워드를 둔다(펫프렌즈·PPZ 데스크톱 레이아웃 참고).
 * 모바일·태블릿에선 CSS로 숨긴다 — 그래서 데이터도 보일 때만(마운트 후) 가져온다.
 */
export default function StageAside() {
  const [chips, setChips] = useState<Chip[]>([]);

  useEffect(() => {
    if (!window.matchMedia("(min-width: 1024px)").matches) return;
    const controller = new AbortController();
    fetch(apiUrl(`/api/trends?limit=${CHIP_COUNT}`), { signal: controller.signal })
      .then((response) => (response.ok ? (response.json() as Promise<{ data: Chip[] }>) : null))
      .then((payload) => {
        if (payload?.data) setChips(payload.data.slice(0, CHIP_COUNT).map(({ keyword, slug }) => ({ keyword, slug })));
      })
      .catch(() => {
        // 키워드를 못 받아도 패널은 로고·검색만으로 충분하다.
      });
    return () => controller.abort();
  }, []);

  return (
    <div className="stage-aside-inner">
      <Link href="/" className="stage-logo" aria-label="TrendDrop 홈">
        <span className="brand-mark">TD</span>
        <span className="stage-logo-name">TrendDrop</span>
      </Link>

      <h1 className="stage-title">
        지금 뜨는 트렌드,
        <br />
        <em>가장 먼저</em> 알기
      </h1>
      <p className="stage-sub">커뮤니티·검색·X·유튜브에서 한 시간마다 모아, 왜 뜨는지까지 정리합니다.</p>

      <button type="button" className="stage-search" onClick={() => window.dispatchEvent(new Event(COMMAND_OPEN_EVENT))}>
        <span>키워드나 카테고리를 찾아보세요</span>
        <span className="stage-search-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" focusable="false">
            <circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" strokeWidth="2.4" />
            <path d="m15.5 15.5 5 5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
          </svg>
        </span>
      </button>

      {chips.length > 0 && (
        <div className="stage-chips-block">
          <p className="stage-chips-title">지금 많이 보는 키워드</p>
          <ul className="stage-chips">
            {chips.map((chip, index) => (
              <li key={chip.slug}>
                <Link href={`/trend/${encodeURIComponent(chip.slug)}`} className="stage-chip">
                  <span className="stage-chip-rank">{index + 1}</span>
                  {chip.keyword}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="stage-foot">휴대폰에서는 홈 화면에 추가하면 앱처럼 바로 열 수 있어요.</p>
    </div>
  );
}
