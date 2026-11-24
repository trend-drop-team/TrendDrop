import { setTimeout as delay } from "node:timers/promises";

export const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "claude-haiku-5-5";

/** 기존 OpenAPI형 스키마를 Claude의 제한된 JSON Schema로 변환한다. */
export function toJsonSchema(value) {
  if (Array.isArray(value)) return value.map(toJsonSchema);
  if (!value || typeof value !== "object") return value;
  const out = Object.fromEntries(Object.entries(value).map(([key, item]) =>
    [key, key === "type" && typeof item === "string" ? item.toLowerCase() : toJsonSchema(item)]));
  if (out.type === "object") out.additionalProperties = false;
  return out;
}

export async function generateJson(model, system, user, schema, { onUsage } = {}) {
  if (!process.env.ANTHROPIC_API_KEY) throw Object.assign(new Error("ANTHROPIC_API_KEY 미설정"), { status: 401 });
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model, max_tokens: 8192, system, messages: [{ role: "user", content: user }],
      thinking: { type: "disabled" },
      output_config: { format: { type: "json_schema", schema: toJsonSchema(schema) } } }),
    signal: AbortSignal.timeout(180_000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw Object.assign(new Error(`Claude ${response.status}: ${body?.error?.message ?? "API 요청 실패"}`), { status: response.status });
  onUsage?.(body.usage ?? {});
  if (body.stop_reason !== "end_turn") throw new Error(`Claude 응답 미완료: ${body.stop_reason ?? "unknown"}`);
  const text = body.content?.filter((block) => block.type === "text").map((block) => block.text).join("");
  if (!text) throw new Error("Claude 응답에 JSON 텍스트가 없습니다.");
  return JSON.parse(text);
}

/** 정상 호출 1회. 일시적 오류만 5초 뒤 한 번 재시도한다. */
export async function generateJsonWithRetry(model, system, user, schema, { generate = generateJson, wait = delay } = {}) {
  try { return await generate(model, system, user, schema); }
  catch (error) {
    if (![429, 500, 502, 503, 504, 529].includes(error.status) && error.name !== "TimeoutError") throw error;
    await wait(5000);
    return generate(model, system, user, schema);
  }
}
