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
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()),
  },
  (table) => ({
    userEmailIdx: uniqueIndex("users_email_idx").on(table.email),
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

// 원문에서 뽑힌 단어를 키워드로 채택할지 LLM이 판정하고 캐싱하는 테이블.
// keep=true인 term만 keywords로 승격된다. term 자체가 자연키라 PK로 쓴다.
export const keywordVerdicts = pgTable("keyword_verdicts", {
  term: text("term").primaryKey(),
  keep: boolean("keep").notNull(),
  canonical: text("canonical"),
  // categories(UI 탭용: 푸드/뷰티/테크)와는 다른 축이라 별도 컬럼.
  contentType: varchar("content_type", { length: 40 }),
  reason: text("reason"),
  sample: text("sample"),
  model: varchar("model", { length: 80 }),
  decidedAt: timestamp("decided_at", { withTimezone: true }).defaultNow().notNull(),
});
