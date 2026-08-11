/**
 * LLM 판정 — 후보 키워드에서 노이즈를 걷어내고, 쪼개지거나 훼손된 것을 복원한다.
 *
 * 토크나이저는 "단어"를 뽑기 때문에 구조적으로 노이즈가 섞인다:
 *   버리기  같아서 · 혼자 · 일본 · 배우      (문법 조각, 장르 일반어)
 *   고치기  오디세 → 오디세이, 요한 → 변요한 (조사 제거·길이 필터가 훼손한 것)
 *   합치기  김윤희 + 아나운서 → 김윤희 아나운서
 *
 * 뒤 두 가지 때문에 단어만으로는 부족해서 예문 한 줄을 같이 보낸다.
 * 예문은 이미 랭킹 결과에 들어 있어(sample) 추가 수집 비용이 없다.
 *
 * 판정은 term 단위로 캐시한다. 창이 6시간인데 1시간씩만 밀려서 연속한 두 실행의
 * 후보가 85% 겹치기 때문에, 캐시가 없으면 같은 단어를 매시간 다시 묻게 된다.
 *
 * env: ANTHROPIC_API_KEY(없으면 필터 전체를 건너뛴다), VERDICT_MODEL, VERDICT_EFFORT
 */
import { loadVerdicts, saveVerdicts } from "./store.mjs";

const MODEL = process.env.VERDICT_MODEL || "claude-sonnet-5";
const EFFORT = process.env.VERDICT_EFFORT || "medium";

/** 판정 가능한 카테고리. LLM은 이 중 하나를 고르기만 한다. */
export const CATEGORIES = [
  "인물",
  "작품·콘텐츠",
  "기업·주식",
  "사건·사고",
  "재난·속보",
  "정치·사회",
  "스포츠",
  "일반어",
  "문법조각",
];

/**
 * 카테고리별 점수 계수. 숫자는 여기(코드)에 있고 LLM은 이름표만 붙인다.
 * LLM이 점수를 직접 매기면 같은 단어가 매시간 다른 점수를 받아 순위가 흔들린다.
 *
 * 현재 전부 1.0 = 필터·병합만 하고 점수엔 개입하지 않음.
 * 카테고리는 캐시에 쌓이므로, 나중에 이 숫자만 바꾸면 API 재호출 없이 반영된다.
 */
export const CATEGORY_WEIGHTS = {
  "인물": 1.0,
  "작품·콘텐츠": 1.0,
  "기업·주식": 1.0,
  "사건·사고": 1.0,
  "재난·속보": 1.0,
  "정치·사회": 1.0,
  "스포츠": 1.0,
  "일반어": 1.0,
  "문법조각": 1.0,
};

const SYSTEM = `당신은 한국 트렌드 랭킹 서비스의 키워드 심사자다.

커뮤니티 게시글 제목·댓글에서 기계적으로 뽑은 단어 후보를 받아, 트렌드 키워드로
쓸 수 있는지 판정한다. 각 후보에는 그 단어가 등장한 원문 한 줄이 함께 온다.

## keep = false 로 버릴 것
- 문법 조각: 조사·어미가 붙어 남은 덩어리 (같아서, 하면, 나오면, 생각하)
- 일반 부사·대명사: 혼자, 자꾸, 제발, 바로, 아니
- 장르·범주 일반어: 배우, 드라마, 영화, 신인, 출연진
- 맥락 없는 국가·지역명: 원문이 그 나라에 관한 이슈가 아니라 배경으로만 쓰였을 때
  ("한때 일본 여학생들의 체육복" → 일본은 버림 / "한일 정상회담 합의" → 일본은 유지)
- 원문에서 의미를 이루지 못하는 영어 파편: like, pretty

## keep = true 로 남길 것
고유명사이거나 특정 사건·작품·상품을 가리키는 것. 인물, 그룹, 기업, 작품 제목,
사건명, 제도·정책명, 지명이 실제 이슈의 주체일 때.

## canonical — 복원하거나 합칠 때만 채운다
- 훼손 복원: 토크나이저가 조사를 떼거나 짧은 성씨를 날린 경우, 원문을 보고 되살린다.
  "오디세"(원문: 오디세이 흥행 질주) → canonical: "오디세이"
  "요한"(원문: 변 요한) → canonical: "변요한"
- 분리 병합: 한 대상이 여러 단어로 쪼개졌으면 같은 canonical을 준다.
  "김윤희"와 "아나운서"가 모두 원문 "김윤희 아나운서"에서 왔다면 둘 다 "김윤희 아나운서"
- **줄임말·은어 확장**: 커뮤니티에서 굳어진 축약형은 버리지 말고 정식 명칭으로 펼친다.
  이런 단어는 낯설어 보여도 실제 대상을 가리키므로 keep=true 다.
  "하닉" → "SK하이닉스" / "삼전" → "삼성전자" / "올영" → "올리브영" / "갤워치" → "갤럭시워치"
  단, 펼칠 정식 명칭이 따로 없는 고유 조어는 그대로 둔다. ("삼전닉스"는 레버리지 상품명)
- 손댈 필요 없으면 null. 멀쩡한 단어를 굳이 바꾸지 않는다.

**모르는 단어를 일반어로 처리하지 말 것.** 판별이 어려우면 예문의 맥락을 먼저 본다.
특정 대상을 가리키는 것으로 읽히면 keep=true 다. 문법 조각이나 흔한 일반명사일 때만 버린다.

## category
${CATEGORIES.join(" / ")} 중 하나. keep=false면 일반어 또는 문법조각.

## reason
왜 그렇게 판정했는지 한국어 한 문장. 짧게.

원문에 없는 사실을 추측해서 만들지 말 것. 판단 근거는 주어진 예문뿐이다.`;

const SCHEMA = {
  type: "object",
  properties: {
    verdicts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          term: { type: "string" },
          keep: { type: "boolean" },
          canonical: { anyOf: [{ type: "string" }, { type: "null" }] },
          category: { type: "string", enum: CATEGORIES },
          reason: { type: "string" },
        },
        required: ["term", "keep", "canonical", "category", "reason"],
        additionalProperties: false,
      },
    },
  },
  required: ["verdicts"],
  additionalProperties: false,
};

/** 후보 한 줄을 프롬프트용 텍스트로. */
function formatCandidate(k) {
  const src = k.sources.map((s) => s.source).join(",");
  const sample = (k.sample ?? "").replace(/\s+/g, " ").slice(0, 90);
  return `- ${k.term} | 점수 ${k.score} | 소스 ${src} | 예문: ${sample}`;
}

/**
 * 미판정 후보를 LLM에 한 번에 물어본다. 실패하면 throw.
 * 반환: [{ term, keep, canonical, category, reason }]
 */
export async function judgeTerms(candidates) {
  if (candidates.length === 0) return [];
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic();

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 16000,
    system: SYSTEM,
    output_config: { effort: EFFORT, format: { type: "json_schema", schema: SCHEMA } },
    messages: [
      {
        role: "user",
        content:
          `다음 ${candidates.length}개 후보를 판정해줘. 빠짐없이 전부 답해야 한다.\n\n` +
          candidates.map(formatCandidate).join("\n"),
      },
    ],
  });

  if (response.stop_reason === "refusal") {
    throw new Error(`판정 거부됨: ${response.stop_details?.category ?? "unknown"}`);
  }
  const text = response.content.find((b) => b.type === "text")?.text;
  if (!text) throw new Error("응답에 텍스트 블록이 없음");
  const parsed = JSON.parse(text);
  return parsed.verdicts ?? [];
}

/**
 * 후보 목록에 판정을 적용해 최종 top-N을 만든다.
 *
 * 1) 캐시 조회 → 2) 미판정만 LLM → 3) 캐시 저장
 * 4) keep=false 제거 → 5) canonical 병합 → 6) 카테고리 계수 → 7) 재정렬 → 8) top-N
 *
 * ANTHROPIC_API_KEY가 없거나 호출이 실패하면 **필터를 건너뛰고 원본을 그대로 돌려준다.**
 * 매시간 크론이라 LLM 장애로 그 시각 수집분이 통째로 날아가면 안 된다.
 */
export async function applyVerdicts(ranked, { topN = 30, allowApi = true } = {}) {
  const stats = { cached: 0, asked: 0, dropped: 0, merged: 0, filtered: false, error: null };

  const cache = await loadVerdicts(ranked.map((k) => k.term));
  stats.cached = cache.size;

  const unknown = ranked.filter((k) => !cache.has(k.term));
  if (unknown.length > 0 && allowApi && process.env.ANTHROPIC_API_KEY) {
    try {
      const fresh = await judgeTerms(unknown);
      const sampleOf = new Map(unknown.map((k) => [k.term, k.sample]));
      const withSample = fresh
        .filter((v) => sampleOf.has(v.term))
        .map((v) => ({ ...v, sample: sampleOf.get(v.term) }));
      await saveVerdicts(withSample, MODEL);
      for (const v of withSample) cache.set(v.term, v);
      stats.asked = withSample.length;
    } catch (err) {
      stats.error = err instanceof Error ? err.message : String(err);
    }
  } else if (unknown.length > 0 && !process.env.ANTHROPIC_API_KEY) {
    stats.error = "ANTHROPIC_API_KEY 미설정";
  }

  // 판정을 하나도 못 얻었으면 필터를 걸지 않은 것으로 본다.
  if (cache.size === 0) return { ranked: ranked.slice(0, topN), stats };
  stats.filtered = true;

  // 판정이 없는 후보는 보수적으로 통과시킨다(캐시 미스 + API 실패 조합).
  const byCanonical = new Map();
  for (const k of ranked) {
    const v = cache.get(k.term);
    if (v && v.keep === false) {
      stats.dropped += 1;
      continue;
    }
    const name = v?.canonical || k.term;
    const weight = CATEGORY_WEIGHTS[v?.category] ?? 1.0;
    const scored = {
      ...k,
      term: name,
      score: Math.round(k.score * weight),
      category: v?.category ?? null,
      originalTerm: k.term,
    };
    // 같은 canonical로 합쳐지면 점수가 높은 쪽 하나만 남긴다.
    // 합산하지 않는 이유: 둘 다 같은 원문에서 나온 조각이라 이중계산이 된다.
    const prev = byCanonical.get(name);
    if (!prev) byCanonical.set(name, scored);
    else {
      stats.merged += 1;
      if (scored.score > prev.score) byCanonical.set(name, scored);
    }
  }

  const out = [...byCanonical.values()].sort(
    (a, b) => b.score - a.score || b.mentions - a.mentions
  );
  return { ranked: out.slice(0, topN), stats };
}
