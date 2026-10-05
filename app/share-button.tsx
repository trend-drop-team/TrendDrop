"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Props = {
  /** 공유할 경로("/trend/foo"). 절대 주소는 클릭 시점의 origin으로 만든다. */
  path: string;
  /** OS 공유 시트에 넘길 제목/본문. */
  title: string;
  text: string;
  label?: string;
};

type Phase = "idle" | "copied" | "failed";

const RESET_MS = 2200;

/**
 * 안전하지 않은 컨텍스트(http로 연 LAN 주소 등)에는 navigator.clipboard가 아예 없다.
 * 팀이 폰으로 로컬 주소를 열어 볼 때 곧바로 "복사 실패"가 되지 않도록 구형 경로를 남긴다.
 */
function legacyCopy(text: string): boolean {
  const field = document.createElement("textarea");
  field.value = text;
  field.setAttribute("readonly", "");
  field.style.position = "fixed";
  field.style.opacity = "0";
  document.body.appendChild(field);
  field.select();

  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    field.remove();
  }
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return legacyCopy(text);
  }
}

const MESSAGE: Record<Phase, string | null> = {
  idle: null,
  copied: "링크 복사됨",
  failed: "복사 실패",
};

/**
 * 트렌드 공유 버튼.
 *
 * 모바일은 navigator.share로 OS 공유 시트를 띄운다(카톡·인스타가 여기 뜬다).
 * 데스크톱 브라우저 대부분은 share를 지원하지 않으므로 링크 복사로 떨어진다.
 *
 * 주소를 props로 받지 않고 클릭할 때 window.location.origin에서 만드는 이유:
 * 빌드 때 박은 env가 실제 배포 도메인과 어긋나도 사용자가 보고 있는 주소가 나가야 한다.
 */
export default function ShareButton({ path, title, text, label = "공유" }: Props) {
  const [phase, setPhase] = useState<Phase>("idle");
  const timer = useRef(0);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const flash = useCallback((next: Phase) => {
    setPhase(next);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setPhase("idle"), RESET_MS);
  }, []);

  const share = useCallback(async () => {
    const url = new URL(path, window.location.origin).toString();

    if (navigator.share) {
      try {
        await navigator.share({ title, text, url });
        return;
      } catch (error) {
        // 공유 시트를 그냥 닫은 것뿐이면 아무 일도 없었던 것처럼 둔다.
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }

    flash((await copyToClipboard(url)) ? "copied" : "failed");
  }, [flash, path, text, title]);

  const message = MESSAGE[phase];

  return (
    <button
      type="button"
      className="share-btn"
      data-phase={phase}
      onClick={share}
      aria-label={`${title} 공유하기`}
    >
      <span className="share-btn-icon" aria-hidden="true">
        ↗
      </span>
      <span className="share-btn-label">{message ?? label}</span>
      {/* 라벨이 아이콘뿐인 화면에서도 결과가 읽히도록 상태를 따로 알린다. */}
      <span className="sr-only" role="status">
        {message ?? ""}
      </span>
    </button>
  );
}
