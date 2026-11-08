"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { ONBOARDED_KEY } from "./onboarding";
import "./install-prompt.css";

const VISITS_KEY = "td-visits";
const DISMISSED_KEY = "td-install-dismissed"; // 다시 안 봄 = "never", 나중에 = 눌렀던 시각(ms)
const SESSION_KEY = "td-visit-counted";
/** ranking-board가 관심 키워드를 새로 저장할 때 보내는 이벤트. */
const SAVED_EVENT = "td-keyword-saved";
const SNOOZE_MS = 14 * 24 * 60 * 60 * 1000;

type Platform = "ios" | "android" | "kakao" | "none";

/** 크롬이 넘겨주는 설치 프롬프트 이벤트(표준 타입에 없다). */
type InstallEvent = Event & {
  prompt: () => Promise<void>;
  userChoice?: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function isIosUa(ua: string): boolean {
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

function detectPlatform(): Platform {
  const ua = navigator.userAgent;
  const ios = isIosUa(ua);
  if (!ios && !/Android/.test(ua)) return "none";
  if (/KAKAOTALK/i.test(ua)) return "kakao";
  // 그 밖의 인앱 브라우저·타사 iOS 브라우저는 안내 대상에서 뺀다.
  if (/FBAN|FBAV|Instagram|NAVER|Line\/|DaumApps|; wv\)/i.test(ua)) return "none";
  if (ios) return /CriOS|FxiOS|EdgiOS|OPiOS|GSA\//.test(ua) ? "none" : "ios";
  return "android";
}

function isInstalled(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia("(display-mode: standalone)").matches || nav.standalone === true;
}

function isBlockedByDismissal(): boolean {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    if (!raw) return false;
    if (raw === "never") return true;
    const at = Number(raw);
    return Number.isFinite(at) && Date.now() - at < SNOOZE_MS;
  } catch {
    return false;
  }
}

/** 이 세션을 방문 1회로 센다(sessionStorage로 새로고침 중복 방지). */
function countVisit(): number {
  try {
    const prev = Number(localStorage.getItem(VISITS_KEY)) || 0;
    if (sessionStorage.getItem(SESSION_KEY)) return prev;
    sessionStorage.setItem(SESSION_KEY, "1");
    localStorage.setItem(VISITS_KEY, String(prev + 1));
    return prev + 1;
  } catch {
    return 0;
  }
}

function isOnboarded(): boolean {
  try {
    return Boolean(localStorage.getItem(ONBOARDED_KEY));
  } catch {
    return false;
  }
}

function ShareIcon() {
  return (
    <svg
      className="ip-share-icon"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 15V3" />
      <path d="M8 7l4-4 4 4" />
      <path d="M5 11v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8" />
    </svg>
  );
}

export default function InstallPrompt() {
  // SSR·첫 클라이언트 렌더는 아무것도 그리지 않는다 → 하이드레이션 안전.
  const [platform, setPlatform] = useState<Platform>("none");
  const [kakaoBrowser, setKakaoBrowser] = useState("Chrome");
  const [eligible, setEligible] = useState(false);
  const [hasEvent, setHasEvent] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const deferred = useRef<InstallEvent | null>(null);

  useEffect(() => {
    let alive = true;
    let removeSaved: (() => void) | null = null;

    const frame = requestAnimationFrame(() => {
      if (!alive) return;
      try {
        if (isInstalled()) return;
        const detected = detectPlatform();
        if (detected === "none") return;
        const visits = countVisit();
        setPlatform(detected);
        setKakaoBrowser(isIosUa(navigator.userAgent) ? "Safari" : "Chrome");
        setReduceMotion(window.matchMedia("(prefers-reduced-motion: reduce)").matches);

        // 두 번째 방문부터. 온보딩이 열려 있을 수 있는 첫 방문에는 띄우지 않는다.
        if (visits >= 2 && isOnboarded() && !isBlockedByDismissal()) setEligible(true);

        const onSaved = () => {
          if (isInstalled() || !isOnboarded() || isBlockedByDismissal()) return;
          setEligible(true);
        };
        window.addEventListener(SAVED_EVENT, onSaved);
        removeSaved = () => window.removeEventListener(SAVED_EVENT, onSaved);
      } catch {
        // 저장소·matchMedia 접근 실패 시 안내하지 않는다.
      }
    });

    // 이 이벤트는 마운트 직후 일찍 올 수 있어 rAF를 기다리지 않고 바로 붙인다.
    const onBefore = (event: Event) => {
      event.preventDefault();
      deferred.current = event as InstallEvent;
      setHasEvent(true);
    };
    const onInstalled = () => {
      deferred.current = null;
      setHasEvent(false);
      setEligible(false);
    };
    window.addEventListener("beforeinstallprompt", onBefore);
    window.addEventListener("appinstalled", onInstalled);

    return () => {
      alive = false;
      cancelAnimationFrame(frame);
      removeSaved?.();
      window.removeEventListener("beforeinstallprompt", onBefore);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const remember = useCallback((value: string) => {
    try {
      localStorage.setItem(DISMISSED_KEY, value);
    } catch {
      // 저장 실패해도 카드는 닫는다.
    }
    setEligible(false);
  }, []);

  const later = useCallback(() => remember(String(Date.now())), [remember]);
  const never = useCallback(() => remember("never"), [remember]);

  const install = useCallback(async () => {
    const event = deferred.current;
    if (!event) return;
    deferred.current = null;
    setHasEvent(false);
    try {
      await event.prompt();
      const choice = await event.userChoice;
      if (choice?.outcome === "dismissed") later();
      else setEligible(false);
    } catch {
      later();
    }
  }, [later]);

  const visible =
    eligible && (platform === "ios" || platform === "kakao" || (platform === "android" && hasEvent));
  if (!visible) return null;

  return (
    <section
      className={`ip-sheet${reduceMotion ? "" : " ip-sheet-motion"}`}
      aria-labelledby="ip-title"
    >
      {platform === "kakao" ? (
        <>
          <h2 id="ip-title" className="ip-title">
            {kakaoBrowser}에서 열어야 설치할 수 있어요
          </h2>
          <p className="ip-sub">
            카카오톡 안에서 보는 화면은 홈 화면에 추가할 수 없어요. 메뉴의 &lsquo;다른 브라우저로 열기&rsquo;로 {kakaoBrowser}에서 다시 열어 주세요.
          </p>
        </>
      ) : (
        <>
          <h2 id="ip-title" className="ip-title">
            홈 화면에 추가하면 앱처럼 열려요
          </h2>
          <p className="ip-sub">주소창 없이 바로 열리고, 더 빠르게 다시 열 수 있어요.</p>
        </>
      )}

      {platform === "ios" && (
        <ol className="ip-steps">
          <li className="ip-step">
            <span className="ip-step-num" aria-hidden="true">1</span>
            <span>
              Safari의 공유 버튼 <ShareIcon />
              <span className="sr-only">(네모에서 화살표가 나오는 아이콘)</span>을 눌러요
            </span>
          </li>
          <li className="ip-step">
            <span className="ip-step-num" aria-hidden="true">2</span>
            <span>메뉴에서 &lsquo;홈 화면에 추가&rsquo;를 골라요</span>
          </li>
        </ol>
      )}

      <div className="ip-actions">
        <button type="button" className="ip-never" onClick={never}>
          다시 보지 않기
        </button>
        <button type="button" className="ip-later" onClick={later}>
          나중에
        </button>
        {platform === "android" && (
          <button type="button" className="ip-install" onClick={install}>
            설치
          </button>
        )}
      </div>
    </section>
  );
}
