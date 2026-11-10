import assert from "node:assert/strict";
import { test } from "node:test";

import { axisLabels, clockLabel, dateTimeLabel, kstHourKey } from "./date";

// 회귀 테스트: #71 — 서버 OS 시간대(Vercel 기본 UTC)에 기대지 않고 Asia/Seoul로 고정되는지 확인.
// process.env.TZ를 UTC로 강제해도 KST 기준 결과가 나와야 한다.
process.env.TZ = "UTC";

test("clockLabel은 서버가 UTC로 돌아도 Asia/Seoul 기준 시:분을 반환한다", () => {
  // 2026-01-15T05:00:00Z == 2026-01-15 14:00 KST
  assert.equal(clockLabel(new Date("2026-01-15T05:00:00.000Z")), "14:00");
  // 자정 경계: 2026-01-14T15:00:00Z == 2026-01-15 00:00 KST (날짜가 넘어가도 00:00이어야지 24:00이면 안 됨)
  assert.equal(clockLabel("2026-01-14T15:00:00.000Z"), "00:00");
});

test("dateTimeLabel은 Asia/Seoul 기준 날짜+시각을 반환한다", () => {
  assert.equal(dateTimeLabel("2026-01-14T15:00:00.000Z"), "2026년 1월 15일 00:00");
});

test("axisLabels: 날짜가 바뀌는 점과 오늘이 아닌 첫 점에만 날짜를 붙인다 (#125)", () => {
  // KST 11/7 19:00, 20:00 → 11/8 17:00, 19:00 / now = 11/8 21:00 KST
  const dates = ["2026-11-07T10:00:00Z", "2026-11-07T11:00:00Z", "2026-11-08T08:00:00Z", "2026-11-08T10:00:00Z"];
  assert.deepEqual(axisLabels(dates, "2026-11-08T12:00:00Z"), ["11/7 19:00", "20:00", "11/8 17:00", "19:00"]);
  // 전부 오늘이면 시각만
  assert.deepEqual(axisLabels(dates.slice(2), "2026-11-08T12:00:00Z"), ["17:00", "19:00"]);
});

test("kstHourKey: 같은 KST 시간이면 같은 키, UTC 자정 경계도 KST로 묶는다", () => {
  assert.equal(kstHourKey("2026-11-08T08:05:00Z"), kstHourKey("2026-11-08T08:55:00Z"));
  assert.notEqual(kstHourKey("2026-11-08T08:55:00Z"), kstHourKey("2026-11-08T09:05:00Z"));
  assert.equal(kstHourKey("2026-01-14T15:30:00Z"), "2026-01-15T00");
});
