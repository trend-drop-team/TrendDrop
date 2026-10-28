"use client";

import { useRouter } from "next/navigation";
import type { MouseEvent } from "react";

/**
 * 히스토리 기반 뒤로가기.
 * SSR/첫 렌더는 항상 `<a href="/">`이고, 판단은 클릭 시점(핸들러)에서만 한다 — 하이드레이션 안전.
 * 같은 사이트에서 들어왔고 히스토리가 있으면 router.back(), 아니면(직접 진입·외부 referrer) href(홈)로 이동한다.
 */
export default function BackLink({ fallbackHref = "/" }: { fallbackHref?: string }) {
  const router = useRouter();

  function onClick(event: MouseEvent<HTMLAnchorElement>) {
    // 새 탭/창 열기 같은 수정 키 클릭은 브라우저 기본 동작에 맡긴다.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;

    let sameSite = false;
    try {
      sameSite = !!document.referrer && new URL(document.referrer).origin === window.location.origin;
    } catch {
      sameSite = false;
    }

    if (sameSite && window.history.length > 1) {
      event.preventDefault();
      router.back();
    }
  }

  return (
    <a href={fallbackHref} className="td-back" onClick={onClick}>
      ← 뒤로
    </a>
  );
}
