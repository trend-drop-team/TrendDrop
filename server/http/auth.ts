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

function verifySession(value: string): number | null {
  const [userId, expiresAt, signature] = value.split(".");
  if (!userId || !expiresAt || !signature || Number(expiresAt) < Date.now() / 1000) return null;
  const payload = `${userId}.${expiresAt}`;
  const expected = sign(payload);
  if (!expected || expected.length !== signature.length) return null;
  if (!timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) return null;
  const parsed = Number(userId);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

type AuthRequest = Request | ExpressRequest;

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
  const rawHeader = headerValue(request, "x-user-id");
  const header = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
  if (header) {
    const value = Number.parseInt(header, 10);
    if (Number.isFinite(value) && value > 0) return value;
  }

  const session = readCookie(request, "td-session");
  return session ? verifySession(session) : null;
}

export { SESSION_MAX_AGE };
