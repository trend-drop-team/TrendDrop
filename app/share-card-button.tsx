"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Props = {
  /** PNG를 받아올 경로. "/share-card" 또는 "/share-card?slug=..." */
  cardPath: string;
  /** 내려받을 때 쓸 파일 이름(확장자 제외). */
  fileName: string;
  title: string;
  text: string;
};

type Phase = "idle" | "busy" | "saved" | "failed";

const RESET_MS = 2600;

const LABEL: Record<Phase, string> = {
  idle: "카드",
  busy: "만드는 중",
  saved: "이미지 저장됨",
  failed: "만들기 실패",
};

function download(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // 클릭 직후 revoke하면 사파리에서 저장이 취소되는 경우가 있어 한 틱 뒤에 푼다.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * 정사각 공유 카드(1080×1080) 버튼.
 *
 * 서버가 그린 PNG를 blob으로 받아 OS 공유 시트에 파일로 넘긴다 — 인스타·카톡이
 * 그림 그대로 받는 경로다. 파일 공유를 지원하지 않는 브라우저(데스크톱 대부분)는
 * 내려받기로 떨어진다.
 */
export default function ShareCardButton({ cardPath, fileName, title, text }: Props) {
  const [phase, setPhase] = useState<Phase>("idle");
  const timer = useRef(0);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const settle = useCallback((next: Phase) => {
    setPhase(next);
    window.clearTimeout(timer.current);
    if (next !== "idle") timer.current = window.setTimeout(() => setPhase("idle"), RESET_MS);
  }, []);

  const run = useCallback(async () => {
    setPhase("busy");
    window.clearTimeout(timer.current);

    let file: File;
    try {
      const response = await fetch(cardPath);
      if (!response.ok) throw new Error(`card request failed: ${response.status}`);
      file = new File([await response.blob()], `${fileName}.png`, { type: "image/png" });
    } catch {
      settle("failed");
      return;
    }

    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title, text });
        settle("idle");
        return;
      } catch (error) {
        // 공유 시트를 그냥 닫은 것뿐이면 아무 일도 없었던 것처럼 둔다.
        if (error instanceof DOMException && error.name === "AbortError") {
          settle("idle");
          return;
        }
        // 그 밖의 실패는 내려받기로 떨어진다.
      }
    }

    try {
      download(file, file.name);
      settle("saved");
    } catch {
      settle("failed");
    }
  }, [cardPath, fileName, settle, text, title]);

  return (
    <button
      type="button"
      className="share-btn"
      data-phase={phase}
      disabled={phase === "busy"}
      onClick={run}
      aria-label={`${title} 공유 카드 이미지 만들기`}
    >
      <span className="share-btn-icon" aria-hidden="true">
        ▣
      </span>
      <span className="share-btn-label">{LABEL[phase]}</span>
      <span className="sr-only" role="status">
        {phase === "idle" ? "" : LABEL[phase]}
      </span>
    </button>
  );
}
