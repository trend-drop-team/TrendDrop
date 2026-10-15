import cors from "cors";
import { randomBytes } from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import { eq } from "drizzle-orm";

import { getCategories } from "@/server/services/category.service";
import { getHeatmap } from "@/server/services/heatmap.service";
import { getKeywordDetail, getKeywordHistory } from "@/server/services/keyword.service";
import { getTimeline, getTrends } from "@/server/services/trend.service";
import { addWatchlistItem, getWatchlist, removeWatchlistItem } from "@/server/services/watchlist.service";
import { NotFoundError } from "@/server/http/not-found";
import { parseLimit, parsePeriod, parseRunId, parseWindowHours } from "@/server/http/query";
import { createSession, getUserId, SESSION_MAX_AGE } from "@/server/http/auth";
import { getDb, isDbConfigured } from "@/db";
import { users } from "@/db/schema";

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
app.use(cors({ origin: frontendOrigin?.length ? frontendOrigin : [DEV_ORIGIN], credentials: true }));
app.use(express.json());
/**
 * express.json()이 던지는 에러는 공통 에러 핸들러(500)보다 먼저 잡는다.
 *
 * body-parser는 파싱 실패(400)뿐 아니라 너무 큰 본문(413), 지원 안 하는 인코딩(415)도
 * 같은 방식(status 달린 에러)으로 던진다. SyntaxError만 보면 413/415는 걸러지지 않고
 * 그대로 500으로 새어 나간다 — status가 있는 4xx는 전부 여기서 받는다.
 */
app.use((error: unknown, _request: Request, response: Response, next: NextFunction) => {
  const status = (error as { status?: unknown })?.status;
  if (typeof status === "number" && status >= 400 && status < 500) {
    response.status(status).json({ error: "invalid request body" });
    return;
  }
  next(error);
});

const oauthProviders = {
  kakao: {
    authorize: "https://kauth.kakao.com/oauth/authorize",
    token: "https://kauth.kakao.com/oauth/token",
    profile: "https://kapi.kakao.com/v2/user/me",
    clientId: "KAKAO_CLIENT_ID",
    clientSecret: "KAKAO_CLIENT_SECRET",
  },
  google: {
    authorize: "https://accounts.google.com/o/oauth2/v2/auth",
    token: "https://oauth2.googleapis.com/token",
    profile: "https://openidconnect.googleapis.com/v1/userinfo",
    clientId: "GOOGLE_CLIENT_ID",
    clientSecret: "GOOGLE_CLIENT_SECRET",
  },
} as const;

function frontendRedirect(value: unknown) {
  const fallback = frontendOrigin?.[0] ?? DEV_ORIGIN;
  if (typeof value !== "string") return `${fallback}/login`;
  try {
    const url = new URL(value);
    if (frontendOrigin?.includes(url.origin) || (!frontendOrigin?.length && url.origin === DEV_ORIGIN)) return url.toString();
  } catch { /* invalid redirect falls back safely */ }
  return `${fallback}/login`;
}

app.get("/api/auth/me", async (request, response, next) => {
  try {
    const userId = getUserId(request);
    if (userId === null) { response.status(401).json({ error: "not authenticated" }); return; }
    const user = (await getDb().select({ id: users.id, email: users.email, name: users.name }).from(users).where(eq(users.id, userId)).limit(1))[0];
    if (!user) { response.status(401).json({ error: "not authenticated" }); return; }
    response.json({ data: user });
  } catch (error) { next(error); }
});

app.get("/api/auth/:provider", async (request, response, next) => {
  try {
    const provider = oauthProviders[request.params.provider as keyof typeof oauthProviders];
    if (!provider) { response.status(404).json({ error: "unsupported provider" }); return; }
    const redirectUri = frontendRedirect(request.query.redirect_uri);
    const callbackUri = `${request.protocol}://${request.get("host")}/api/auth/${request.params.provider}/callback`;
    const state = randomBytes(24).toString("base64url");
    response.cookie("td-oauth-state", `${state}.${Buffer.from(redirectUri).toString("base64url")}`, {
      httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 600000,
    });
    const params = new URLSearchParams({ client_id: process.env[provider.clientId] ?? "", redirect_uri: callbackUri, response_type: "code", state });
    if (request.params.provider === "google") params.set("scope", "openid email profile");
    // 카카오의 동의항목은 앱 설정에서 활성화한 기본 동의항목으로 요청한다.
    // account_email/profile_nickname은 모든 앱에서 유효한 scope ID가 아니므로
    // scope 파라미터로 직접 보내면 INVALID_SCOPE가 발생할 수 있다.
    response.redirect(`${provider.authorize}?${params}`);
  } catch (error) { next(error); }
});

app.get("/api/auth/:provider/callback", async (request, response, next) => {
  try {
    const providerName = request.params.provider as keyof typeof oauthProviders;
    const provider = oauthProviders[providerName];
    if (!provider) { response.status(404).send("unsupported provider"); return; }
    const stateCookie = request.headers.cookie?.match(/(?:^|;\s*)td-oauth-state=([^;]+)/)?.[1];
    const [state] = decodeURIComponent(stateCookie ?? "").split(".");
    if (!state || state !== request.query.state) { response.status(400).send("invalid oauth state"); return; }
    const redirectTarget = frontendRedirect(Buffer.from(decodeURIComponent(stateCookie ?? "").split(".")[1] ?? "", "base64url").toString("utf8"));
    if (typeof request.query.error === "string") {
      response.clearCookie("td-oauth-state");
      response.redirect(`${redirectTarget}?error=${encodeURIComponent(request.query.error)}`);
      return;
    }
    if (typeof request.query.code !== "string") { response.status(400).send("authorization code missing"); return; }
    const callbackUri = `${request.protocol}://${request.get("host")}/api/auth/${providerName}/callback`;
    const tokenResponse = await fetch(provider.token, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", client_id: process.env[provider.clientId] ?? "", client_secret: process.env[provider.clientSecret] ?? "", redirect_uri: callbackUri, code: request.query.code }) });
    if (!tokenResponse.ok) throw new Error(`OAuth token exchange failed (${tokenResponse.status})`);
    const token = await tokenResponse.json() as { access_token?: string };
    if (!token.access_token) throw new Error("OAuth access token missing");
    const profileResponse = await fetch(provider.profile, { headers: { authorization: `Bearer ${token.access_token}` } });
    if (!profileResponse.ok) throw new Error(`OAuth profile request failed (${profileResponse.status})`);
    const profile = await profileResponse.json() as {
      id?: number;
      email?: string;
      name?: string;
      properties?: { nickname?: string };
      kakao_account?: { email?: string; name?: string; profile?: { nickname?: string } };
    };
    // 이메일 동의항목이 선택 동의이거나 계정에 이메일이 없을 수 있다.
    // users.email은 현재 NOT NULL/UNIQUE이므로 카카오 고유 ID를 내부 fallback으로 사용한다.
    const email = profile.email ?? profile.kakao_account?.email ?? (profile.id ? `kakao-${profile.id}@users.trenddrop.local` : null);
    const name = profile.name
      ?? profile.kakao_account?.name
      ?? profile.kakao_account?.profile?.nickname
      ?? profile.properties?.nickname
      ?? null;
    if (!email) throw new Error("OAuth provider did not return an email or user id");
    const db = getDb();
    const existing = await db.select({ id: users.id, name: users.name }).from(users).where(eq(users.email, email)).limit(1);
    const user = existing[0] ?? (await db.insert(users).values({ email, name }).returning({ id: users.id, name: users.name }))[0];
    if (!user) throw new Error("Unable to create user");
    if (existing[0] && name && name !== existing[0].name) {
      await db.update(users).set({ name, updatedAt: new Date() }).where(eq(users.id, user.id));
    }
    response.clearCookie("td-oauth-state");
    response.cookie("td-session", createSession(user.id), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: SESSION_MAX_AGE * 1000, path: "/" });
    response.redirect(`${redirectTarget}?success=1`);
  } catch (error) { next(error); }
});

app.post("/api/auth/logout", (_request, response) => { response.clearCookie("td-session"); response.status(204).end(); });

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

/** 로그인 여부를 확인하고, 아니면 401을 바로 써서 보낸다. 통과 시 userId를 돌려준다. */
function requireUserId(request: Request, response: Response): number | null {
  const userId = getUserId(request);
  if (userId === null) response.status(401).json({ error: "login required" });
  return userId;
}

/** 쓰기는 mock으로 대신할 수 없다 — DB 없이 성공을 돌려주면 저장된 척하는 UI가 된다. */
function requireDbConfigured(response: Response): boolean {
  if (isDbConfigured()) return true;
  response.status(500).json({ error: "watchlist requires a database", detail: "DATABASE_URL is not configured" });
  return false;
}

/** 3.6 GET /api/watchlist — 저장한 키워드 목록. */
app.get("/api/watchlist", async (request, response, next) => {
  try {
    const userId = requireUserId(request, response);
    if (userId === null) return;
    response.json(await getWatchlist(userId));
  } catch (error) { next(error); }
});

/** 3.6 POST /api/watchlist { keywordSlug } — 추가(중복은 기존 항목을 그대로 돌려준다). */
app.post("/api/watchlist", async (request, response, next) => {
  try {
    const userId = requireUserId(request, response);
    if (userId === null) return;
    if (!requireDbConfigured(response)) return;

    const { keywordSlug } = request.body as { keywordSlug?: unknown };
    if (typeof keywordSlug !== "string" || keywordSlug.trim() === "") {
      response.status(400).json({ error: "keywordSlug is required" });
      return;
    }

    const slug = keywordSlug.trim();
    const id = await addWatchlistItem(userId, slug);
    response.status(201).json({ data: { id, keywordSlug: slug } });
  } catch (error) { next(error); }
});

/** 3.6 DELETE /api/watchlist/:id — 삭제. 남의 항목이면 404(존재 여부를 흘리지 않는다). */
app.delete("/api/watchlist/:id", async (request, response, next) => {
  try {
    const userId = requireUserId(request, response);
    if (userId === null) return;
    if (!requireDbConfigured(response)) return;

    const itemId = Number.parseInt(request.params.id, 10);
    if (!Number.isFinite(itemId) || itemId <= 0) {
      response.status(400).json({ error: "invalid watchlist id" });
      return;
    }

    const removed = await removeWatchlistItem(userId, itemId);
    if (removed === 0) { response.status(404).json({ error: "watchlist item not found" }); return; }

    response.json({ data: { id: itemId } });
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
