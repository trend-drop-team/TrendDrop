"use client";

import { useEffect, useState } from "react";

type Props = {
  text: string;
  /** 글자당 지연(ms) */
  speed?: number;
};

/**
 * AI 요약 타이핑 "느낌".
 * 하이드레이션 안전: useState 초기값 = 완성 텍스트라 SSR HTML과 첫 클라이언트 렌더가 동일하다.
 * 마운트 후 effect에서만 비우고 타이핑한다(렌더 중 시간/랜덤 계산 없음).
 * prefers-reduced-motion이면 타이핑 없이 완성형 그대로.
 */
export default function StreamingSummary({ text, speed = 12 }: Props) {
  const [shown, setShown] = useState(text);
  const [typing, setTyping] = useState(false);

  useEffect(() => {
    // 초기 상태가 이미 완성 텍스트이므로, 모션을 줄여야 하면 그대로 두고 나온다.
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return;

    let interval = 0;
    // 상태 갱신은 effect 본문이 아니라 rAF/interval 콜백에서만 일어난다.
    const raf = window.requestAnimationFrame(() => {
      setShown("");
      setTyping(true);
      let i = 0;
      interval = window.setInterval(() => {
        i += 1;
        setShown(text.slice(0, i));
        if (i >= text.length) {
          window.clearInterval(interval);
          setTyping(false);
        }
      }, speed);
    });

    return () => {
      window.cancelAnimationFrame(raf);
      if (interval) window.clearInterval(interval);
    };
  }, [text, speed]);

  return (
    <div className="td-ai">
      <div className="td-ai-head">
        <span className="td-ai-badge">AI 요약</span>
        {typing && (
          <span className="td-ai-status" aria-hidden="true">
            <span className="td-ai-status-dot" />
            생성 중…
          </span>
        )}
      </div>
      <p className="td-summary td-ai-text">
        <span aria-hidden={typing || undefined}>
          {shown}
          {typing && (
            <span className="td-ai-cursor" aria-hidden="true">
              ▍
            </span>
          )}
        </span>
        {/* 타이핑 중에도 스크린리더에는 완성 텍스트를 한 번 제공 */}
        {typing && <span className="sr-only">{text}</span>}
      </p>
    </div>
  );
}
