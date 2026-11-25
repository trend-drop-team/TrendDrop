import assert from "node:assert/strict";
import { test } from "node:test";

import { checkRateLimit, clientIp, enforceReadRateLimit, READ_RATE_LIMIT } from "./rate-limit";

test("한도 이내 요청은 허용한다", () => {
  const result = checkRateLimit(`t-${Math.random()}`, 3, 60_000);
  assert.equal(result.allowed, true);
});

test("한도를 넘으면 거부하고 retryAfterSeconds를 양수로 돌려준다 (#94)", () => {
  const key = `t-${Math.random()}`;
  checkRateLimit(key, 2, 60_000);
  checkRateLimit(key, 2, 60_000);
  const blocked = checkRateLimit(key, 2, 60_000);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSeconds > 0);
});

test("키가 다르면 서로의 카운트에 영향을 주지 않는다", () => {
  const a = checkRateLimit(`t-a-${Math.random()}`, 1, 60_000);
  const b = checkRateLimit(`t-b-${Math.random()}`, 1, 60_000);
  assert.equal(a.allowed, true);
  assert.equal(b.allowed, true);
});

test("윈도우가 지나면 카운터가 리셋된다", async () => {
  const key = `t-reset-${Math.random()}`;
  checkRateLimit(key, 1, 1);
  await new Promise((resolve) => setTimeout(resolve, 10));
  const result = checkRateLimit(key, 1, 1);
  assert.equal(result.allowed, true);
});

test("x-forwarded-for의 마지막 값(신뢰 가능한 엣지가 덧붙인 값)을 클라이언트 IP로 쓴다", () => {
  const request = new Request("http://example.com", { headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" } });
  assert.equal(clientIp(request), "5.6.7.8");
});

test("클라이언트가 x-forwarded-for를 조작해도(맨 앞 값) 레이트리밋 키가 바뀌지 않는다 (#94 회귀 가드)", () => {
  const a = new Request("http://example.com", { headers: { "x-forwarded-for": "spoofed-1, 9.9.9.9" } });
  const b = new Request("http://example.com", { headers: { "x-forwarded-for": "spoofed-2, 9.9.9.9" } });
  assert.equal(clientIp(a), clientIp(b));
});

test("x-real-ip는 신뢰하지 않는다 — 클라이언트가 자유롭게 써서 레이트리밋을 우회할 수 있다 (회귀 가드)", () => {
  const request = new Request("http://example.com", { headers: { "x-real-ip": "9.9.9.9", "x-forwarded-for": "1.2.3.4" } });
  assert.equal(clientIp(request), "1.2.3.4");
});

test("헤더가 없으면 unknown을 돌려준다", () => {
  const request = new Request("http://example.com");
  assert.equal(clientIp(request), "unknown");
});

test("enforceReadRateLimit: 한도 이내 요청은 null을 돌려준다(통과) (#118)", () => {
  const request = new Request("http://example.com", { headers: { "x-forwarded-for": `9.9.9.${Math.random()}` } });
  assert.equal(enforceReadRateLimit(request, `read-test-ok-${Math.random()}`), null);
});

test("enforceReadRateLimit: 한도를 넘으면 429와 retry-after 헤더를 돌려준다 (#118)", () => {
  const ip = `1.1.1.${Math.floor(Math.random() * 1000)}`;
  const routeKey = `read-test-block-${Math.random()}`;
  const request = new Request("http://example.com", { headers: { "x-forwarded-for": ip } });

  for (let i = 0; i < READ_RATE_LIMIT; i += 1) {
    assert.equal(enforceReadRateLimit(request, routeKey), null);
  }

  const blocked = enforceReadRateLimit(request, routeKey);
  assert.ok(blocked);
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get("retry-after")) > 0);
});

test("enforceReadRateLimit: 라우트 키가 다르면 같은 IP라도 서로 다른 한도를 쓴다 (#118)", () => {
  const ip = `2.2.2.${Math.floor(Math.random() * 1000)}`;
  const request = new Request("http://example.com", { headers: { "x-forwarded-for": ip } });

  for (let i = 0; i < READ_RATE_LIMIT; i += 1) {
    assert.equal(enforceReadRateLimit(request, "route-a"), null);
  }
  assert.ok(enforceReadRateLimit(request, "route-a"));
  assert.equal(enforceReadRateLimit(request, "route-b"), null);
});
