import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";

import { getCategories } from "@/server/services/category.service";
import { getHeatmap } from "@/server/services/heatmap.service";
import { getKeywordDetail, getKeywordHistory } from "@/server/services/keyword.service";
import { getTimeline, getTrends } from "@/server/services/trend.service";
import { NotFoundError } from "@/server/http/not-found";
import { parseLimit, parsePeriod, parseRunId, parseWindowHours } from "@/server/http/query";

const app = express();
// Render and other PaaS providers inject PORT; BACKEND_PORT is kept for local development.
const port = Number(process.env.PORT ?? process.env.BACKEND_PORT ?? 4000);

/**
 * CORS 허용 출처.
 *
 * 어떤 경우에도 `origin: true`(전체 허용)로 떨어지지 않는다. NODE_ENV 값에 기대어
 * 막으면, NODE_ENV가 비거나 다른 값인 환경(수동 재배포, 다른 PaaS로 이전 등)에서
 * 가드가 조용히 꺼지고 전체 개방으로 돌아간다. 설정이 없을 때의 기본값 자체를
 * 닫힌 쪽(로컬 주소만)으로 두어, 최악의 경우에도 "열리는" 게 아니라 "막히는" 쪽으로 넘어지게 한다.
 */
const DEV_ORIGIN = "http://localhost:3000";
const frontendOrigin = process.env.FRONTEND_ORIGIN?.split(",").map((value) => value.trim()).filter(Boolean);

if (!frontendOrigin?.length && process.env.NODE_ENV !== "development") {
  throw new Error("FRONTEND_ORIGIN is not set. 허용할 프론트 주소를 쉼표로 구분해 넣어야 합니다.");
}

app.disable("x-powered-by");
app.use(cors({ origin: frontendOrigin?.length ? frontendOrigin : [DEV_ORIGIN] }));
app.use(express.json());

app.get("/health", (_request, response) => response.json({ ok: true }));

app.get("/api/categories", async (_request, response, next) => {
  try { response.json(await getCategories()); } catch (error) { next(error); }
});

app.get("/api/trends", async (request, response, next) => {
  try {
    const { period, category, limit, runId } = request.query;
    response.json(await getTrends({
      period: parsePeriod(typeof period === "string" ? period : null),
      category: typeof category === "string" ? category : undefined,
      limit: parseLimit(typeof limit === "string" ? limit : null),
      runId: parseRunId(typeof runId === "string" ? runId : null),
    }));
  } catch (error) { next(error); }
});

app.get("/api/trends/timeline", async (request, response, next) => {
  try {
    const value = request.query.limit;
    response.json(await getTimeline(parseLimit(typeof value === "string" ? value : null)));
  } catch (error) { next(error); }
});

app.get("/api/explore/heatmap", async (request, response, next) => {
  try {
    const value = request.query.window;
    response.json(await getHeatmap(parseWindowHours(typeof value === "string" ? value : null)));
  } catch (error) { next(error); }
});

app.get("/api/keywords/:slug", async (request, response, next) => {
  try { response.json(await getKeywordDetail(decodeURIComponent(request.params.slug))); } catch (error) { next(error); }
});

app.get("/api/keywords/:slug/history", async (request, response, next) => {
  try {
    const value = request.query.window;
    response.json(await getKeywordHistory(
      decodeURIComponent(request.params.slug),
      parseWindowHours(typeof value === "string" ? value : null),
    ));
  } catch (error) { next(error); }
});

// 매치되지 않은 경로. 없으면 Express 기본 404가 프레임워크를 그대로 드러낸다.
app.use((_request, response) => {
  response.status(404).json({ error: "not found" });
});

/**
 * 에러 → 상태 코드 변환.
 *
 * 에러 메시지를 정규식으로 훑어 상태를 정하지 않는다 — 서비스 쪽 문구를 한 줄 고치면
 * 404가 조용히 500이 되고, 그 404에 기대는 상세 페이지의 notFound() 처리가 같이 깨진다.
 * 타입으로만 가른다.
 *
 * 500일 때 내부 메시지를 그대로 내려보내지 않는다(DB 접속 문자열 등이 섞여 나갈 수 있다).
 * 원인은 서버 로그에만 남긴다.
 */
app.use((error: unknown, request: Request, response: Response, _next: NextFunction) => {
  if (error instanceof NotFoundError) {
    response.status(404).json({ error: "not found" });
    return;
  }

  console.error(`[api] ${request.method} ${request.originalUrl} failed:`, error);
  response.status(500).json({ error: "Internal server error" });
});

app.listen(port, () => console.log(`TrendDrop API listening on http://localhost:${port}`));
