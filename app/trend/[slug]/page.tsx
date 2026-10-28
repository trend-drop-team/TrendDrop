import type { Metadata } from "next";
import { notFound } from "next/navigation";

import StaleCacheWriter from "@/app/stale-cache-writer";
import { fetchApi } from "@/lib/api-client";
import ShareButton from "@/app/share-button";
import ShareCardButton from "@/app/share-card-button";
import { dateTimeLabel } from "@/lib/utils/date";
import KakaoShareButton from "@/app/kakao-share-button";
import { SITE_NAME } from "@/lib/site";
import type { KeywordDetail } from "@/types/api/keyword";

import BackLink from "../back-link";
import RelatedSources from "../source-card";
import StreamingSummary from "../streaming-summary";
import "../trend.css";
import { fetchKeywordDetail } from "./detail";

export const dynamic = "force-dynamic";

/** 카톡·슬랙 미리보기는 두 줄쯤에서 잘린다 — 순위/상승률 같은 사실을 앞에 둔다. */
function shareDescription(detail: KeywordDetail): string {
  const facts = `${detail.category} · 검색 상승률 ${detail.growth} · 트렌드 점수 ${detail.score}/100`;
  const summary = detail.summary.trim();
  if (!summary) return facts;

  const chars = [...summary];
  const brief = chars.length <= 70 ? summary : `${chars.slice(0, 69).join("")}…`;
  return `${facts} — ${brief}`;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;

  let detail: KeywordDetail;
  try {
    detail = (await fetchKeywordDetail(slug)).detail;
  } catch (error) {
    // 없는 키워드면 본문과 같은 판정을 메타데이터 단계에서도 내린다 —
    // 404 화면에 엉뚱한 제목·og 태그가 붙는 걸 막기 위해서다.
    // (상태 코드는 이걸로도 200으로 나간다. master부터 있던 soft 404는 별도 문제.)
    if (error instanceof Error && error.name === "NotFoundError") notFound();
    // 백엔드 장애는 404가 아니다 — 그대로 올려 에러로 처리한다.
    throw error;
  }

  const title = `${detail.keyword} · ${detail.rank}위`;
  const description = shareDescription(detail);
  const url = `/trend/${encodeURIComponent(detail.slug)}`;

  return {
    title,
    description,
    // og:title에는 title.template이 적용되지 않아 서비스명을 직접 붙인다.
    openGraph: { type: "article", title: `${title} · ${SITE_NAME}`, description, url },
    twitter: { card: "summary_large_image", title: `${title} · ${SITE_NAME}`, description },
  };
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
 * "왜 뜨나" 근거 목록.
 *
 * 시각이 있는 타임라인 이벤트(`trend_events`, 스펙 4.2절)가 생기면 그것을 보여주고,
 * 아직 비어 있는 동안에는 채널별 근거(`reasons`)를 보여준다. 둘을 따로 카드로 두면 같은 내용이 두 번 나온다.
 */
function WhyList({ detail }: { detail: KeywordDetail }) {
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
                <span className="td-tl-time">{dateTimeLabel(event.detectedAt)}</span>
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
    <ol className="td-reasons">
      {detail.reasons.map((reason, index) => (
        <li key={`${reason.source}-${index}`}>
          <span className="td-reason-source">{reason.source}</span>
          <p>{reason.text}</p>
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
    // generateMetadata가 이미 부른 요청과 같은 것 — react cache가 한 번으로 합친다.
    const result = await fetchKeywordDetail(slug);
    detail = result.detail;
    source = result.source;
  } catch (error) {
    if (error instanceof Error && error.name === "NotFoundError") notFound();
    throw error;
  }

  // 감지 채널 중 근거(reasons) 출처에 이미 나온 것은 근거 목록이 말해 주므로, 빠진 채널만 한 줄로 덧붙인다.
  const reasonSources = new Set(detail.reasons.map((reason) => reason.source));
  const extraChannels = detail.channels.filter((channel) => !reasonSources.has(channel));

  const staleSummary = {
    heading: "마지막으로 확인된 상세",
    items: [
      {
        primary: detail.keyword,
        secondary: detail.category,
        trailing: `${detail.rank}위 · ${detail.score}/100`,
      },
    ],
  };

  return (
    <div className="td">
      <StaleCacheWriter cacheKey={`trend:${slug}`} summary={staleSummary} />
      <div className="td-content">
        <div className="td-topbar">
          <BackLink />
          <span className="td-rank">#{detail.rank}</span>
          <div className="share-actions">
            <ShareButton
              path={`/trend/${encodeURIComponent(detail.slug)}`}
              title={`${detail.keyword} · ${detail.rank}위`}
              text={`${detail.keyword} 지금 ${detail.rank}위 (${detail.growth})`}
            />
            <KakaoShareButton
              path={`/trend/${encodeURIComponent(detail.slug)}`}
              title={`${detail.keyword} · ${detail.rank}위`}
              text={`${detail.keyword} 지금 ${detail.rank}위 (${detail.growth})`}
            />
            <ShareCardButton
              cardPath={`/share-card?slug=${encodeURIComponent(detail.slug)}`}
              fileName={`trenddrop-${detail.slug}`}
              title={`${detail.keyword} · ${detail.rank}위`}
              text={`${detail.keyword} 지금 ${detail.rank}위 (${detail.growth})`}
            />
          </div>
        </div>

        <section className="td-hero">
          <p className="td-kicker">{detail.category}</p>
          <h1 className="td-title">{detail.keyword}</h1>
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

        {(detail.summary || detail.reasons.length > 0 || detail.timeline.length > 0) && (
          <section className="td-panel">
            <p className="td-eyebrow">왜 뜨나</p>
            {/* 요약이 비면 AI 요약 블록 전체를 숨긴다 — 빈 배지/자리만 남지 않게. */}
            {detail.summary && <StreamingSummary text={detail.summary} />}
            <WhyList detail={detail} />
            {extraChannels.length > 0 && (
              <p className="td-why-channels">그 밖의 감지 채널 · {extraChannels.join(", ")}</p>
            )}
          </section>
        )}

        {detail.related.length > 0 && (
          <section className="td-panel">
            <h2 className="td-h2">근거 콘텐츠</h2>
            <RelatedSources items={detail.related} />
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

        <footer className="td-footer">
          마지막 갱신 {detail.updatedAgo}
          {source === "mock" && " · 데이터는 예시(mock)입니다"}
        </footer>
      </div>
    </div>
  );
}
