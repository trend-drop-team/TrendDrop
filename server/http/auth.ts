import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request as ExpressRequest } from "express";

const SESSION_MAX_AGE = 60 * 60 * 24 * 30;

function sessionSecret() {
  return process.env.AUTH_SESSION_SECRET || (process.env.NODE_ENV === "development" ? "local-development-secret" : null);
}

function sign(value: string) {
  const secret = sessionSecret();
  if (!secret) return null;
  return createHmac("sha256", secret).update(value).digest("base64url");
}

export function createSession(userId: number) {
  const payload = `${userId}.${Math.floor(Date.now() / 1000) + SESSION_MAX_AGE}`;
  const signature = sign(payload);
  if (!signature) throw new Error("AUTH_SESSION_SECRET is not configured");
  return `${payload}.${signature}`;
}

/** 서명·만료만 확인하는 순수 디코드. createSession이 만료시각을 발급시각+SESSION_MAX_AGE로
 * 고정해서 만들므로(갱신·연장 없음), 발급시각은 토큰에 별도로 담지 않고 거꾸로 계산한다 —
 * 토큰 포맷을 바꾸면 이미 발급된 세션이 전부 깨지므로 기존 payload 그대로 둔다. */
function decode(value: string): { userId: number; issuedAt: number } | null {
  const [userId, expiresAt, signature] = value.split(".");
  if (!userId || !expiresAt || !signature || Number(expiresAt) < Date.now() / 1000) return null;
  const payload = `${userId}.${expiresAt}`;
  const expected = sign(payload);
  if (!expected || expected.length !== signature.length) return null;
  if (!timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) return null;
  const parsed = Number(userId);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return { userId: parsed, issuedAt: Number(expiresAt) - SESSION_MAX_AGE };
}

export function verifySession(value: string): number | null {
  return decode(value)?.userId ?? null;
}

/** 세션 폐기 판정(#94)에 발급시각이 필요한 호출부용. 서명·만료 검증은 decode()와 동일하다 —
 * 폐기 여부는 이 모듈이 모르는 DB 상태에 달려 있어 여기서 판단하지 않고 값만 내준다. */
export function decodeSession(value: string): { userId: number; issuedAt: number } | null {
  return decode(value);
}

export type AuthRequest = Request | ExpressRequest;

function headerValue(request: AuthRequest, name: string) {
  if (typeof request.headers.get === "function") return request.headers.get(name);
  return (request.headers as ExpressRequest["headers"])[name];
}

function readCookie(request: AuthRequest, name: string) {
  const raw = headerValue(request, "cookie");
  const value = Array.isArray(raw) ? raw.join("; ") : raw ?? "";
  return new RegExp(`(?:^|;\\s*)${name}=([^;]+)`).exec(value)?.[1] ?? null;
}

export function getUserId(request: AuthRequest): number | null {
  const session = readCookie(request, "td-session");
  return session ? verifySession(session) : null;
}

/** getUserId와 동일하게 요청에서 쿠키를 읽지만, 세션 폐기 판정에 쓸 발급시각까지 함께 돌려준다. */
export function getUserIdAndIssuedAt(request: AuthRequest): { userId: number; issuedAt: number } | null {
  const session = readCookie(request, "td-session");
  return session ? decode(session) : null;
}

export { SESSION_MAX_AGE };
