import {
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

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

export const keywords = pgTable(
  "keywords",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    term: varchar("term", { length: 160 }).notNull(),
    category: varchar("category", { length: 80 }).notNull(),
    sourceId: integer("source_id").references(() => sources.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    keywordTermIdx: uniqueIndex("keywords_term_idx").on(table.term),
  })
);

export const trendSnapshots = pgTable("trend_snapshots", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  keywordId: integer("keyword_id").notNull().references(() => keywords.id),
  score: integer("score"),
  growthRate: varchar("growth_rate", { length: 32 }),
  velocity: varchar("velocity", { length: 32 }),
  summary: text("summary"),
  reason: text("reason"),
  sourceLabel: varchar("source_label", { length: 200 }),
  externalRef: varchar("external_ref", { length: 120 }),
  sourceUrl: varchar("source_url", { length: 500 }),
  capturedAt: timestamp("captured_at", { withTimezone: true }).defaultNow().notNull(),
});

export const trendContents = pgTable("trend_contents", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  keywordId: integer("keyword_id").notNull().references(() => keywords.id),
  kind: varchar("kind", { length: 32 }).notNull(),
  title: text("title").notNull(),
  url: varchar("url", { length: 500 }).notNull(),
  source: varchar("source", { length: 160 }),
  rank: integer("rank"),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
