import express from "express";
import app from "../backend/server.ts";

// Keep the framework import explicit for Vercel's Express entrypoint detection.
void express;

export default function handler(request: Parameters<typeof app>[0], response: Parameters<typeof app>[1]) {
  if (!request.url?.startsWith("/api")) request.url = `/api${request.url ?? "/"}`;
  return app(request, response);
}
