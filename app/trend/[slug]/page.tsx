import Link from "next/link";
import { notFound } from "next/navigation";

import { NotFoundError } from "@/server/http/errors";
import { getKeywordDetail } from "@/server/services/keyword.service";
import type { KeywordDetail } from "@/types/api/keyword";

import SourceCard from "../source-card";
import StreamingSummary from "../streaming-summary";
import "../trend.css";

export const dynamic = "force-dynamic";

function platformGlyph(platform: string): string {
  switch (platform) {
    case "Instagram":
      return "IG";
    case "YouTube":
      return "▶";
    case "Facebook":
      return "f";
    default:
      return platform.slice(0, 2).toUpperCase();
  }
}

function platformClass(platform: string): string {
  return `td-thumb-${platform.toLowerCase()}`;
}

function Spark({ series, days }: { series: number[]; days: string[] }) {
  const width = 320;
  const height = 120;
  const padX = 10;
  const padY = 14;
  const max = 100;
  const min = 0;
  const stepX = series.length > 1 ? (width - padX * 2) / (series.length - 1) : 0;

  const yFor = (value: number) => padY + (height - padY * 2) * (1 - (value - min) / (max - min));

  const points = series.map((value, index) => ({
    x: padX + index * stepX,
    y: yFor(value),
  }));

  const linePath = points
    .map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(1)},${point.y.toFixed(1)}`)
    .join(" ");

  const floor = (height - padY).toFixed(1);
  const areaPath =
    points.length > 0
      ? `${linePath} L${points[points.length - 1].x.toFixed(1)},${floor} L${points[0].x.toFixed(1)},${floor} Z`
      : "";

  const gridValues = [75, 50, 25];
  const axisValues = [100, 50, 0];
  const last = points[points.length - 1] as { x: number; y: number } | undefined;

  return (
    <div className="td-spark">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="td-spark-svg"
        role="img"
        aria-label="최근 수집 시점별 트렌드 점수 추이 차트"
      >
        {gridValues.map((value) => (
          <line
            key={value}
            x1={padX}
            x2={width - padX}
            y1={yFor(value)}
            y2={yFor(value)}
            className="td-spark-grid"
          />
        ))}
        {axisValues.map((value) => (
          <text key={value} x={width - padX} y={yFor(value) - 3} className="td-spark-axis" textAnchor="end">
            {value}
          </text>
        ))}
        {areaPath && <path d={areaPath} className="td-spark-area" />}
        <path d={linePath} className="td-spark-line" />
        {last && <circle cx={last.x} cy={last.y} r={4} className="td-spark-dot" />}
      </svg>
      <div className="td-spark-days">
        {days.map((day, index) => (
          <span key={`${day}-${index}`}>{day}</span>
        ))}
      </div>
    </div>
  );
}

/**
 * 근거 타임라인.
 *
 * `trend_events` 테이블(스펙 4.2절 제안)이 아직 없어 API의 `timeline`은 비어 있다.
 * 그동안은 시각을 지어내지 않고, 실제로 있는 `reasons`(채널별 근거)를 채널 순서대로 보여준다.
 */
function EvidenceTimeline({ detail }: { detail: KeywordDetail }) {
  const events = detail.timeline;

  if (events.length > 0) {
    return (
      <ol className="td-timeline">
        {events.map((event, index) => (
          <li className="td-tl-item td-tl-spread" key={`${event.detectedAt}-${index}`}>
            <span className="td-tl-marker" aria-hidden="true">
              <span className="td-tl-dot" />
            </span>
            <div className="td-tl-body">
              <div className="td-tl-meta">
                <span className="td-tl-time">{new Date(event.detectedAt).toLocaleString("ko-KR")}</span>
                <span className="td-tl-channel">{event.channel}</span>
              </div>
              <p className="td-tl-text">{event.label}</p>
            </div>
          </li>
        ))}
      </ol>
    );
  }

  if (detail.reasons.length === 0) return null;

  return (
    <ol className="td-timeline">
      {detail.reasons.map((reason, index) => (
        <li className="td-tl-item td-tl-spread" key={`${reason.source}-${index}`}>
          <span className="td-tl-marker" aria-hidden="true">
            <span className="td-tl-dot" />
          </span>
          <div className="td-tl-body">
            <div className="td-tl-meta">
              <span className="td-tl-channel">{reason.source}</span>
            </div>
            <p className="td-tl-text">{reason.text}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

export default async function TrendDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  let detail: KeywordDetail;
  let source: "db" | "mock";

  try {
    const result = await getKeywordDetail(decodeURIComponent(slug));
    detail = result.data;
    source = result.meta.source;
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  return (
    <div className="td">
      <div className="td-content">
        <div className="td-topbar">
          <Link href="/" className="td-back">
            ← 트렌드 목록
          </Link>
          <span className="td-rank">#{detail.rank}</span>
          <span className="td-tag">{detail.category}</span>
        </div>

        <section className="td-hero">
          <p className="td-kicker">{detail.category} · 분석</p>
          <h1 className="td-title">{detail.keyword}</h1>
          <p className="td-byline">분석 · {detail.detectedAgo}</p>
        </section>

        <section className="td-metrics" aria-label="핵심 지표">
          <div className="td-stat">
            <span className="td-stat-value td-up">{detail.growth}</span>
            <span className="td-stat-label">검색 상승률</span>
          </div>
          <div className="td-stat">
            <span className="td-stat-value">{detail.velocity}</span>
            <span className="td-stat-label">확산 속도</span>
          </div>
          <div className="td-stat">
            <span className="td-stat-value">
              {detail.score}
              <em>/100</em>
            </span>
            <span className="td-stat-label">트렌드 점수</span>
          </div>
          <div className="td-stat">
            <span className="td-stat-value">{detail.detectedAgo}</span>
            <span className="td-stat-label">감지 시점</span>
          </div>
        </section>

        {detail.series.length > 0 && (
          <section className="td-panel">
            <h2 className="td-h2">상승 추이</h2>
            <Spark series={detail.series} days={detail.days} />
          </section>
        )}

        <section className="td-panel">
          <p className="td-eyebrow">왜 뜨나</p>
          {/* 요약이 비면 빈 <p>가 min-height만큼 자리를 차지해 배지 밑에 빈 공간이 생긴다. */}
          {detail.summary && <StreamingSummary text={detail.summary} />}
          <ol className="td-reasons">
            {detail.reasons.map((reason, index) => (
              <li key={`${reason.source}-${index}`}>
                <span className="td-reason-source">{reason.source}</span>
                <p>{reason.text}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="td-panel">
          <p className="td-eyebrow">근거 타임라인</p>
          <EvidenceTimeline detail={detail} />
        </section>

        {detail.related.length > 0 && (
          <section className="td-panel">
            <h2 className="td-h2">근거 콘텐츠</h2>
            <div className="td-source-grid">
              {detail.related.map((item, index) => (
                <SourceCard
                  key={`${item.url}-${index}`}
                  platform={item.platform}
                  kind={item.kind}
                  title={item.title}
                  metric={item.metric}
                  excerpt={item.excerpt ?? ""}
                  url={item.url}
                  glyph={platformGlyph(item.platform)}
                  thumbClass={platformClass(item.platform)}
                />
              ))}
            </div>
          </section>
        )}

        {detail.keywords.length > 0 && (
          <section className="td-panel">
            <h2 className="td-h2">연관 키워드</h2>
            <div className="td-chips">
              {detail.keywords.map((keyword) => (
                <span className="td-chip" key={keyword}>
                  {keyword}
                </span>
              ))}
            </div>
          </section>
        )}

        {detail.channels.length > 0 && (
          <section className="td-panel">
            <h2 className="td-h2">감지 채널</h2>
            <ul className="td-channel-list">
              {detail.channels.map((channel) => (
                <li key={channel}>
                  <span className="td-live-dot" aria-hidden="true" />
                  {channel}
                </li>
              ))}
            </ul>
          </section>
        )}

        <footer className="td-footer">
          마지막 갱신 {detail.updatedAgo}
          {source === "mock" && " · 데이터는 예시(mock)입니다"}
        </footer>
      </div>
    </div>
  );
}