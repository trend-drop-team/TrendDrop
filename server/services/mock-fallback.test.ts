import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import { getCategories } from "./category.service";
import { getHeatmap } from "./heatmap.service";
import { getTrends } from "./trend.service";

// #87 — DB가 없을 때 mock 대체는 개발에서만. 운영(production)에서는 mock을 내보내지 않는다.
// 서비스는 호출 시점에 process.env를 읽으므로 테스트마다 바꿔 끼운다.
const env = process.env as Record<string, string | undefined>;
const original = { NODE_ENV: env.NODE_ENV, DATABASE_URL: env.DATABASE_URL };

beforeEach(() => {
  delete env.DATABASE_URL;
});

afterEach(() => {
  env.NODE_ENV = original.NODE_ENV;
  if (original.DATABASE_URL === undefined) delete env.DATABASE_URL;
  else env.DATABASE_URL = original.DATABASE_URL;
});

test("개발: DB 미설정이면 mock으로 대체하고 source를 mock으로 표시한다", async () => {
  env.NODE_ENV = "development";

  const categories = await getCategories();
  assert.equal(categories.meta.source, "mock");
  assert.ok(categories.data.length > 1);

  const trends = await getTrends();
  assert.equal(trends.meta.source, "mock");
  assert.ok(trends.data.length > 0);
});

test("운영: DB 미설정이면 mock 대신 명시적으로 던진다", async () => {
  env.NODE_ENV = "production";

  await assert.rejects(getCategories(), /DATABASE_URL/);
  await assert.rejects(getTrends(), /DATABASE_URL/);
  await assert.rejects(getTrends({ period: "daily" }), /DATABASE_URL/);
  await assert.rejects(getHeatmap(12), /DATABASE_URL/);
});
