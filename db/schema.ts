// 이 프로젝트의 **단일 스키마 소유자**. `npm run db:push`(drizzle.config.mjs)가
// 이 파일을 DB에 반영하고, 수집 파이프라인은 테이블을 만들지 않고
// (store.mjs가 DDL을 안 함) 여기 정의된 스키마에 데이터만 넣는다.
//
// 근거 문서: docs/unified-schema-api-spec.md(현행),
// docs/page-analysis-and-backend-design.md(6장), docs/trend-rising-rename-plan.md.
import {
  bigint,
  boolean,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

export const categories = pgTable(
  "categories",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    name: varchar("name", { length: 80 }).notNull(),
    slug: varchar("slug", { length: 80 }).notNull(),
    sortOrder: integer("sort_order").notNull(),
  },
  (table) => ({
    categoryNameIdx: uniqueIndex("categories_name_idx").on(table.name),
    categorySlugIdx: uniqueIndex("categories_slug_idx").on(table.slug),
  })
);

// 구 db/schema.ts의 sources와 동일 — 컬럼 변경 없이 그대로 승계.
export const sources = pgTable(
  "sources",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    name: varchar("name", { length: 80 }).notNull(),
    kind: varchar("kind", { length: 40 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    sourceNameIdx: uniqueIndex("sources_name_idx").on(table.name),
  })
);

export const collectionRuns = pgTable("collection_runs", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  pipeline: varchar("pipeline", { length: 40 }).notNull(),
  geo: varchar("geo", { length: 8 }).notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  status: varchar("status", { length: 20 }).notNull(),
  rawSignalCount: integer("raw_signal_count"),
  keywordCount: integer("keyword_count"),
  apiCallLog: jsonb("api_call_log"),
  errorMessage: text("error_message"),
  // 이 실행이 참조한 데이터의 기준 시각(창의 최신 버킷). startedAt(프로세스 시작 시각)과 별개.
  bucketAt: timestamp("bucket_at", { withTimezone: true }),
  windowHours: integer("window_hours"),
  buckets: integer("buckets"),
  filtered: boolean("filtered").notNull().default(false),
});

export const keywords = pgTable(
  "keywords",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    term: varchar("term", { length: 160 }).notNull(),
    slug: varchar("slug", { length: 200 }).notNull(),
    categoryId: integer("category_id").references(() => categories.id),
    sourceId: integer("source_id").references(() => sources.id),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    keywordTermIdx: uniqueIndex("keywords_term_idx").on(table.term),
    keywordSlugIdx: uniqueIndex("keywords_slug_idx").on(table.slug),
  })
);

export const rawSignals = pgTable(
  "raw_signals",
  {
    id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    runId: integer("run_id").notNull().references(() => collectionRuns.id),
    // 어느 사이트/API에서 왔는지(dcbest/youtube/gtrends 등) — 커뮤니티 소스 구분용.
    sourceId: integer("source_id").notNull().references(() => sources.id),
    // 신호의 종류(trending_search/video_title/comment 등) — 위 sourceId와는 별개 축.
    source: varchar("source", { length: 40 }).notNull(),
    text: text("text").notNull(),
    textHash: varchar("text_hash", { length: 64 }).notNull(),
    videoId: varchar("video_id", { length: 32 }),
    meta: jsonb("meta"),
    // 수집이 귀속되는 1시간 버킷(정시 내림). 중복 제거·체류시간 기반 가중치에 사용.
    bucketAt: timestamp("bucket_at", { withTimezone: true }).notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    rawSignalDedupIdx: uniqueIndex("raw_signals_dedup_idx").on(
      table.sourceId,
      table.textHash,
      table.bucketAt
    ),
  })
);

export const trendSnapshots = pgTable("trend_snapshots", {
  id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  keywordId: integer("keyword_id").notNull().references(() => keywords.id),
  runId: integer("run_id").notNull().references(() => collectionRuns.id),
  rank: integer("rank"),
  score: integer("score"),
  growthRate: varchar("growth_rate", { length: 32 }),
  velocity: varchar("velocity", { length: 32 }),
  // 창(window) 안 언급 횟수(raw count) — growthRate 같은 표시값의 근거 원본.
  mentions: integer("mentions"),
  risingScore: integer("rising_score"),
  baselineMentions: integer("baseline_mentions"),
  summary: text("summary"),
  // [{ source, text, sample?, weight? }] — sample: 근거 원문 인용, weight: 소스별 기여 점수.
  // 단일 source_id FK를 두지 않는 이유: 한 키워드가 여러 소스에서 동시에 잡히는 게 정상이라
  // "대표 소스 하나"를 고를 기준이 없다. 소스별 기여는 이 reasons 배열이 표현한다.
  reasons: jsonb("reasons"),
  sourceLabel: varchar("source_label", { length: 200 }),
  externalRef: varchar("external_ref", { length: 120 }),
  sourceUrl: text("source_url"),
  capturedAt: timestamp("captured_at", { withTimezone: true }).defaultNow().notNull(),
});

export const trendContents = pgTable("trend_contents", {
  id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  keywordId: integer("keyword_id").notNull().references(() => keywords.id),
  kind: varchar("kind", { length: 32 }).notNull(),
  title: text("title").notNull(),
  url: text("url").notNull(),
  thumbnailUrl: text("thumbnail_url"),
  metricLabel: varchar("metric_label", { length: 80 }),
  source: varchar("source", { length: 160 }),
  rank: integer("rank"),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const keywordRelations = pgTable(
  "keyword_relations",
  {
    keywordId: integer("keyword_id").notNull().references(() => keywords.id),
    relatedKeywordId: integer("related_keyword_id").notNull().references(() => keywords.id),
    weight: real("weight"),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.keywordId, table.relatedKeywordId] }),
  })
);

export const users = pgTable(
  "users",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    email: varchar("email", { length: 200 }).notNull(),
    // 해시된 비밀번호만 저장한다 — 평문 저장 금지. 소셜 로그인 등 비밀번호 없는 가입 경로를
    // 열어둘 수 있어 nullable로 둔다.
    passwordHash: text("password_hash"),
    name: varchar("name", { length: 80 }),
    // 'user' | 'admin'. 승격/강등은 코드가 아니라 DB에서 직접 UPDATE한다(#79) — 관리자용 UI는 범위 밖.
    role: varchar("role", { length: 20 }).notNull().default("user"),
    // provider가 검증한(email_verified/is_email_verified) 이메일일 때만 채운다(#83).
    // null이면 이 계정의 email 컬럼은 신원 증명으로 쓸 수 없다 — provider+providerId로만 식별된다.
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    // 'google' | 'kakao' | null(비OAuth 계정). OAuth 계정 매칭의 1순위 키(#83) —
    // 이메일 문자열이 같다는 이유만으로 다른 provider 계정을 같은 사람으로 보지 않는다.
    provider: varchar("provider", { length: 20 }),
    // provider가 돌려준 고유 사용자 ID(구글 sub, 카카오 id). provider와 쌍으로만 의미가 있다.
    providerId: varchar("provider_id", { length: 120 }),
    // 이 시각 이전에 발급된 세션 토큰은 즉시 무효(#94). 세션이 stateless라 폐기 수단이
    // 없던 문제의 해법 — 탈취 대응 시 운영자가 DB에서 직접 now()로 갱신한다(#79의 role과 동일 운영 방식).
    sessionTokenMinIat: timestamp("session_token_min_iat", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()),
  },
  (table) => ({
    userEmailIdx: uniqueIndex("users_email_idx").on(table.email),
    // Postgres 유니크 인덱스는 NULL끼리 서로 다르다고 보므로, provider가 없는(비OAuth) 행은
    // 여러 개 있어도 충돌하지 않는다 — OAuth 계정에 한해서만 provider+providerId 중복을 막는다.
    userProviderIdx: uniqueIndex("users_provider_id_idx").on(table.provider, table.providerId),
  })
);

export const watchlistItems = pgTable(
  "watchlist_items",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    userId: integer("user_id").notNull().references(() => users.id),
    keywordId: integer("keyword_id").notNull().references(() => keywords.id),
    addedAt: timestamp("added_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    // 랭킹 행 즐겨찾기(★)와 워치리스트 패널이 이 테이블 하나로 합쳐질 예정이라 중복 저장 방지.
    watchlistUserKeywordIdx: uniqueIndex("watchlist_items_user_keyword_idx").on(
      table.userId,
      table.keywordId
    ),
  })
);

// 글 단위 이슈 추출 결과 캐시 — pipeline/issues.mjs가 원문 한 줄마다 LLM으로 뽑은 키워드.
// 글의 뜻은 시간이 지나도 안 바뀌므로 text_hash(raw_signals.text_hash와 같은 sha1) 하나에 한 행.
// 창이 6시간인데 1시간씩만 밀려서 매시간 새로 뽑는 글은 ~10%뿐이다.
// prompt_version이 현재 프롬프트와 다르면 그 행은 없는 것으로 보고 다시 뽑아 덮어쓴다.
export const textExtractions = pgTable("text_extractions", {
  textHash: varchar("text_hash", { length: 64 }).primaryKey(),
  promptVersion: varchar("prompt_version", { length: 40 }).notNull(),
  model: varchar("model", { length: 80 }),
  // now(지금 일어난 일) / buzz(화제 콘텐츠·반응) / evergreen(언제 올라와도 될 글) — 점수 배율용
  timeliness: varchar("timeliness", { length: 16 }).notNull(),
  // [{ name, category, issue }] — 키워드 없는 글은 [] (잡담·광고 등. 그것도 결과라 저장한다)
  keywords: jsonb("keywords").notNull(),
  extractedAt: timestamp("extracted_at", { withTimezone: true }).defaultNow().notNull(),
});

// 이름 사전 — 최종 검수가 "같은 대상"으로 묶은 이름(별칭 → 정식 이름).
// 다음 실행부터 추출 결과에 바로 적용되고, 추출 프롬프트의 "이미 쓰는 이름"에도 들어간다.
// 넣고 빼는 판단(drop)은 맥락 의존이라 저장하지 않는다 — 묶기만 쌓는다.
export const keywordAliases = pgTable("keyword_aliases", {
  alias: text("alias").primaryKey(),
  canonical: text("canonical").notNull(),
  model: varchar("model", { length: 80 }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
