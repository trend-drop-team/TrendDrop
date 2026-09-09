"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  value: number;
  prefix?: string;
  suffix?: string;
  duration?: number;
  className?: string;
};

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/**
 * 값이 바뀌면 이전 값에서 새 값으로 굴러 올라가는 카운터.
 * - requestAnimationFrame만 사용(외부 라이브러리 없음).
 * - 첫 렌더는 항상 `value` 그대로라 서버/클라이언트 출력이 같다(하이드레이션 안전).
 * - 폭이 흔들리지 않도록 tabular-nums는 CSS(.rolling-number)에서 건다.
 */
export default function RollingNumber({
  value,
  prefix = "",
  suffix = "",
  duration = 600,
  className,
}: Props) {
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(value);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    const from = fromRef.current;
    const to = value;

    if (from === to) return;

    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // 모션을 줄여야 하면 duration 0으로 첫 프레임에 바로 도착시킨다.
    // (효과 본문에서 동기적으로 setState 하지 않기 위해 rAF는 항상 거친다.)
    const totalMs = reduced ? 0 : duration;
    let startTs: number | null = null;

    const step = (ts: number) => {
      if (startTs === null) startTs = ts;
      const elapsed = ts - startTs;
      const progress = totalMs <= 0 ? 1 : Math.min(1, elapsed / totalMs);
      const eased = easeOutCubic(progress);

      setDisplay(Math.round(from + (to - from) * eased));

      if (progress < 1) {
        frameRef.current = requestAnimationFrame(step);
      } else {
        fromRef.current = to;
        frameRef.current = null;
      }
    };

    frameRef.current = requestAnimationFrame(step);

    return () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      // 중간에 끊겨도 다음 애니메이션은 목표값에서 출발하도록 맞춰 둔다.
      fromRef.current = to;
    };
  }, [value, duration]);

  return (
    <span className={className ? `rolling-number ${className}` : "rolling-number"}>
      {prefix}
      {display}
      {suffix}
    </span>
  );
}
