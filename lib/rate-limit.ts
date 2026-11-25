import { NextResponse } from "next/server";

/**
 * 메모리 기반 고정 윈도우 레이트리밋(#94). Next.js Route Handler(app/api/**)는 Express
 * 미들웨어(express-rate-limit)를 못 쓰므로 별도로 둔다.
 *
 * 프로세스 메모리에만 카운터를 둔다 — 인스턴스가 여러 개로 늘어나면 인스턴스별로 따로 세어
 * 유효 한도가 (limit × 인스턴스 수)로 느슨해진다. 단일 인스턴스 배포를 전제로 한 의도적인
 * 트레이드오프이며, 인스턴스가 늘어나면 공유 저장소(Redis 등)로 바꿔야 한다.
 */
const buckets = new Map<string, { count: number; resetAt: number }>();

/**
 * 만료된 버킷을 그냥 두면 고유 (라우트×IP) 조합이 늘어날 때마다 맵이 무한히 커진다(#118 —
 * 읽기 엔드포인트까지 이 모듈을 쓰기 시작하면서 키 종류가 5배로 늘었다). 호출 N번마다 한 번씩
 * 만료된 항목을 쓸어내 평균 메모리 사용량에 상한을 둔다 — 매 호출 스윕(O(n) 비용 매번)과
 * 영구 보관(무한 증가) 사이의 절충이다. 1000번째 호출마다 그 요청 하나가 O(n) 스윕 비용을
 * 떠안는다 — 실제 맵 크기(수천 건 수준)에서는 마이크로초 단위라 응답 지연에 체감되는
 * 영향은 없다고 보고 요청 경로 밖으로 분리하지 않았다.
 */
const SWEEP_EVERY_N_CALLS = 1000;
let callsSinceSweep = 0;

function sweepExpiredBuckets(now: number): void {
  for (const [key, entry] of buckets) {
    if (entry.resetAt <= now) buckets.delete(key);
  }
}

export type RateLimitResult = { allowed: boolean; retryAfterSeconds: number };

export function checkRateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();

  callsSinceSweep += 1;
  if (callsSinceSweep >= SWEEP_EVERY_N_CALLS) {
    callsSinceSweep = 0;
    sweepExpiredBuckets(now);
  }

  const entry = buckets.get(key);

  if (!entry || entry.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  if (entry.count >= limit) {
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)) };
  }

  entry.count += 1;
  return { allowed: true, retryAfterSeconds: 0 };
}

/**
 * 요청에서 레이트리밋 키로 쓸 클라이언트 IP를 뽑는다.
 *
 * x-forwarded-for의 맨 앞 값은 클라이언트가 직접 써서 보낼 수 있어 신뢰할 수 없다 —
 * "X-Forwarded-For: 아무값"을 요청마다 바꿔 보내면 매번 새 레이트리밋 버킷으로 떨어져
 * 한도가 무력화된다. Vercel 같은 단일 신뢰 홉 배포에서는 엣지가 실제로 관찰한 연결 IP를
 * 체인 맨 끝에 덧붙이므로 그 값만 신뢰한다 — backend/server.ts의 `trust proxy: 1`
 * (신뢰 홉 1개)과 같은 가정이다.
 *
 * x-real-ip는 x-forwarded-for와 달리 Vercel이 덧붙이거나 검증해 준다는 보장이 없는
 * 임의 요청 헤더다 — 그대로 신뢰하면 "X-Real-Ip: 아무값"을 매 요청 바꿔 보내는 것만으로
 * 레이트리밋이 완전히 무력화된다. 그래서 쓰지 않는다.
 */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const hops = forwarded.split(",").map((value) => value.trim()).filter(Boolean);
    if (hops.length) return hops[hops.length - 1]!;
  }
  return "unknown";
}

/** 공개 읽기 엔드포인트 공용 한도(#118) — 쓰기(20회/분)보다 넉넉하게 잡아 정상적인 탐색은 막지 않는다. */
export const READ_RATE_LIMIT = 60;
export const READ_RATE_LIMIT_WINDOW_MS = 60_000;

/**
 * DB를 직접 조회하는 공개 GET 라우트 공용 레이트리밋(#118). 라우트별로 흩어진 동일한
 * checkRateLimit 호출/429 응답 조립을 한 곳으로 모은다. 허용되면 null, 초과하면 429
 * NextResponse를 돌려준다.
 */
export function enforceReadRateLimit(request: Request, routeKey: string): NextResponse | null {
  const result = checkRateLimit(`read:${routeKey}:${clientIp(request)}`, READ_RATE_LIMIT, READ_RATE_LIMIT_WINDOW_MS);
  if (result.allowed) return null;

  return NextResponse.json(
    { error: "too many requests" },
    { status: 429, headers: { "retry-after": String(result.retryAfterSeconds) } }
  );
}
