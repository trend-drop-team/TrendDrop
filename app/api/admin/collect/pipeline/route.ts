import { NextResponse } from "next/server";

import { isDbConfigured } from "@/db";
import { ensureDatabaseTables } from "@/lib/db-setup";
import { collectTrendPipeline } from "@/lib/trend-pipeline";

export async function POST(request: Request) {
  if (!isDbConfigured()) return NextResponse.json({ error: "DATABASE_URL is not configured" }, { status: 400 });
  const body = await request.json().catch(() => ({}));
  try {
    await ensureDatabaseTables();
    return NextResponse.json({ ok: true, ...(await collectTrendPipeline({ geo: body.geo ?? "KR", limit: body.limit ?? 10 })) });
  } catch (error) {
    return NextResponse.json({ ok: false, error: "Trend pipeline failed", detail: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}
