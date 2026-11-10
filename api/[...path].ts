import express from "express";
import app from "../backend/server.ts";

// Vercel maps catch-all API functions to every /api/* request.
void express;

export default function handler(request: Parameters<typeof app>[0], response: Parameters<typeof app>[1]) {
  if (!request.url?.startsWith("/api")) request.url = `/api${request.url ?? "/"}`;
  return app(request, response);
}
