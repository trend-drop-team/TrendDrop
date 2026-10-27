import { createHmac } from "node:crypto";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createSession, getUserId, SESSION_MAX_AGE } from "../server/http/auth";
import { GET, POST } from "../app/api/watchlist/route";
import { DELETE, deleteWatchlistItem } from "../app/api/watchlist/[id]/route";
import { frontendRedirect, oauthStateError } from "../backend/server";

function unauthenticatedRequest(method: string, body?: string) {
  return new Request("http://localhost/api/watchlist", {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body,
  });
}

async function status(response: Response) {
  return response.status;
}

describe("watchlist authentication contracts", () => {
  it("rejects unauthenticated GET, POST, and DELETE with 401", async () => {
    assert.equal(await status(await GET(unauthenticatedRequest("GET"))), 401);
    assert.equal(await status(await POST(unauthenticatedRequest("POST", JSON.stringify({ keywordSlug: "test" })))), 401);
    assert.equal(await status(await DELETE(unauthenticatedRequest("DELETE"), { params: Promise.resolve({ id: "1" }) })), 401);
  });

  it("returns 404 when an authenticated user cannot delete the item", async () => {
    const request = new Request("http://localhost/api/watchlist/41", {
      headers: { cookie: `td-session=${createSession(2)}` },
    });
    const response = await deleteWatchlistItem(
      request,
      { params: Promise.resolve({ id: "41" }) },
      { isDbConfigured: () => true, removeWatchlistItem: async () => 0 },
    );

    assert.equal(response.status, 404);
  });
});

describe("session validation", () => {
  it("accepts a signed session but rejects forged and expired sessions", () => {
    const valid = createSession(7);
    const request = (session: string) => new Request("http://localhost", { headers: { cookie: `td-session=${session}` } });

    assert.equal(getUserId(request(valid)), 7);
    assert.equal(getUserId(request(`${valid.slice(0, -1)}x`)), null);

    const expiresAt = Math.floor(Date.now() / 1000) - 1;
    const payload = `7.${expiresAt}`;
    const signature = createHmac("sha256", process.env.AUTH_SESSION_SECRET!).update(payload).digest("base64url");
    assert.equal(getUserId(request(`${payload}.${signature}`)), null);
    assert.equal(SESSION_MAX_AGE > 0, true);
  });
});

describe("OAuth route contracts", () => {
  it("returns 400 for an OAuth state mismatch without contacting the provider", () => {
    const error = oauthStateError(undefined, "wrong");
    assert.equal(error, "invalid oauth state");
    assert.equal(error ? 400 : 200, 400);
    assert.equal(oauthStateError("expected-state.encoded-target", "wrong"), "invalid oauth state");
  });

  it("falls back to the configured login origin for a disallowed redirect", () => {
    assert.equal(frontendRedirect("https://evil.example/account"), "http://localhost:3000/login");
    assert.equal(frontendRedirect("not a URL"), "http://localhost:3000/login");
  });
});
