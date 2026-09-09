"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export const INTERESTS_KEY = "td-interests";
export const ONBOARDED_KEY = "td-onboarded";
/** 온보딩 완료 시 관심 카테고리를 실시간으로 랭킹 보드에 알린다. */
export const INTERESTS_EVENT = "td-interests-change";

const MAX_PICKS = 3;

type Props = {
  categories: string[];
};

export default function Onboarding({ categories }: Props) {
  // SSR 및 첫 클라이언트 렌더 = 닫힘(아무것도 안 그림) → 하이드레이션 안전.
  const [open, setOpen] = useState(false);
  const [picks, setPicks] = useState<string[]>([]);

  const dialogRef = useRef<HTMLDivElement | null>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);

  const options = categories.filter((name) => name !== "전체");

  /* 마운트 후에만 localStorage 확인 (렌더 중 접근 금지, setState는 rAF 콜백에서). */
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      try {
        if (!localStorage.getItem(ONBOARDED_KEY)) setOpen(true);
      } catch {
        // localStorage 불가 시 온보딩을 건너뛴다.
      }
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  const finish = useCallback(
    (interests: string[]) => {
      try {
        localStorage.setItem(ONBOARDED_KEY, "1");
        localStorage.setItem(INTERESTS_KEY, JSON.stringify(interests));
      } catch {
        // 저장 실패해도 오버레이는 닫는다.
      }
      window.dispatchEvent(new CustomEvent(INTERESTS_EVENT, { detail: interests }));
      setOpen(false);
    },
    [],
  );

  const close = useCallback(() => finish([]), [finish]);

  /* 배경 스크롤 잠금 + 포커스 이동/복귀 */
  useEffect(() => {
    if (!open) return;
    restoreFocus.current = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.querySelector<HTMLElement>("button, [tabindex]")?.focus();

    return () => {
      document.body.style.overflow = prevOverflow;
      restoreFocus.current?.focus?.();
    };
  }, [open]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== "Tab") return;
    const focusables = dialogRef.current?.querySelectorAll<HTMLElement>(
      "button:not([disabled]), [tabindex]:not([tabindex='-1'])",
    );
    if (!focusables || focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const togglePick = (name: string) => {
    setPicks((current) => {
      if (current.includes(name)) return current.filter((item) => item !== name);
      if (current.length >= MAX_PICKS) return current;
      return [...current, name];
    });
  };

  if (!open) return null;

  return (
    <div className="onb-overlay" onMouseDown={close}>
      <div
        className="onb-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="onb-title"
        ref={dialogRef}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <p className="onb-eyebrow">환영합니다</p>
        <h2 id="onb-title" className="onb-title">
          관심 카테고리를 골라주세요
        </h2>
        <p className="onb-sub">최대 {MAX_PICKS}개까지 선택하면 &lsquo;내 피드&rsquo;로 모아 볼 수 있어요.</p>

        <div className="onb-chips" role="group" aria-label="관심 카테고리">
          {options.map((name) => {
            const active = picks.includes(name);
            const disabled = !active && picks.length >= MAX_PICKS;
            return (
              <button
                key={name}
                type="button"
                className={`onb-chip${active ? " is-active" : ""}`}
                aria-pressed={active}
                disabled={disabled}
                onClick={() => togglePick(name)}
              >
                {name}
              </button>
            );
          })}
        </div>

        <div className="onb-actions">
          <button type="button" className="onb-later" onClick={close}>
            나중에
          </button>
          <button
            type="button"
            className="onb-start"
            onClick={() => finish(picks)}
            disabled={picks.length === 0}
          >
            시작하기
          </button>
        </div>
      </div>
    </div>
  );
}
