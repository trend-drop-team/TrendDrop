function requireEnv(name: string) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is not set`);
  }

  return value;
}

export function hasDatabaseUrl() {
  return Boolean(process.env.DATABASE_URL);
}

export function getDatabaseUrl() {
  return requireEnv("DATABASE_URL");
}

/**
 * DB가 없거나 비었을 때 mock 데모 데이터로 대신 채워도 되는가.
 *
 * 개발·테스트에서만 허용한다. 운영(production)에서 mock을 내보내면 지어낸 순위가
 * 실데이터처럼 노출되므로, 운영은 빈 결과(DB는 있는데 비어 있음) 또는
 * 명시적 오류(DB 미설정, `requireDbUnlessMockAllowed`)로 처리한다.
 */
export function allowMockFallback() {
  return process.env.NODE_ENV !== "production";
}

/**
 * 운영에서 DB 설정이 빠졌으면 mock으로 조용히 넘어가지 않고 즉시 던진다.
 * 서비스 함수 맨 앞에서 부른다 — route의 handleRouteError가 500으로 노출한다.
 */
export function requireDbUnlessMockAllowed() {
  if (!hasDatabaseUrl() && !allowMockFallback()) {
    throw new Error("DATABASE_URL is not set — 운영(production)에서는 mock 데이터로 대체하지 않습니다.");
  }
}

export function hasYoutubeApiKey() {
  return Boolean(process.env.YOUTUBE_API_KEY);
}

export function getYoutubeApiKey() {
  return requireEnv("YOUTUBE_API_KEY");
}
