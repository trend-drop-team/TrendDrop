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
  // 적용 이력 테이블. 기본값은 별도 drizzle 스키마인데,
  // Neon 콘솔 Tables가 스키마를 하나씩만 보여줘서 public으로 끌어냈다.
  migrations: {
    table: "__drizzle_migrations",
    schema: "public",
  },
  verbose: true,
  strict: true,
};

export default config;
