# 기존 수집 데이터에서 새로 뽑아낼 수 있는 기능 제안

> 작성일: 2026-09-03 · 실 DB(`raw_signals` 48,751건 / `trend_snapshots` 1,508건 / `keyword_verdicts` 1,542건)를
> 직접 조회해서 확인한 내용 기준. **새 외부 수집 없이**, 지금 파이프라인이 이미 만들어내고 있는 데이터에서
> 추가로 뽑아낼 수 있는 기능과 그걸 담을 신규 테이블을 정리한다.

---

## 1. 현재 데이터 흐름

```
raw_signals (원본, 소스별 meta jsonb 포함)
  → popular.mjs: 최근 N시간 창으로 스코어링
  → verdict.mjs: LLM으로 키워드 채택 여부 판정
  → trend_snapshots (run 1건당 키워드 1행: rank/score/growthRate/reasons)
```

수집 → 스코어링 → 저장까지는 잘 도는데, `raw_signals.meta`에 소스별로 실려 오는 부가 필드 중 상당수가
**스코어링 계산에 잠깐 쓰이고 그대로 버려진다.** 실제 저장된 값을 소스별로 까본 결과:

| 소스    | `meta` 안 실제 필드                                              | 지금 쓰이는 곳                       | 지금 버려지는 정보                                   |
| ------- | ---------------------------------------------------------------- | ------------------------------------ | ---------------------------------------------------- |
| dcbest  | `gallery` (싱갤 1,957 · 더갤 1,342 · 이갤 1,107 등 10+종)        | 없음 — 원문 텍스트만 스코어링에 사용 | **어느 갤러리에서 떴는지** — 완전히 사장             |
| instiz  | `rank`, `category` (일상 712 · 정보·기타 686 · 이슈·소식 205 등) | 없음                                 | **어느 게시판 카테고리인지**                         |
| youtube | `videoId`, 댓글별 `likeCount`                                    | 랭킹 가중치 계산에만 사용            | **댓글 개별 반응 강도**(어떤 댓글이 얼마나 공감받았는지) |
| gtrends | `newsTitles`(관련뉴스 헤드라인 최대 3건 배열), `approxTraffic`   | 최신 1건만 훑고 버림                 | **버킷별 뉴스 헤드라인 변화 이력**                   |

또한 `trend_snapshots`를 `keyword_id`로 묶어 보면(예: keyword_id=1은 2026-08-16~08-29 사이 77개
run에 걸쳐 존재, `source_label`이 run마다 `youtube` → `youtube, dcbest` → `youtube, gtrends` 식으로
바뀜), **한 키워드가 뜨고 지는 생애주기 자체는 이미 데이터로 흩어져 있다.** 다만 run별 flat row라서
"언제 시작해 언제 최고점을 찍고 언제 꺼졌는지", "어느 소스가 제일 먼저 잡았는지"를 지금 스키마로는 한
번에 조회할 방법이 없다. (`feature-checklist.md` 3장이 "근거 타임라인은 대응하는 스키마 개념이 아예
없다"고 지적한 부분이 바로 이 갭이다.)

아래 4개 제안은 전부 이 표에서 "버려지는 정보"와 "흩어진 생애주기"를 재료로 삼는다. **신규 수집 0건.**

---

## 2. 제안 1 (1순위) — 트렌드 서지 에피소드: `trend_surge_episodes`

**사용자에게 보이는 모습**: 트렌드 상세 페이지에 "언제 시작해서 언제 정점을 찍었는지" 보여주는 타임라인이
생긴다. "🔥 3시간 만에 20위 → 1위" 같은 떡상 속도 배지, "어제도 떴다가 오늘 다시 떴어요" 같은 재점화
알림으로 사용자는 이 키워드가 **얼마나 빠르게, 몇 번이나 화제가 됐는지**를 그래프 한 번 안 봐도 문장으로
바로 이해한다.

`trend_snapshots`를 keyword_id로 순회하며 배치로 채우는 **순수 파생 테이블**. run 간 간격이 벌어지면
에피소드를 닫고, 이어지면 peak를 갱신한다. 새 수집이 전혀 필요 없다.

```ts
export const trendSurgeEpisodes = pgTable(
  "trend_surge_episodes",
  {
    id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    keywordId: integer("keyword_id")
      .notNull()
      .references(() => keywords.id),
    startRunId: integer("start_run_id")
      .notNull()
      .references(() => collectionRuns.id),
    startBucketAt: timestamp("start_bucket_at", {
      withTimezone: true,
    }).notNull(),
    endBucketAt: timestamp("end_bucket_at", { withTimezone: true }),
    peakRank: integer("peak_rank"),
    peakScore: integer("peak_score"),
    peakBucketAt: timestamp("peak_bucket_at", { withTimezone: true }),
    // 이 에피소드에서 처음 이 키워드를 잡은 소스 (source_label 첫 토큰)
    firstSource: varchar("first_source", { length: 40 }),
    // [{ source, bucketAt }] — 소스별 최초 등장 순서, 근거 타임라인 렌더링용
    sourceSequence: jsonb("source_sequence"),
    runCount: integer("run_count").notNull().default(1),
    // null이면 아직 진행 중(활성 서지) — "지금 뜨는 중" 배지에 사용
    closedAt: timestamp("closed_at", { withTimezone: true }),
  },
  (table) => ({
    keywordStartIdx: uniqueIndex("trend_surge_episodes_keyword_start_idx").on(
      table.keywordId,
      table.startBucketAt,
    ),
  }),
);
```

**여는 기능**

- `/trend/[slug]` 근거 타임라인을 합성 데이터 대신 실제 이력으로 표시 —
  "gtrends 21:00 첫 포착 → youtube 22:00 합류 → 23:00 피크 8위"
- "떡상 속도" 배지 — `peakBucketAt - startBucketAt`으로 "3시간 만에 급상승" 문구 생성
- 소스별 "최초 감지율" — 어느 커뮤니티가 트렌드를 제일 먼저 잡아내는지 신뢰도 랭킹(신규 분석 페이지 소재)
- 재점화 감지 — 같은 키워드가 여러 에피소드로 재등장하면 "다시 화제" 표시

---

## 3. 제안 2 (보조) — 커뮤니티/카테고리 태그: `keyword_source_tags`

**사용자에게 보이는 모습**: 트렌드 상세 페이지에 "어디서 화제인지" 알려주는 칩이 붙는다. "싱글벙글겔러리,
이슈·소식 게시판에서 화제" 처럼 표시되면, 사용자는 클릭해서 상세를 읽어보기 전에도 **이게 가벼운 유머
소재인지 진지한 뉴스성 이슈인지** 감을 잡을 수 있다.

```ts
export const keywordSourceTags = pgTable(
  "keyword_source_tags",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    keywordId: integer("keyword_id")
      .notNull()
      .references(() => keywords.id),
    sourceId: integer("source_id")
      .notNull()
      .references(() => sources.id),
    // dcbest: 갤러리명(싱갤/더갤), instiz: 게시판 카테고리(일상/이슈·소식) — 소스별 원문 태그
    tag: varchar("tag", { length: 40 }).notNull(),
    mentionCount: integer("mention_count").notNull().default(1),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    tagIdx: uniqueIndex("keyword_source_tags_idx").on(
      table.keywordId,
      table.sourceId,
      table.tag,
    ),
  }),
);
```

`raw_signals.meta.gallery`/`meta.category`는 `collect.mjs`가 저장할 때 이미 손에 쥐고 있는 값이라,
`store.mjs`에 upsert 한 줄만 추가하면 채워진다.

**여는 기능**

- 트렌드 상세 페이지에 "화제가 된 곳: 싱글벙글겔러리, 이슈·소식" 같은 칩 — LLM 판정과 무관하게 원문
  커뮤니티 맥락을 그대로 노출
- 카테고리별 반응 분포 시각화(예: "이 키워드는 유머 갤러리보다 이슈·소식 게시판에서 더 화제")

---

## 4. 제안 3 (신규) — 소셜 증거 댓글: `keyword_evidence_quotes`

**사용자에게 보이는 모습**: AI 요약만 읽는 게 아니라, 트렌드 상세 페이지에 "댓글창 반응" 섹션이 생겨서
**실제 사람이 남긴, 가장 공감받은 댓글**을 그대로 인용해서 보여준다. "이 장면 레전드ㅋㅋㅋ (공감 83)"
같은 카드 하나가 AI 요약 문장 열 줄보다 신뢰를 준다 — "왜 뜨는지"를 설명이 아니라 **증거**로 보여주는
것.

YouTube 댓글은 이미 `raw_signals.meta.likeCount`로 공감 수까지 수집되고 있는데, 지금은 랭킹 가중치
계산에만 쓰이고 원문은 그대로 버려진다. run마다 상위 N개 댓글만 골라 저장하면 된다.

```ts
export const keywordEvidenceQuotes = pgTable(
  "keyword_evidence_quotes",
  {
    id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    keywordId: integer("keyword_id")
      .notNull()
      .references(() => keywords.id),
    sourceId: integer("source_id")
      .notNull()
      .references(() => sources.id),
    quoteText: text("quote_text").notNull(),
    likeCount: integer("like_count").notNull().default(0),
    // youtube면 댓글이 달린 videoId — 원문으로 이동하는 링크에 사용
    externalRef: varchar("external_ref", { length: 120 }),
    bucketAt: timestamp("bucket_at", { withTimezone: true }).notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    dedupIdx: uniqueIndex("keyword_evidence_quotes_dedup_idx").on(
      table.keywordId,
      table.quoteText,
      table.bucketAt,
    ),
  }),
);
```

**여는 기능**

- "댓글창 반응" 카드 — 공감 수 상위 1~3개 댓글을 원문 그대로 인용, 원문 영상 링크와 함께 노출
- AI 요약(`trend_snapshots.summary`)이 아직 없는 지금도 **즉시 채울 수 있는 "왜 뜨나" 대체 콘텐츠**
  — LLM 비용 없이 신뢰도 있는 근거를 먼저 제공 가능
- 공유 카드 이미지(`ui-feature-roadmap.md` 바이럴 플랜)에 인용구를 넣으면 캡처 공유 시 훨씬 자극적

---

## 5. 제안 4 (신규) — 뉴스 헤드라인 타임라인: `keyword_news_mentions`

**사용자에게 보이는 모습**: 트렌드 상세 페이지에 "보도 흐름" 미니 타임라인이 생긴다. 예를 들어 "박재홍"
키워드라면 "21:00 — '밤 10시 트랙 돌다 쓰러져'" → "22:00 — '뇌경색 진단, 생각보다 심각했다'" 식으로
**시간이 지나며 뉴스 헤드라인이 어떻게 바뀌었는지**를 보여준다. 사용자는 지금 이 이슈가 처음엔 단순
해프닝이었다가 점점 심각해지는 흐름인지, 아니면 잦아드는 흐름인지 헤드라인 변화만으로 파악할 수 있다.

Google Trends RSS가 버킷마다 관련뉴스 헤드라인을 최대 3건씩 `meta.newsTitles` 배열로 이미 넘겨주는데,
지금은 최신 1건만 훑고 버려진다. 버킷마다 헤드라인을 그대로 적재하면 된다.

```ts
export const keywordNewsMentions = pgTable(
  "keyword_news_mentions",
  {
    id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    keywordId: integer("keyword_id")
      .notNull()
      .references(() => keywords.id),
    headline: text("headline").notNull(),
    // newsTitles 배열 내 순서(0=최상단) — 헤드라인 비중 참고용
    rankInBucket: integer("rank_in_bucket"),
    approxTraffic: varchar("approx_traffic", { length: 20 }),
    bucketAt: timestamp("bucket_at", { withTimezone: true }).notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    dedupIdx: uniqueIndex("keyword_news_mentions_dedup_idx").on(
      table.keywordId,
      table.headline,
      table.bucketAt,
    ),
  }),
);
```

**여는 기능**

- "보도 흐름" 타임라인 — 헤드라인이 바뀌는 지점을 보여줘 이슈의 전개(단순 해프닝 → 심각한 사안 등)를
  한눈에 전달
- 헤드라인 원문이 쌓이므로 이후 `trend_snapshots.summary`(AI 요약)를 붙일 때 **그대로 LLM 입력 소스**로
  재사용 가능 — 요약 품질을 위한 사전 작업이 됨
- `approxTraffic` 변화를 곁들이면 "관심도가 커지는 이슈"와 "이미 식어가는 이슈"를 헤드라인 톤과 함께
  구분 가능

---

## 6. 요약

| 제안                    | 신규 수집 필요                        | 필요 작업                            | 우선순위                                                            |
| ----------------------- | -------------------------------------- | ------------------------------------ | -------------------------------------------------------------------- |
| `trend_surge_episodes`  | 없음 (기존 `trend_snapshots` 재가공)   | 배치 스크립트(`pipeline/`) 신규 작성 | 1순위 — UX 임팩트 크고, `feature-checklist.md`의 문서화된 갭을 해소  |
| `keyword_evidence_quotes` | 없음 (기존 `raw_signals.meta.likeCount` 재사용) | `store.mjs`에 상위 N개 댓글 적재 로직 추가 | 2순위 — 구현 쉽고, AI 요약 없이도 "왜 뜨나"를 즉시 채움 |
| `keyword_news_mentions` | 없음 (기존 `raw_signals.meta.newsTitles` 재사용) | `store.mjs`에 헤드라인 적재 로직 추가 | 3순위 — 임팩트 좋지만 gtrends로 잡힌 키워드에만 해당(커버리지 제한) |
| `keyword_source_tags`   | 없음 (기존 `raw_signals.meta.gallery`/`category` 재사용) | `store.mjs`에 upsert 한 줄 추가      | 4순위 — 구현 비용 가장 낮지만 임팩트는 보조적                        |

네 제안 모두 `db/schema.ts`에 실제로 반영하지 않은 **설계 초안**이다. 진행하기로 하면 스키마 반영 +
배치/저장 스크립트 구현이 다음 단계.
