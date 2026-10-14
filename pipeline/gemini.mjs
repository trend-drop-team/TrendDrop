/**
 * Gemini 호출 공용 도구 — 글 단위 이슈 추출(issues.mjs)과 최종 검수가 쓴다.
 *
 * env: GEMINI_API_KEY(필수)
 *      EXTRACT_MODELS  추출용 모델 순서(쉼표 구분). 기본 Lite 2종
 *      REVIEW_MODELS   검수용 모델 순서. 기본 Flash 3종 → Lite
 *
 * 무료 한도는 모델마다 따로다(trenddrop 프로젝트, AI Studio 실측 2026-10-14):
 *   gemini-3.8-flash / 3.7-flash / 3.6-flash   각 5 RPM · 20 RPD
 *   gemini-3.5-flash-lite / 3.1-flash-lite     각 15 RPM · 500 RPD
 * 추출은 매시간 1~2회(새 글 50개 단위) → 하루 ~50회라 Lite가 맡는다.
 *   정답 세트 30/30을 Lite(issue-v8)로 통과했다.
 * 검수는 매시간 1회 → 하루 24회. 판단이 섬세해서 Flash급부터 시도한다.
 *   (Lite 검수는 3회 중 2회 멀쩡한 후보를 빼거나 잘못 묶었다)
 * 앞 모델이 과부하(503)·한도 초과(429)·타임아웃으로 실패하면 다음 모델로 넘긴다.
 * 무료 등급은 입력이 Google 제품 개선에 쓰일 수 있다. 공개 게시글 제목만 보내므로 무방.
 */
const list = (v) => v.split(",").map((m) => m.trim()).filter(Boolean);

export const EXTRACT_MODELS = list(
  process.env.EXTRACT_MODELS || "gemini-3.5-flash-lite,gemini-3.1-flash-lite"
);
export const REVIEW_MODELS = list(
  process.env.REVIEW_MODELS || "gemini-3.8-flash,gemini-3.7-flash,gemini-3.6-flash,gemini-3.5-flash-lite"
);

const ENDPOINT = (model) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

/**
 * models를 앞에서부터 시도한다. 성공하면 { result, model, fallbackReason }.
 * fallbackReason은 첫 모델이 아닌 모델이 답했을 때 앞 모델들의 실패 사유(성공이면 null).
 * 400/401/403은 키·요청 문제라 모델을 바꿔도 같으므로 바로 throw. 전부 실패해도 throw.
 */
export async function withModelFallback(fn, models) {
  const failures = [];
  for (const model of models) {
    try {
      const result = await fn(model);
      return { result, model, fallbackReason: failures.length ? failures.join(" / ") : null };
    } catch (err) {
      if ([400, 401, 403].includes(err.status)) throw err;
      failures.push(`${model}: ${String(err.message).slice(0, 80)}`);
    }
  }
  throw new Error(failures.join(" / "));
}

/**
 * Gemini generateContent 1회 — JSON 스키마로 응답을 받아 파싱해 돌려준다.
 * 실패하면 throw (HTTP 오류면 err.status에 상태 코드).
 */
export async function generateJson(model, system, userText, schema) {
  if (!process.env.GEMINI_API_KEY) {
    const err = new Error("GEMINI_API_KEY 미설정");
    err.status = 401;
    throw err;
  }
  const res = await fetch(ENDPOINT(model), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-goog-api-key": process.env.GEMINI_API_KEY,
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: userText }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: schema,
        maxOutputTokens: 32000,
      },
    }),
    // Flash는 후보 28개에 74초가 걸렸다(2026-10-14 실측). 3분 넘으면 끊고 다음 모델로 넘긴다.
    signal: AbortSignal.timeout(180_000),
  });

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    // 400/401/403 = 키 문제, 429 = 무료 한도 초과, 503 = 과부하
    const err = new Error(`${res.status} ${body?.error?.status ?? ""} ${body?.error?.message ?? ""}`.trim());
    err.status = res.status;
    throw err;
  }
  if (body?.promptFeedback?.blockReason) {
    throw new Error(`응답 거부됨: ${body.promptFeedback.blockReason}`);
  }
  const candidate = body?.candidates?.[0];
  if (candidate?.finishReason && candidate.finishReason !== "STOP") {
    throw new Error(`응답이 중간에 끊김: ${candidate.finishReason}`);
  }
  const text = candidate?.content?.parts?.map((p) => p.text ?? "").join("");
  if (!text) throw new Error("응답에 텍스트가 없음");
  return JSON.parse(text);
}
