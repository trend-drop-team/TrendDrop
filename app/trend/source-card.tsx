"use client";

import { useState } from "react";

type Props = {
  platform: string;
  kind: string;
  title: string;
  metric: string;
  excerpt: string;
  url: string;
  glyph: string;
  thumbClass: string;
};

/** 출처 카드 — 원문 발췌를 접기/펼치기하는 마이크로 인터랙션. */
export default function SourceCard({
  platform,
  kind,
  title,
  metric,
  excerpt,
  url,
  glyph,
  thumbClass,
}: Props) {
  const [open, setOpen] = useState(false);

  return (
    <article className="td-source-card">
      <div className="td-source-head">
        <div className={`td-thumb ${thumbClass}`}>
          <span>{glyph}</span>
        </div>
        <div className="td-source-body">
          <p className="td-related-platform">
            {platform} · {kind}
          </p>
          <p className="td-related-title">{title}</p>
          <p className="td-related-metric">{metric}</p>
        </div>
      </div>

      <blockquote className={`td-source-excerpt${open ? " is-open" : ""}`}>“{excerpt}”</blockquote>

      <div className="td-source-actions">
        <button
          type="button"
          className="td-source-toggle"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? "접기" : "더 보기"}
        </button>
        <a className="td-source-link" href={url} target="_blank" rel="noopener noreferrer">
          원문 보기 ↗
        </a>
      </div>
    </article>
  );
}
