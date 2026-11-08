import assert from "node:assert/strict";
import { test } from "node:test";

import { isEchoOfKeyword, sourceLabel } from "./source-label";

test("sourceLabel: 알려진 소스 id는 사람이 읽는 이름으로, 모르는 id는 그대로", () => {
  assert.equal(sourceLabel("xtrends"), "X 실시간 트렌드");
  assert.equal(sourceLabel(" DCBEST "), "디시 실시간 베스트");
  assert.equal(sourceLabel("newsite"), "newsite");
});

test("isEchoOfKeyword: 띄어쓰기·해시·문장부호만 다르면 같은 말", () => {
  assert.equal(isEchoOfKeyword("리제 오하", "리제 오하"), true);
  assert.equal(isEchoOfKeyword("#리제오하!", "리제 오하"), true);
  assert.equal(isEchoOfKeyword("리제 오하 신곡 공개", "리제 오하"), false);
});
