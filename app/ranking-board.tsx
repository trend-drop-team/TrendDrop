"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { CATEGORY_EVENT, PENDING_CATEGORY_KEY } from "@/app/command-palette";
import { INTERESTS_EVENT, INTERESTS_KEY } from "@/app/onboarding";
import RollingNumber from "@/app/rolling-number";
import ShareButton from "@/app/share-button";
import ShareCardButton from "@/app/share-card-button";
import { isStale, relativeTime } from "@/lib/utils/date";
import { getRankDelta } from "@/lib/utils/rank";
import type { TimelineSnapshot, TrendRow } from "@/types/api/trend";

type Period = "realtime" | "daily";

/** 실시간 스냅샷과 24시간 집계가 공유하는 행 형태 — 둘 다 API의 TrendRow다. */
type Row = TrendRow;

const RISING_BADGE_THRESHOLD = 85;

type Props = {
  /** 시점별 랭킹(오래된 → 최신). 타임머신 슬라이더의 눈금이자 실시간 탭의 데이터 소스. */
  snapshots: TimelineSnapshot[];
  daily: TrendRow[];
  categories: string[];
  /** 최신 run이 실제로 수집된 시각(ISO). 신선도 표시("마지막 수집 N분 전")에 쓴다. */
  latestCollectedAt: string | null;
};

/** 신선도 표시용 "지금" 갱신 주기 — 라벨이 화면에 고정되지 않도록 주기적으로 다시 계산한다. */
const NOW_TICK_MS = 30_000;

const PERIODS: { id: Period; label: string }[] = [
  { id: "realtime", label: "실시간" },
  { id: "daily", label: "24시간" },
];

const LIVE_INTERVAL_MS = 8000;
const PLAY_INTERVAL_MS = 1200;
const FLIP_MS = 520;
const FLIP_EASING = "cubic-bezier(0.34, 1.56, 0.64, 1)";
const PULL_THRESHOLD = 70;
const SAVED_KEY = "td-saved-keywords";
const PREVIEW_DELAY_MS = 250;
/** 관심 키워드 "급상승" 판정: NEW이거나 5계단 이상 상승. */
const SURGE_JUMP = 5;

function isSurge(item: Row): boolean {
  const delta = getRankDelta(item);
  return delta.kind === "new" || (delta.kind === "up" && delta.diff >= SURGE_JUMP);
}

// SSR에서는 useLayoutEffect가 경고를 내므로 서버에선 useEffect로 대체한다.
const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function growthValue(raw: string): number {
  const parsed = Number.parseInt(raw.replace(/[^0-9]/g, ""), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** 순위 변동 하이라이트 플래시 — 같은 클래스를 다시 넣어도 재생되도록 리플로우를 강제한다. */
function flash(element: HTMLElement, className: string) {
  element.classList.remove("is-flash-up", "is-flash-down", "is-flash-new");
  void element.offsetWidth;
  element.classList.add(className);
  element.addEventListener("animationend", () => element.classList.remove(className), {
    once: true,
  });
}

/**
 * 막대 마이크로 차트 — 얇은 실선은 작은 크기에서 노이즈로 읽히므로 막대로 표현한다.
 * 마지막 막대(=지금)만 불투명하게 두어 "현재 위치"가 한눈에 들어오게 하고,
 * 추세 방향(마지막 값 vs 첫 값)에 따라 상승/하락 색을 준다.
 */
function MiniSpark({ points }: { points: number[] }) {
  const width = 64;
  const height = 22;
  const gap = 2;
  const slots = 7; // 항상 7칸 — 이력이 짧은 신규 키워드도 막대 굵기가 달라지지 않게
  const barWidth = (width - gap * (slots - 1)) / slots;
  const minBar = 3.5; // 값이 낮아도 막대가 사라지지 않게 최소 높이 보장

  const values = points.slice(-slots);
  const padCount = slots - values.length; // 진입 전(이력 없음) 구간

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const rising = values.length > 1 ? values[values.length - 1] >= values[0] : true;

  return (
    <svg
      className={`rank-spark ${rising ? "is-up" : "is-down"}`}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
      focusable="false"
    >
      {Array.from({ length: slots }, (_, index) => {
        const isEmpty = index < padCount;
        const value = isEmpty ? min : values[index - padCount];
        const barHeight = isEmpty ? minBar : minBar + ((value - min) / range) * (height - minBar);
        const classes = `spark-bar${isEmpty ? " is-empty" : ""}${
          index === slots - 1 ? " is-now" : ""
        }`;

        return (
          <rect
            key={index}
            className={classes}
            x={index * (barWidth + gap)}
            y={height - barHeight}
            width={barWidth}
            height={barHeight}
            rx="1.2"
          />
        );
      })}
    </svg>
  );
}

function DeltaBadge({ item }: { item: Row }) {
  const delta = getRankDelta(item);

  if (delta.kind === "new") {
    return <span className="rank-delta is-new">NEW</span>;
  }
  if (delta.kind === "up") {
    return (
      <span className="rank-delta is-up">
        <span aria-hidden="true">▲</span>
        {delta.diff}
        <span className="sr-only">단계 상승</span>
      </span>
    );
  }
  if (delta.kind === "down") {
    return (
      <span className="rank-delta is-down">
        <span aria-hidden="true">▼</span>
        {delta.diff}
        <span className="sr-only">단계 하락</span>
      </span>
    );
  }
  return (
    <span className="rank-delta is-same">
      <span aria-hidden="true">−</span>
      <span className="sr-only">변동 없음</span>
    </span>
  );
}

export default function RankingBoard({ snapshots, daily, categories, latestCollectedAt }: Props) {
  const latestIndex = snapshots.length - 1;

  const [period, setPeriod] = useState<Period>("realtime");
  const [category, setCategory] = useState<string>("전체");
  const [snapshotIndex, setSnapshotIndex] = useState<number>(latestIndex);
  const [live, setLive] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [pull, setPull] = useState(0);
  // 서버 렌더 시점에 고정되지 않도록, 신선도 라벨이 참조하는 "지금"을 주기적으로 다시 잰다.
  const [now, setNow] = useState<Date | null>(null);
  // 마운트 후 localStorage에서 채워지는 값들 — SSR 초기값은 비어 있어 하이드레이션 안전.
  const [saved, setSaved] = useState<string[]>([]);
  const [interests, setInterests] = useState<string[]>([]);
  const [myFeed, setMyFeed] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);

  const containerRef = useRef<HTMLElement | null>(null);
  const rowRefs = useRef(new Map<string, HTMLLIElement>());
  const prevRects = useRef(new Map<string, DOMRect>());
  const isFirstLayout = useRef(true);
  const pullRef = useRef(0);
  const pendingScroll = useRef<string | null>(null);
  const hoverTimer = useRef<number | null>(null);

  const isRealtime = period === "realtime";
  const snapshot = snapshots[snapshotIndex];

  const rows: Row[] = isRealtime ? snapshot.rows : daily;

  // 마지막 수집이 실제로 언제였는지 — now가 아직 없으면(서버 렌더 직후) 표시를 비워 하이드레이션 불일치를 피한다.
  const collectedAt = latestCollectedAt ? new Date(latestCollectedAt) : null; // verify-ui-allow — 고정 ISO 문자열 파싱, 서버·클라 동일
  const freshnessLabel = collectedAt && now ? relativeTime(collectedAt, now) : null;
  const dataStale = collectedAt && now ? isStale(collectedAt, now) : false;

  // 프리뷰의 "왜 뜨나" 한 줄 — 행 자체에 reason이 비어 있을 때 24시간 집계 쪽 문구로 메운다.
  const reasonByKeyword = useMemo(
    () => new Map(daily.map((item) => [item.keyword, item.reason])),
    [daily],
  );
  const rowByKeyword = useMemo(() => new Map(rows.map((row) => [row.keyword, row])), [rows]);

  const activeInterests = useMemo(
    () => interests.filter((name) => categories.includes(name)),
    [interests, categories],
  );

  const visible = useMemo(() => {
    if (myFeed && activeInterests.length > 0) {
      return rows.filter((row) => activeInterests.includes(row.category));
    }
    return category === "전체" ? rows : rows.filter((row) => row.category === category);
  }, [rows, category, myFeed, activeInterests]);

  // 관심 키워드 칩용: 저장된 키워드 중 현재 데이터에 존재하는 것만
  const savedRows = useMemo(
    () => saved.map((keyword) => rowByKeyword.get(keyword)).filter((row): row is Row => Boolean(row)),
    [saved, rowByKeyword],
  );

  const tickerItems = useMemo(
    () => (isRealtime ? snapshot.ticker : []),
    [isRealtime, snapshot.ticker],
  );

  const summary = useMemo(() => {
    const newCount = visible.filter((row) => getRankDelta(row).kind === "new").length;
    const topGrowth = visible.reduce((max, row) => Math.max(max, growthValue(row.growth)), 0);
    return { tracked: visible.length, newCount, topGrowth };
  }, [visible]);

  const listKey = `${period}-${isRealtime ? snapshotIndex : "daily"}-${category}`;

  const advance = useCallback(() => {
    setSnapshotIndex((index) => (index + 1) % snapshots.length);
  }, [snapshots.length]);

  /* --- 신선도 라벨이 참조하는 "지금"을 주기적으로 다시 잰다 (마운트 후에만 — SSR과 다른 값이라 하이드레이션엔 비워 둔다) --- */
  useEffect(() => {
    const frame = requestAnimationFrame(() => setNow(new Date())); // verify-ui-allow — effect 콜백, 렌더 중 호출 아님
    const timer = window.setInterval(() => setNow(new Date()), NOW_TICK_MS); // verify-ui-allow — effect 콜백, 렌더 중 호출 아님
    return () => {
      cancelAnimationFrame(frame);
      window.clearInterval(timer);
    };
  }, []);

  /* --- LIVE 자동 갱신 (시간 진행은 오직 여기서만 일어난다) --- */
  /* 프리뷰가 열려 있는 동안(=행 호버 중)엔 자동 진행을 멈춘다 — 행이 밑으로 사라지며 프리뷰가 붕 뜨는 것 방지. */
  useEffect(() => {
    if (!live || !isRealtime || hovered !== null) return;
    const timer = window.setInterval(advance, LIVE_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [live, isRealtime, advance, hovered]);

  /* --- 타임랩스 재생: 현재 지점부터 1.2초 간격으로 진행, 최신에 닿으면 자동 정지 --- */
  useEffect(() => {
    if (!playing || !isRealtime) return;

    const timer = window.setTimeout(() => {
      const next = snapshotIndex + 1;
      setSnapshotIndex(Math.min(next, latestIndex));
      if (next >= latestIndex) setPlaying(false);
    }, PLAY_INTERVAL_MS);

    return () => window.clearTimeout(timer);
  }, [playing, isRealtime, snapshotIndex, latestIndex]);

  /* --- 커맨드 팔레트에서 고른 카테고리 수신 (useSearchParams 대신 커스텀 이벤트) --- */
  useEffect(() => {
    const onCategory = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail;
      if (typeof detail === "string" && categories.includes(detail)) setCategory(detail);
    };

    window.addEventListener(CATEGORY_EVENT, onCategory);
    return () => window.removeEventListener(CATEGORY_EVENT, onCategory);
  }, [categories]);

  /* --- 다른 페이지에서 넘어온 경우: 보관해 둔 카테고리를 마운트 후 적용 --- */
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      try {
        const pending = sessionStorage.getItem(PENDING_CATEGORY_KEY);
        if (!pending) return;
        sessionStorage.removeItem(PENDING_CATEGORY_KEY);
        if (categories.includes(pending)) setCategory(pending);
      } catch {
        // sessionStorage를 못 쓰면 필터 없이 그대로 둔다.
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [categories]);

  /* --- 마운트 후 저장된 관심 키워드 · 관심 카테고리 로드 (setState는 rAF 콜백에서) --- */
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      try {
        const rawSaved = localStorage.getItem(SAVED_KEY);
        const parsedSaved = rawSaved ? JSON.parse(rawSaved) : [];
        if (Array.isArray(parsedSaved)) {
          setSaved(parsedSaved.filter((item): item is string => typeof item === "string"));
        }
        const rawInterests = localStorage.getItem(INTERESTS_KEY);
        const parsedInterests = rawInterests ? JSON.parse(rawInterests) : [];
        if (Array.isArray(parsedInterests)) {
          setInterests(parsedInterests.filter((item): item is string => typeof item === "string"));
        }
      } catch {
        // 파싱/접근 실패 시 기본(빈) 상태 유지
      }
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  /* --- 온보딩 완료 시 관심 카테고리 반영 (핸들러 콜백에서 setState) --- */
  useEffect(() => {
    const onInterests = (event: Event) => {
      const detail = (event as CustomEvent<string[]>).detail;
      if (Array.isArray(detail)) {
        setInterests(detail.filter((item): item is string => typeof item === "string"));
      }
    };
    window.addEventListener(INTERESTS_EVENT, onInterests);
    return () => window.removeEventListener(INTERESTS_EVENT, onInterests);
  }, []);

  const toggleSave = useCallback((keyword: string) => {
    setSaved((current) => {
      const next = current.includes(keyword)
        ? current.filter((item) => item !== keyword)
        : [...current, keyword];
      try {
        localStorage.setItem(SAVED_KEY, JSON.stringify(next));
      } catch {
        // 저장 실패해도 화면 상태는 갱신
      }
      return next;
    });
  }, []);

  /* --- 호버 프리뷰: 250ms 지연 후 표시. 타임랩스 재생 중엔 억제. --- */
  const openPreview = useCallback(
    (keyword: string) => {
      if (playing) return;
      if (!window.matchMedia("(hover: hover)").matches) return;
      if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
      hoverTimer.current = window.setTimeout(() => setHovered(keyword), PREVIEW_DELAY_MS);
    },
    [playing],
  );

  const closePreview = useCallback(() => {
    if (hoverTimer.current) {
      window.clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
    setHovered(null);
  }, []);

  /* --- FLIP: 이전 위치 → 새 위치로 미끄러지듯 이동 --- */
  useIsomorphicLayoutEffect(() => {
    const nextRects = new Map<string, DOMRect>();
    rowRefs.current.forEach((element, key) => {
      nextRects.set(key, element.getBoundingClientRect());
    });

    if (isFirstLayout.current) {
      isFirstLayout.current = false;
      prevRects.current = nextRects;
      return;
    }

    if (!prefersReducedMotion()) {
      nextRects.forEach((rect, key) => {
        const element = rowRefs.current.get(key);
        if (!element) return;

        const previous = prevRects.current.get(key);

        // 새로 들어온 행: fade + slide-in
        if (!previous) {
          element.animate(
            [
              { opacity: 0, transform: "translateY(-10px)" },
              { opacity: 1, transform: "none" },
            ],
            { duration: 420, easing: "ease-out" },
          );
          flash(element, "is-flash-new");
          return;
        }

        // dy > 0 이면 화면상 위로 올라간 것(= 순위 상승)
        const dy = previous.top - rect.top;
        if (Math.abs(dy) > 1) {
          element.animate([{ transform: `translateY(${dy}px)` }, { transform: "none" }], {
            duration: FLIP_MS,
            easing: FLIP_EASING,
          });
          flash(element, dy > 0 ? "is-flash-up" : "is-flash-down");
        }
      });
    }

    prevRects.current = nextRects;
  }, [listKey]);

  /* --- 티커에서 필터에 가려진 키워드를 눌렀을 때, 필터 해제 후 스크롤 --- */
  useEffect(() => {
    const keyword = pendingScroll.current;
    if (!keyword) return;
    const element = rowRefs.current.get(keyword);
    if (!element) return;

    pendingScroll.current = null;
    element.scrollIntoView({
      behavior: prefersReducedMotion() ? "auto" : "smooth",
      block: "center",
    });
    flash(element, "is-flash-new");
  }, [listKey]);

  const scrollToKeyword = useCallback((keyword: string) => {
    const element = rowRefs.current.get(keyword);
    if (element) {
      element.scrollIntoView({
        behavior: prefersReducedMotion() ? "auto" : "smooth",
        block: "center",
      });
      flash(element, "is-flash-new");
      return;
    }
    // 카테고리 필터에 가려져 있으면 필터를 풀고 다음 렌더에서 스크롤한다.
    pendingScroll.current = keyword;
    setCategory("전체");
  }, []);

  /* --- 풀 투 리프레시 (터치 기기, 실시간 모드에서만) --- */
  useEffect(() => {
    if (!isRealtime) return;
    const element = containerRef.current;
    if (!element) return;

    let startY = 0;
    let pulling = false;

    const setPullValue = (value: number) => {
      pullRef.current = value;
      setPull(value);
    };

    const onStart = (event: TouchEvent) => {
      if (window.scrollY > 0) return;
      startY = event.touches[0].clientY;
      pulling = true;
    };

    const onMove = (event: TouchEvent) => {
      if (!pulling) return;
      const dy = event.touches[0].clientY - startY;

      if (dy <= 0 || window.scrollY > 0) {
        pulling = false;
        setPullValue(0);
        return;
      }

      // 임계치 전 약간의 여유(10px)까지는 브라우저 기본 스크롤을 방해하지 않는다.
      if (dy > 10) event.preventDefault();
      setPullValue(Math.min(dy * 0.5, PULL_THRESHOLD * 1.5));
    };

    const onEnd = () => {
      if (!pulling) return;
      pulling = false;
      if (pullRef.current >= PULL_THRESHOLD) advance();
      setPullValue(0);
    };

    element.addEventListener("touchstart", onStart, { passive: true });
    element.addEventListener("touchmove", onMove, { passive: false });
    element.addEventListener("touchend", onEnd);
    element.addEventListener("touchcancel", onEnd);

    return () => {
      element.removeEventListener("touchstart", onStart);
      element.removeEventListener("touchmove", onMove);
      element.removeEventListener("touchend", onEnd);
      element.removeEventListener("touchcancel", onEnd);
    };
  }, [isRealtime, advance]);

  const pullReady = pull >= PULL_THRESHOLD;
  // LIVE로 순환 중일 때는 "과거"가 아니라 실시간 피드로 본다.
  const viewingPast = isRealtime && !live && snapshotIndex !== latestIndex;

  /* --- 타임머신 ↔ LIVE 상호작용 규칙 --- */

  // 스크럽은 사용자 의도가 명확하므로 LIVE와 재생을 모두 끈다.
  const handleScrub = (event: React.ChangeEvent<HTMLInputElement>) => {
    setSnapshotIndex(Number(event.target.value));
    setLive(false);
    setPlaying(false);
  };

  // 재생은 "과거 재생", LIVE는 "실시간 갱신" — 동시에 켜지지 않는다.
  const handlePlayToggle = () => {
    if (playing) {
      setPlaying(false);
      return;
    }
    setLive(false);
    if (snapshotIndex >= latestIndex) setSnapshotIndex(0);
    setPlaying(true);
  };

  // LIVE를 켜면 최신 시점으로 돌아온다(과거를 보며 실시간이라 표시하지 않도록).
  const handleLiveToggle = () => {
    if (live) {
      setLive(false);
      return;
    }
    setPlaying(false);
    setSnapshotIndex(latestIndex);
    setLive(true);
  };

  const handleJumpToNow = () => {
    setPlaying(false);
    setSnapshotIndex(latestIndex);
    setLive(true);
  };

  const shareText = visible[0]
    ? `${visible[0].keyword} 지금 ${visible[0].rank}위 — TrendDrop 실시간 트렌드`
    : "지금 뜨는 실시간 트렌드";

  return (
    <section className="board" aria-labelledby="board-title" ref={containerRef}>
      {pull > 0 && (
        <div
          className={`pull-indicator${pullReady ? " is-ready" : ""}`}
          style={{ height: `${pull}px`, opacity: Math.min(1, pull / PULL_THRESHOLD) }}
          aria-hidden="true"
        >
          <span className="pull-icon">↻</span>
          {pullReady ? "놓으면 갱신" : "당겨서 갱신"}
        </div>
      )}

      <div className="board-header">
        <div className="board-title-row">
          <h1 id="board-title" className="board-title">
            실시간 트렌드
          </h1>

          <button
            type="button"
            className={`live-toggle${live && isRealtime ? " is-on" : ""}`}
            aria-pressed={live && isRealtime}
            onClick={handleLiveToggle}
            disabled={!isRealtime}
            title={isRealtime ? "자동 재생 켜기/끄기" : "24시간 집계는 자동 재생을 쓰지 않습니다"}
          >
            <span className="live-dot" aria-hidden="true" />
            자동 재생
          </button>

          <div className="share-actions">
            {/* 보고 있는 목록의 1위를 공유 문구에 넣어 "이거 봐봐"가 바로 되게 한다. */}
            <ShareButton path="/" title="TrendDrop 실시간 트렌드" text={shareText} />
            {/* 카드는 화면 필터와 무관하게 늘 전체 TOP5다 — 카드 제목이 그렇게 말한다. */}
            <ShareCardButton
              cardPath="/share-card"
              fileName="trenddrop-top5"
              title="TrendDrop 오늘의 트렌드 TOP 5"
              text={shareText}
            />
          </div>
        </div>

        <p className="board-updated">
          {isRealtime ? (
            <>
              <span className="board-clock">{snapshot.clock}</span>
              <span className="board-sep" aria-hidden="true">
                ·
              </span>
              {snapshot.label}
              <span className="board-sep" aria-hidden="true">
                ·
              </span>
              {freshnessLabel ? `마지막 수집 ${freshnessLabel}` : "수집 시각 확인 중"}
              <span className="board-sep" aria-hidden="true">
                ·
              </span>
              {playing ? "과거 재생 중" : live ? "자동 재생 중" : "일시정지"}
            </>
          ) : (
            <>
              24시간 누적 집계
              {freshnessLabel && (
                <>
                  <span className="board-sep" aria-hidden="true">
                    ·
                  </span>
                  {`마지막 수집 ${freshnessLabel}`}
                </>
              )}
            </>
          )}
        </p>

        {dataStale && (
          <p className="board-stale-warning" role="status">
            <span aria-hidden="true">⚠</span> 최신 데이터가 {freshnessLabel} 수집된 것이라, 지금과 다를 수
            있어요.
          </p>
        )}

        {isRealtime && live && (
          // key로 매 스냅샷마다 진행 바 애니메이션을 다시 시작시킨다.
          <div className="live-progress" key={snapshotIndex} aria-hidden="true">
            <span className="live-progress-fill" />
          </div>
        )}

        {viewingPast && (
          <div className="past-banner">
            <span className="past-badge">과거 보기 · {snapshot.label}</span>
            <button type="button" className="past-now" onClick={handleJumpToNow}>
              지금으로
            </button>
          </div>
        )}
      </div>

      {/* 타임머신 스크러버 — 실시간 모드에서만 */}
      {isRealtime && (
        <div className="timemachine">
          <div className="tm-row">
            <button
              type="button"
              className={`tm-play${playing ? " is-playing" : ""}`}
              onClick={handlePlayToggle}
              aria-pressed={playing}
              aria-label={playing ? "타임랩스 정지" : "타임랩스 재생"}
            >
              <span aria-hidden="true">{playing ? "⏸" : "▶"}</span>
            </button>

            <input
              type="range"
              className="tm-range"
              min={0}
              max={latestIndex}
              step={1}
              value={snapshotIndex}
              onChange={handleScrub}
              aria-label="시간 이동"
              aria-valuetext={`${snapshot.clock} · ${snapshot.label}`}
            />

            <span className="tm-label">
              <span className="tm-clock">{snapshot.clock}</span>
              <span className="tm-ago">{snapshot.label}</span>
            </span>
          </div>

          <div className="tm-ticks" aria-hidden="true">
            {snapshots.map((entry, index) => (
              <span
                key={entry.runId}
                className={`tm-tick${index === snapshotIndex ? " is-active" : ""}${
                  index === latestIndex ? " is-latest" : ""
                }`}
              />
            ))}
          </div>
        </div>
      )}

      {isRealtime && tickerItems.length > 0 && (
        <div className="ticker" aria-label="실시간 하이라이트">
          <div className="ticker-track">
            {[0, 1].map((copy) => (
              <div className="ticker-group" key={copy} aria-hidden={copy === 1 ? true : undefined}>
                {tickerItems.map((item) => (
                  <button
                    key={`${copy}-${item.keyword}`}
                    type="button"
                    className={`ticker-item${item.kind === "new" ? " is-new" : ""}`}
                    onClick={() => scrollToKeyword(item.keyword)}
                    tabIndex={copy === 1 ? -1 : undefined}
                  >
                    <span className="ticker-key">#{item.keyword}</span>
                    <span className="ticker-tag">
                      {item.kind === "new" ? "NEW" : `▲${item.delta}`}
                    </span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="board-summary">
        <div className="summary-cell">
          <RollingNumber value={summary.tracked} className="summary-value" />
          <span className="summary-label">추적 키워드</span>
        </div>
        <div className="summary-cell">
          <RollingNumber value={summary.newCount} className="summary-value is-new" />
          <span className="summary-label">신규 진입</span>
        </div>
        <div className="summary-cell">
          <RollingNumber
            value={summary.topGrowth}
            prefix="+"
            suffix="%"
            className="summary-value is-up"
          />
          <span className="summary-label">최고 상승률</span>
        </div>
      </div>

      {savedRows.length > 0 && (
        <div className="saved-section" aria-label="관심 키워드">
          <p className="saved-title">관심 키워드</p>
          <div className="saved-chips">
            {savedRows.map((row) => (
              <button
                key={row.keyword}
                type="button"
                className={`saved-chip${isSurge(row) ? " is-surge" : ""}`}
                onClick={() => scrollToKeyword(row.keyword)}
                title={`${row.keyword} · 현재 ${row.rank}위`}
              >
                <span className="saved-chip-name">{row.keyword}</span>
                <span className="saved-chip-rank">{row.rank}위</span>
                <DeltaBadge item={row} />
                {isSurge(row) && <span className="saved-surge">급상승</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="board-controls">
        <div className="period-toggle" role="group" aria-label="집계 기간">
          {PERIODS.map((option) => (
            <button
              key={option.id}
              type="button"
              className="period-button"
              aria-pressed={period === option.id}
              onClick={() => setPeriod(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="category-tabs" role="group" aria-label="카테고리 필터">
          {activeInterests.length > 0 && (
            <button
              type="button"
              className="category-tab is-feed"
              aria-pressed={myFeed}
              onClick={() => setMyFeed((value) => !value)}
              title={`내 피드 · ${activeInterests.join("·")}`}
            >
              ★ 내 피드
            </button>
          )}
          {categories.map((name) => (
            <button
              key={name}
              type="button"
              className="category-tab"
              aria-pressed={!myFeed && category === name}
              onClick={() => {
                setMyFeed(false);
                setCategory(name);
              }}
            >
              {name}
            </button>
          ))}
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="board-empty">선택한 카테고리에 해당하는 트렌드가 아직 없습니다.</p>
      ) : (
        <ol className="rank-list">
          {visible.map((item) => {
            const isSaved = saved.includes(item.keyword);
            const showPreview = hovered === item.keyword && !playing;
            return (
              <li
                key={item.keyword}
                className={`rank-row${showPreview ? " has-preview" : ""}`}
                ref={(element) => {
                  if (element) rowRefs.current.set(item.keyword, element);
                  else rowRefs.current.delete(item.keyword);
                }}
                onMouseEnter={() => openPreview(item.keyword)}
                onMouseLeave={closePreview}
              >
                <Link href={`/trend/${encodeURIComponent(item.slug)}`} className="rank-link">
                  <span className={`rank-num${item.rank <= 3 ? " is-top" : ""}`}>{item.rank}</span>

                  <span className="rank-main">
                    <span className="rank-keyword-row">
                      <span className="rank-keyword">{item.keyword}</span>
                      {item.risingScore >= RISING_BADGE_THRESHOLD && (
                        <span className="rank-rising-badge">급상승</span>
                      )}
                    </span>
                    <span className="rank-cat">{item.category}</span>
                  </span>

                  {item.spark.length > 0 ? <MiniSpark points={item.spark} /> : null}

                  <DeltaBadge item={item} />

                  <RollingNumber
                    value={growthValue(item.growth)}
                    prefix="+"
                    suffix="%"
                    className="rank-growth"
                  />
                </Link>

                <button
                  type="button"
                  className={`rank-star${isSaved ? " is-saved" : ""}`}
                  aria-pressed={isSaved}
                  aria-label={isSaved ? `${item.keyword} 관심 해제` : `${item.keyword} 관심 저장`}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    toggleSave(item.keyword);
                  }}
                >
                  <span aria-hidden="true">{isSaved ? "★" : "☆"}</span>
                </button>

                {showPreview && (
                  <div className="rank-preview" role="presentation">
                    <div className="rank-preview-head">
                      <span className="rank-preview-key">{item.keyword}</span>
                      <span className="rank-preview-cat">{item.category}</span>
                    </div>
                    <div className="rank-preview-metrics">
                      <span className="rank-preview-growth">+{growthValue(item.growth)}%</span>
                      {item.spark.length > 0 ? <MiniSpark points={item.spark} /> : null}
                    </div>
                    <p className="rank-preview-why">
                      {item.reason ||
                        reasonByKeyword.get(item.keyword) ||
                        "SNS에서 반응이 빠르게 늘고 있습니다."}
                    </p>
                    <span className="rank-preview-cta">상세 보기 →</span>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
