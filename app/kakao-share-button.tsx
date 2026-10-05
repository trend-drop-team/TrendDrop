"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Props = {
  path: string;
  title: string;
  text: string;
  label?: string;
};

type KakaoSdk = {
  init: (key: string) => void;
  isInitialized?: () => boolean;
  Share?: {
    sendDefault: (payload: unknown) => void;
  };
};

declare global {
  interface Window {
    Kakao?: KakaoSdk;
  }
}

type Phase = "idle" | "shared" | "failed";
const RESET_MS = 2200;

const MESSAGE: Record<Phase, string | null> = {
  idle: null,
  shared: "공유창 열림",
  failed: "공유 실패",
};

function getKakao(): KakaoSdk | null {
  const kakao = window.Kakao;
  const key = process.env.NEXT_PUBLIC_KAKAO_JS_KEY;

  if (!kakao || !key) return null;
  if (!kakao.isInitialized?.()) kakao.init(key);
  return kakao;
}

export default function KakaoShareButton({ path, title, text, label = "카카오톡" }: Props) {
  const [phase, setPhase] = useState<Phase>("idle");
  const timer = useRef(0);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const flash = useCallback((next: Phase) => {
    setPhase(next);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setPhase("idle"), RESET_MS);
  }, []);

  const share = useCallback(() => {
    const kakao = getKakao();
    if (!kakao?.Share) {
      flash("failed");
      return;
    }

    const url = new URL(path, window.location.origin).toString();
    const imageUrl = new URL("/opengraph-image", window.location.origin).toString();

    try {
      kakao.Share.sendDefault({
        objectType: "feed",
        content: {
          title,
          description: text,
          imageUrl,
          link: { mobileWebUrl: url, webUrl: url },
        },
        buttons: [{ title: "TrendDrop에서 보기", link: { mobileWebUrl: url, webUrl: url } }],
      });
      flash("shared");
    } catch {
      flash("failed");
    }
  }, [flash, path, text, title]);

  const message = MESSAGE[phase];

  return (
    <button
      type="button"
      className="share-btn kakao-share-btn"
      data-phase={phase}
      onClick={share}
      aria-label={`${title} 카카오톡으로 공유하기`}
    >
      <span className="share-btn-icon" aria-hidden="true">K</span>
      <span className="share-btn-label">{message ?? label}</span>
      <span className="sr-only" role="status">{message ?? ""}</span>
    </button>
  );
}
