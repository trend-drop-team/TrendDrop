import { apiUrl } from "@/lib/api-url";

/**
 * 백엔드 한 번 왕복에 허용할 최대 시간.
 *
 * SSR 페이지가 전부 이 함수를 타므로, 백엔드가 자고 있거나(Render free 플랜은
 * 15분 무요청이면 내려가고 재기동에 50초 넘게 걸린다) 느려지면 타임아웃이 없는 한
 * 페이지 렌더가 통째로 그만큼 멈춘다. 호스팅 함수 제한에 먼저 걸려 500이 되느니,
 * 우리가 먼저 끊고 에러 바운더리(app/error.tsx)로 보내는 편이 낫다.
 */
const TIMEOUT_MS = 8_000;

/**
 * 기본 재검증 주기(초).
 *
 * 데이터를 바꾸는 쪽은 수집 파이프라인뿐이고 주기가 1시간(collect)/2시간(rank)이다.
 * 매 요청마다 프론트 → 백엔드 → DB를 왕복할 이유가 없다.
 */
const REVALIDATE_SECONDS = 60;

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/**
 * 대상이 없다 — 장애가 아니라 정상적인 답이다.
 * 화면은 이걸 잡아 `notFound()`로 보낸다(에러 바운더리로 새지 않게).
 */
export class ApiNotFoundError extends ApiError {
  constructor(message = "not found") {
    super(message, 404);
    this.name = "ApiNotFoundError";
  }
}

type FetchOptions = {
  /** 초 단위 재검증 주기. 0이면 매 요청 새로 가져온다. */
  revalidate?: number;
  timeoutMs?: number;
};

export async function fetchApi<T>(path: string, options: FetchOptions = {}): Promise<T> {
  const { revalidate = REVALIDATE_SECONDS, timeoutMs = TIMEOUT_MS } = options;

  let response: Response;

  try {
    response = await fetch(apiUrl(path), {
      signal: AbortSignal.timeout(timeoutMs),
      next: { revalidate },
    });
  } catch (error) {
    // 시간 초과는 TimeoutError, 연결 실패는 TypeError로 온다.
    // 화면 입장에선 둘 다 "백엔드에 못 닿았다" 하나이므로 503으로 묶는다.
    const reason = error instanceof Error ? error.message : "unknown error";
    throw new ApiError(`백엔드에 연결하지 못했습니다 (${path}): ${reason}`, 503);
  }

  if (!response.ok) {
    const message = (await readErrorMessage(response)) ?? `API request failed: ${response.status}`;
    if (response.status === 404) throw new ApiNotFoundError(message);
    throw new ApiError(message, response.status);
  }

  return response.json() as Promise<T>;
}

/**
 * 실패해도 화면을 죽이면 안 되는 조회용.
 *
 * 루트 레이아웃처럼 "없어도 본문은 보여야 하는" 자리에서 쓴다. 부가 기능(커맨드 팔레트
 * 검색 목록 등) 하나 때문에 모든 페이지가 500으로 떨어지는 걸 막는다.
 * 본문 데이터에는 쓰지 말 것 — 빈 화면을 정상인 척 보여주게 된다.
 */
export async function fetchApiOr<T>(path: string, fallback: T, options: FetchOptions = {}): Promise<T> {
  try {
    return await fetchApi<T>(path, options);
  } catch (error) {
    console.error(`[api] optional fetch failed, falling back (${path}):`, error);
    return fallback;
  }
}

/** 에러 응답 body의 `{ error }`를 꺼낸다. JSON이 아니면 상태 코드 문구로 대신한다. */
async function readErrorMessage(response: Response): Promise<string | null> {
  try {
    const payload = (await response.json()) as { error?: unknown };
    return typeof payload.error === "string" ? payload.error : null;
  } catch {
    return null;
  }
}
