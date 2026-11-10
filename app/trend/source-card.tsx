"use client";

import { useState } from "react";

import type { KeywordRelatedContent } from "@/types/api/keyword";

/** 처음 보여 줄 근거 콘텐츠 개수. 나머지는 "더 보기"로 펼친다. */
const INITIAL_COUNT = 6;

function SourceCard({ item }: { item: KeywordRelatedContent }) {
  const [open, setOpen] = useState(false);
  const [thumbFailed, setThumbFailed] = useState(false);
  const excerpt = item.excerpt?.trim() ?? "";
  const showThumb = !!item.thumbnailUrl && !thumbFailed;

  return (
    <article className="td-source-card">
      <div className="td-source-head">
        {showThumb && (
          <div className="td-source-thumb">
            {/* 원격 도메인이 제각각이라 next/image 대신 일반 img를 쓴다. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={item.thumbnailUrl ?? undefined}
              alt=""
              loading="lazy"
              referrerPolicy="no-referrer"
              onError={() => setThumbFailed(true)}
            />
          </div>
        )}
        <div className="td-source-body">
          <p className="td-related-platform">
            {item.platform} · {item.kind}
          </p>
          <p className="td-related-title">{item.title}</p>
          <p className="td-related-metric">{item.metric}</p>
        </div>
      </div>

      {excerpt && <blockquote className={`td-source-excerpt${open ? " is-open" : ""}`}>“{excerpt}”</blockquote>}

      <div className="td-source-actions">
        {excerpt && (
          <button
            type="button"
            className="td-source-toggle"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? "접기" : "더 보기"}
          </button>
        )}
        <a className="td-source-link" href={item.url} target="_blank" rel="noopener noreferrer">
          원문 보기 ↗
        </a>
      </div>
    </article>
  );
}

/**
 * 근거 콘텐츠 목록. 정렬 기준: API가 내려주는 순서(수집 순) 그대로 — 응답에 게시 시각 필드가 없어
 * 화면에서 최신순을 만들 수 없다. 상위 6개만 먼저 보이고 나머지는 "더 보기"로 펼친다.
 */
export default function RelatedSources({ items }: { items: KeywordRelatedContent[] }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? items : items.slice(0, INITIAL_COUNT);
  const hidden = items.length - INITIAL_COUNT;

  return (
    <>
      <div className="td-source-grid">
        {visible.map((item, index) => (
          <SourceCard key={`${item.url}-${index}`} item={item} />
        ))}
      </div>
      {hidden > 0 && (
        <button
          type="button"
          className="td-source-more"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "접기" : `근거 콘텐츠 ${hidden}개 더 보기`}
        </button>
      )}
    </>
  );
}
