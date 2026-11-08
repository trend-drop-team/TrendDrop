"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { apiUrl } from "@/lib/api-url";
import type { ApiResult } from "@/types/api/common";
import type { CategoryRow } from "@/types/api/category";
import type { TrendRow } from "@/types/api/trend";

export type PaletteDoc = {
  slug: string;
  title: string;
  description: string;
};

/** 최신 run의 랭킹 키워드. 팔레트를 처음 열 때 백엔드 API에서 받아 온다. */
export type PaletteKeyword = {
  keyword: string;
  slug: string;
  category: string;
  rank: number;
};

type Props = {
  docs: PaletteDoc[];
};

type RemoteData = {
  categories: string[];
  keywords: PaletteKeyword[];
};

/** 백엔드 한 번 왕복에 허용할 최대 시간 — lib/api-client.ts의 서버 쪽 타임아웃과 맞춘다. */
const FETCH_TIMEOUT_MS = 8_000;

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(apiUrl(path), { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`API request failed: ${response.status} (${path})`);
  return response.json() as Promise<T>;
}

/**
 * 키워드·카테고리 검색 대상을 백엔드 API에서 받는다.
 * 레이아웃(모든 요청)에서 미리 받지 않고 팔레트를 처음 열 때만 부른다(#87) —
 * /docs처럼 데이터가 필요 없는 페이지가 매 요청 DB를 치지 않게.
 * 하나가 실패해도 다른 쪽은 살리고, 실패한 쪽은 빈 목록으로 둔다.
 */
async function loadPaletteData(): Promise<RemoteData> {
  const [categoryResult, trendResult] = await Promise.allSettled([
    fetchJson<ApiResult<CategoryRow[]>>("/api/categories"),
    fetchJson<ApiResult<TrendRow[]>>("/api/trends"),
  ]);

  if (categoryResult.status === "rejected" && trendResult.status === "rejected") {
    throw categoryResult.reason;
  }

  return {
    categories:
      categoryResult.status === "fulfilled" ? categoryResult.value.data.map((category) => category.name) : [],
    keywords:
      trendResult.status === "fulfilled"
        ? trendResult.value.data.map((row) => ({
            keyword: row.keyword,
            slug: row.slug,
            category: row.category,
            rank: row.rank,
          }))
        : [],
  };
}

type Result =
  | { kind: "keyword"; id: string; label: string; category: string; rank: number; slug: string }
  | { kind: "category"; id: string; label: string }
  | { kind: "doc"; id: string; label: string; description: string; slug: string };

const GROUP_LABEL: Record<Result["kind"], string> = {
  keyword: "트렌드 키워드",
  category: "카테고리",
  doc: "문서",
};

/** 다른 페이지에서 카테고리를 고르면 "/"로 이동한 뒤 적용해야 해서 잠깐 보관한다. */
export const PENDING_CATEGORY_KEY = "td-pending-category";
export const CATEGORY_EVENT = "td-category";
export const COMMAND_OPEN_EVENT = "td-command-open";

const EMPTY_KEYWORD_SUGGESTIONS = 5;
const MAX_KEYWORD_RESULTS = 8;

function optionId(index: number): string {
  return `cmdk-option-${index}`;
}

const EMPTY_CATEGORIES: string[] = [];
const EMPTY_KEYWORDS: PaletteKeyword[] = [];

export default function CommandPalette({ docs }: Props) {
  const router = useRouter();
  const pathname = usePathname() ?? "/";

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [remote, setRemote] = useState<RemoteData | null>(null);
  const [loading, setLoading] = useState(false);
  // 중복 요청 방지용 — 렌더에 쓰지 않으므로 ref로 둔다.
  const requestedRef = useRef(false);

  const categories = remote?.categories ?? EMPTY_CATEGORIES;
  const rankedKeywords = remote?.keywords ?? EMPTY_KEYWORDS;

  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  const results = useMemo<Result[]>(() => {
    const q = query.trim().toLowerCase();
    const matches = (value: string) => value.toLowerCase().includes(q);

    const keywords = rankedKeywords
      .filter((item) => !q || matches(item.keyword) || matches(item.category))
      .slice(0, q ? MAX_KEYWORD_RESULTS : EMPTY_KEYWORD_SUGGESTIONS)
      .map<Result>((item) => ({
        kind: "keyword",
        id: `keyword-${item.slug}`,
        label: item.keyword,
        category: item.category,
        rank: item.rank,
        slug: item.slug,
      }));

    const cats = categories
      .filter((name) => name !== "전체")
      .filter((name) => !q || matches(name))
      .map<Result>((name) => ({ kind: "category", id: `category-${name}`, label: name }));

    const documents = docs
      .filter((doc) => !q || matches(doc.title) || matches(doc.description))
      .map<Result>((doc) => ({
        kind: "doc",
        id: `doc-${doc.slug}`,
        label: doc.title,
        description: doc.description,
        slug: doc.slug,
      }));

    return [...keywords, ...cats, ...documents];
  }, [query, categories, docs, rankedKeywords]);

  // 결과가 줄어들어도 인덱스가 범위를 벗어나지 않도록 파생값으로 고정한다(효과에서 보정하지 않음).
  const active = results.length === 0 ? 0 : Math.min(activeIndex, results.length - 1);

  const close = useCallback(() => setOpen(false), []);

  // 이벤트 핸들러(⌘K·검색 버튼)에서만 불린다 — effect 안에서 setState하지 않는다.
  const ensureData = useCallback(() => {
    if (requestedRef.current) return;
    requestedRef.current = true;
    setLoading(true);

    loadPaletteData()
      .then((data) => setRemote(data))
      .catch((error: unknown) => {
        console.error("[command-palette] 검색 데이터를 불러오지 못했습니다:", error);
        // 다음에 열 때 다시 시도한다. 그동안은 문서 검색만 동작한다.
        requestedRef.current = false;
      })
      .finally(() => setLoading(false));
  }, []);

  const openPalette = useCallback(() => {
    setQuery("");
    setActiveIndex(0);
    setOpen(true);
    ensureData();
  }, [ensureData]);

  /* --- 여는 방법: ⌘K / Ctrl+K, 그리고 헤더 검색 버튼(커스텀 이벤트) --- */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (open) close();
        else openPalette();
      }
    };
    const onOpenRequest = () => openPalette();

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener(COMMAND_OPEN_EVENT, onOpenRequest);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener(COMMAND_OPEN_EVENT, onOpenRequest);
    };
  }, [open, close, openPalette]);

  /* --- 열릴 때: 입력 포커스 + 배경 스크롤 잠금, 닫힐 때 이전 포커스 복귀 --- */
  useEffect(() => {
    if (!open) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    inputRef.current?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus?.();
    };
  }, [open]);

  /* --- 선택 항목이 보이도록 스크롤 추적 --- */
  useEffect(() => {
    if (!open) return;
    const element = listRef.current?.querySelector(`#${optionId(active)}`);
    element?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const select = useCallback(
    (result: Result | undefined) => {
      if (!result) return;
      close();

      if (result.kind === "keyword") {
        router.push(`/trend/${encodeURIComponent(result.slug)}`);
        return;
      }
      if (result.kind === "doc") {
        router.push(`/docs/${result.slug}`);
        return;
      }

      // 카테고리: useSearchParams 대신 커스텀 이벤트로 랭킹 보드에 전달한다.
      if (pathname === "/") {
        window.dispatchEvent(new CustomEvent(CATEGORY_EVENT, { detail: result.label }));
      } else {
        try {
          sessionStorage.setItem(PENDING_CATEGORY_KEY, result.label);
        } catch {
          // 저장이 막혀 있으면 필터 없이 랭킹으로만 이동한다.
        }
        router.push("/");
      }
    },
    [close, pathname, router],
  );

  const onInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    const count = results.length;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (count > 0) setActiveIndex((index) => (Math.min(index, count - 1) + 1) % count);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (count > 0) setActiveIndex((index) => (Math.min(index, count - 1) - 1 + count) % count);
    } else if (event.key === "Enter") {
      event.preventDefault();
      select(results[active]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  };

  /* --- 포커스 트랩: 입력과 닫기 버튼 사이만 순환 --- */
  const onDialogKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab") return;
    event.preventDefault();
    if (document.activeElement === inputRef.current) closeRef.current?.focus();
    else inputRef.current?.focus();
  };

  if (!open) return null;

  let lastKind: Result["kind"] | null = null;

  return (
    <div className="cmdk-overlay" onMouseDown={close}>
      <div
        className="cmdk-panel"
        role="dialog"
        aria-modal="true"
        aria-label="검색 및 바로가기"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={onDialogKeyDown}
      >
        <div className="cmdk-input-row">
          <span className="cmdk-input-icon" aria-hidden="true">
            ⌕
          </span>
          <input
            ref={inputRef}
            className="cmdk-input"
            type="text"
            value={query}
            placeholder="키워드, 카테고리, 문서 검색"
            aria-label="검색어"
            aria-controls="cmdk-list"
            aria-activedescendant={results.length > 0 ? optionId(active) : undefined}
            autoComplete="off"
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={onInputKeyDown}
          />
          <button ref={closeRef} type="button" className="cmdk-close" onClick={close}>
            Esc
          </button>
        </div>

        {results.length === 0 ? (
          <p className="cmdk-empty">{loading ? "검색 목록을 불러오는 중입니다…" : "일치하는 결과가 없습니다."}</p>
        ) : (
          <ul className="cmdk-list" id="cmdk-list" role="listbox" aria-label="검색 결과" ref={listRef}>
            {results.map((result, index) => {
              const showGroup = result.kind !== lastKind;
              lastKind = result.kind;

              return (
                <li key={result.id} className="cmdk-item-wrap">
                  {showGroup && (
                    <p className="cmdk-group" aria-hidden="true">
                      {GROUP_LABEL[result.kind]}
                    </p>
                  )}
                  <div
                    id={optionId(index)}
                    role="option"
                    aria-selected={index === active}
                    className={`cmdk-item${index === active ? " is-active" : ""}`}
                    onMouseMove={() => setActiveIndex(index)}
                    onClick={() => select(result)}
                  >
                    {result.kind === "keyword" && (
                      <>
                        <span className="cmdk-rank">{result.rank}</span>
                        <span className="cmdk-label">{result.label}</span>
                        <span className="cmdk-meta">{result.category}</span>
                      </>
                    )}
                    {result.kind === "category" && (
                      <>
                        <span className="cmdk-icon" aria-hidden="true">
                          #
                        </span>
                        <span className="cmdk-label">{result.label}</span>
                        <span className="cmdk-meta">필터</span>
                      </>
                    )}
                    {result.kind === "doc" && (
                      <>
                        <span className="cmdk-icon" aria-hidden="true">
                          ▤
                        </span>
                        <span className="cmdk-label">{result.label}</span>
                        <span className="cmdk-meta">문서</span>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <div className="cmdk-footer">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> 이동
          </span>
          <span>
            <kbd>Enter</kbd> 선택
          </span>
          <span>
            <kbd>Esc</kbd> 닫기
          </span>
        </div>
      </div>
    </div>
  );
}
