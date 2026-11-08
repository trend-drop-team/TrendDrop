"use client";

import { useCallback } from "react";

const STORAGE_KEY = "td-theme";

/**
 * 테마의 단일 진실 공급원은 <html data-theme>다.
 * (첫 페인트 전 layout.tsx의 인라인 스크립트가 localStorage 값을 그곳에 심는다.)
 *
 * 라벨은 컴포넌트 state가 아니라 CSS가 data-theme으로 고른다. 덕분에
 * 서버 렌더 결과가 테마와 무관해져 하이드레이션 불일치도, 라벨 깜빡임도 없다.
 */
export default function ThemeToggle() {
  const toggle = useCallback(() => {
    const root = document.documentElement;
    const next = root.dataset.theme === "warm" ? "dark" : "warm";
    root.dataset.theme = next;
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // 저장이 막혀 있어도(프라이빗 모드 등) 전환 자체는 동작해야 한다.
    }
  }, []);

  return (
    <button type="button" className="theme-toggle" onClick={toggle}>
      <span className="theme-toggle-opt theme-toggle-to-warm">
        <span className="theme-toggle-glyph" aria-hidden="true">
          <svg viewBox="0 0 24 24" focusable="false">
            <circle cx="12" cy="12" r="4.2" fill="currentColor" />
            <path
              d="M12 2.5v2.3M12 19.2v2.3M2.5 12h2.3M19.2 12h2.3M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </span>
        <span className="theme-toggle-label">웜톤</span><span className="sr-only"> 테마로 전환</span>
      </span>
      <span className="theme-toggle-opt theme-toggle-to-dark">
        <span className="theme-toggle-glyph" aria-hidden="true">
          <svg viewBox="0 0 24 24" focusable="false">
            <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" fill="currentColor" />
          </svg>
        </span>
        <span className="theme-toggle-label">다크</span><span className="sr-only"> 테마로 전환</span>
      </span>
    </button>
  );
}
