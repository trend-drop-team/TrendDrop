import assert from "node:assert/strict";
import { test } from "node:test";

import { clockLabel, dateTimeLabel } from "./date";

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
