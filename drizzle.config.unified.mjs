// db/unified-schema.ts 검토용 설정 — 기존 drizzle.config.mjs(db/schema.ts, 실제 앱용)는 건드리지 않는다.
// `npx drizzle-kit generate --config=drizzle.config.unified.mjs`로 drizzle/unified/에 DDL만 생성한다.
const config = {
  schema: "./db/unified-schema.ts",
  out: "./drizzle/unified",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
  verbose: true,
  strict: true,
};

export default config;
