import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";

import { getCategories } from "@/server/services/category.service";
import { getHeatmap } from "@/server/services/heatmap.service";
import { getKeywordDetail, getKeywordHistory } from "@/server/services/keyword.service";
import { getTimeline, getTrends } from "@/server/services/trend.service";
import { parseLimit, parsePeriod, parseRunId, parseWindowHours } from "@/server/http/query";

const app = express();
// Render and other PaaS providers inject PORT; BACKEND_PORT is kept for local development.
const port = Number(process.env.PORT ?? process.env.BACKEND_PORT ?? 4000);

app.use(cors({ origin: process.env.FRONTEND_ORIGIN?.split(",") ?? true }));
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

app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
  const message = error instanceof Error ? error.message : "Internal server error";
  const status = /not found/i.test(message) ? 404 : /invalid|must be|between/i.test(message) ? 400 : 500;
  response.status(status).json({ error: message });
});

app.listen(port, () => console.log(`TrendDrop API listening on http://localhost:${port}`));
