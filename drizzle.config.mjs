// 스키마 단일 소유자는 db/schema.ts다.
// 수집 파이프라인은 테이블을 만들지 않고(store.mjs가 DDL을 안 함)
// 여기서 만든 스키마에 데이터만 넣는다 — `npm run db:push`로 반영.
const config = {
  schema: "./db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
  verbose: true,
  strict: true,
};

export default config;
