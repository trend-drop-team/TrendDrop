"use client";

import { useEffect, useRef } from "react";

import { ADSENSE_CLIENT, isAdsenseClientValid } from "@/lib/adsense";

import "./ad-slot.css";

declare global {
  interface Window {
    adsbygoogle?: unknown[];
  }
}

type Props = {
  /** AdSense 광고 단위 슬롯 ID. 비어 있으면 아무것도 렌더하지 않는다. */
  slot: string;
  /** <ol> 안에 넣을 때는 "li". */
  as?: "div" | "li";
};

/**
 * 광고 한 칸. 클라이언트 ID·슬롯이 없으면 null(레이아웃 변화 없음).
 * 보이는 여부는 layout이 body[data-ads]로 결정한다 — 프리뷰·로컬에서는 CSS가 숨겨 공간도 잡지 않는다.
 */
export default function AdSlot({ slot, as = "div" }: Props) {
  const configured = isAdsenseClientValid(ADSENSE_CLIENT) && slot !== "";
  const pushed = useRef(false);

  useEffect(() => {
    // 'on'(운영)일 때만 요청한다. 'preview'는 자리표시자만 보여 준다.
    if (!configured || pushed.current || document.body.dataset.ads !== "on") return;
    pushed.current = true;
    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    } catch {
      // 광고 차단기·스크립트 실패는 조용히 넘긴다 — 본문에 영향 없음.
    }
  }, [configured]);

  if (!configured) return null;

  const Tag = as;
  return (
    <Tag className="ad-slot">
      <span className="ad-slot-label">광고</span>
      <div className="ad-slot-box">
        <span className="ad-slot-placeholder" aria-hidden="true">광고 영역 (미리보기)</span>
        <ins
          className="adsbygoogle ad-slot-ins"
          data-ad-client={ADSENSE_CLIENT}
          data-ad-slot={slot}
          data-ad-format="auto"
          data-full-width-responsive="true"
        />
      </div>
    </Tag>
  );
}
