/**
 * 이슈 추출 랭킹 — 원문 한 줄마다 LLM이 "사람들이 검색창에 칠 대상의 이름"을 뽑고,
 * 코드가 소스 가중치로 점수를 매긴 뒤, 상위 후보를 LLM이 한 번 더 검수한다.
 *
 *   1. 추출  새 글만 Lite에 50줄씩 (text_extractions에 text_hash 단위 캐시)
 *   2. 점수  popular.mjs rankPopular — 추출된 이름 × 소스 가중치 × 시의성 배율 × 카테고리 계수 × 교차 보너스
 *   3. 검수  상위 25개를 3번 동시에 물어 과반 판단만 적용: 일반어 빼기(drop) + 같은 대상 묶기(merge)
 *            묶은 결과만 이름 사전(keyword_aliases)에 쌓는다. drop은 맥락 의존이라 저장 안 함
 *   4. 재집계 묶인 이름을 합쳐 다시 점수를 내고 top-N
 *
 * 옛 방식(tokenize → verdict)과 달리 단어를 쪼개지 않아서 "인천 홈플러스 칼부림 사건"
 * 같은 사건 이름, "하닉 → SK하이닉스" 같은 은어가 처음부터 한 덩어리로 잡힌다.
 * 설계 근거와 실험 기록: PIPELINE.md 4장.
 */
import { rankPopular, WEIGHTS } from "./popular.mjs";
import { generateJson, withModelFallback, EXTRACT_MODELS, REVIEW_MODELS } from "./gemini.mjs";
import {
  PROMPT_VERSION,
  SYSTEM,
  SCHEMA,
  ISSUE_CATEGORIES,
  TIMELINESS,
  REVIEW_SYSTEM,
  REVIEW_SCHEMA,
  formatLine,
  buildUserMessage,
  decode,
  OFFICE_HOLDERS,
} from "./issue-prompt.mjs";

export { PROMPT_VERSION };

/** 시의성 배율. AI는 단계만 고르고 숫자는 여기서 정한다(모델은 실시간 인기를 모른다). */
export const TIMELINESS_MULT = { now: 1.0, buzz: 0.7, evergreen: 0.3 };

/**
 * 카테고리 계수 (2026-10-20, B안). 서비스 목적이 유행어·장소·화제의 콘텐츠라 그쪽으로 기울인다.
 * 실측(최근 24시간 7개 시간대 top10 누적): 전부 ×1이면 인물 25·기업 21·스포츠 12·작품 3 →
 * 이 계수로 인물 29·작품 20·기업 9·사건 8·스포츠 2. 더 강하게(인물 0.6/기업 0.4/스포츠 0.4/정치 0.3) 하면
 * 하위권이 5~7점으로 떨어져 구글 검색어 단독 항목이 채워서 보류.
 * 인물에는 정치인뿐 아니라 아이돌·방송인·판다가 다 들어가서 약하게만 깎는다. 카테고리는
 * text_extractions에 이미 있으므로 숫자만 바꾸면 API 재호출 없이 반영된다.
 */
export const CATEGORY_MULT = {
  "유행어·밈": 2.0,
  "작품·콘텐츠": 1.5,
  "사건·사고": 1.0,
  "재난·속보": 1.0,
  "인물": 0.8,
  "기업·주식": 0.6,
  "스포츠": 0.6,
  "정치·사회": 0.5,
};

/** 키워드별 카테고리 계수. 글 하나에 키워드가 2개면 카테고리가 다를 수 있어 키워드 단위로 곱한다. */
/**
 * 키워드별 카테고리 계수. 이름의 **대표 카테고리**(창 안 글에서 가장 많이 붙은 것) 하나로 곱한다 —
 * Lite가 같은 이름에 글마다 다른 카테고리를 붙이는 일이 있어서(두쫀쿠: 유행어·밈 / 기업·주식),
 * 글마다 곱하면 계수가 섞여 추출 흔들림이 순위에 그대로 들어간다. 별칭으로 합쳐진 이름은 한 표로 센다.
 */
export function termMultiplierFor(extractions, aliases) {
  const canon = (n) => aliases.get(n) ?? n;
  const votes = new Map(); // 이름 → Map<카테고리, 표>
  for (const e of extractions.values()) {
    for (const k of e.keywords) {
      const name = canon(k.name);
      const m = votes.get(name) ?? new Map();
      m.set(k.category, (m.get(k.category) ?? 0) + 1);
      votes.set(name, m);
    }
  }
  const mult = new Map();
  for (const [name, m] of votes) {
    const top = [...m.entries()].sort((a, b) => b[1] - a[1])[0][0];
    mult.set(name, CATEGORY_MULT[top] ?? 1);
  }
  return (term) => mult.get(term) ?? 1;
}

const BATCH = 50; // 한 번에 보내는 줄 수. Lite 기준 50줄에 20~40초
// 검수에 올리는 후보 수. 같은 대상이 다른 말로 쪼개져 있으면(인천 칼부림 / 인천 흉기난동)
// 각각은 점수가 낮아 25위 밖일 수 있다 — 넓게 올려서 합칠 기회를 준다.
const REVIEW_POOL = 60;

const short = (s, n = 60) => (s.length > n ? s.slice(0, n) + "…" : s);

/**
 * 글에 적힌 이름인지 확인 — 모델이 이름을 지어내거나 다른 대상으로 바꾸는 걸 코드로 막는다.
 * (2026-10-14: 주부 사망 기사 → "남편 명의 도용 빚보증 사건", 검색어 tving → "이준혁",
 *  "비셀 고베 대 전북" → "KBO". 전부 원문에 없는 이름이었다.)
 *
 * 비교는 소문자·공백·기호를 뺀 글자로 한다(GS25 = gs25, SK 아이젠 = sk아이젠).
 *   구글 검색어·X 트렌드(검색어처럼 취급): 이름과 검색어가 한쪽이 다른 쪽을 포함해야 한다 (gta6 pc → GTA 6)
 *   그 밖: surface(모델이 적은 근거 표현)가 원문에 있어야 하고, 이름은 다음 중 하나여야 한다
 *     - 원문에 그대로 있음
 *     - surface를 포함함 (띄어쓰기·대소문자만 다듬은 경우)
 *     - surface가 3글자 이하 — 줄임말·은어·한자 약칭 펼치기 (하닉 → SK하이닉스, 李 → 이재명).
 *       단 펼친 이름이 두 단어 이하이고 사건·사고로 끝나지 않을 때만 (주부 → "남편 명의 도용 빚보증 사건" 차단)
 *     - surface와 문자 체계가 다름 — 같은 이름의 한글↔영문 표기 (에이투오 라이트 → A2O LITE)
 */
/** 구글 검색어·X 트렌드는 검색어처럼 취급한다 — 줄 전체가 키워드 하나 */
const SEARCH_SITES = ["gtrends", "xtrends"];
const norm = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
const hasHangul = (s) => /[가-힣]/.test(s);
const hasLatin = (s) => /[a-z]/i.test(s);
function isWritten(name, surface, row) {
  const n = norm(name);
  const text = norm(decode(row.text));
  if (!n) return false;
  // 검색어·트렌드 줄: 이름과 줄이 한쪽이 다른 쪽을 포함. 2글자 미만 조각("정", "K")은 막는다 — X 트렌드는
  // 해시태그·문장이 많아 짧은 조각이 통과하기 쉽다
  if (SEARCH_SITES.includes(row.site)) return [...n].length >= 2 && (n.includes(text) || text.includes(n));
  if (text.includes(n)) return true;
  const sf = norm(surface ?? "");
  if (!sf || !text.includes(sf)) return false;
  if (n.includes(sf)) return true;
  // 직함으로 가리킨 현직자 ("이 대통령" → 이재명)
  if (Object.entries(OFFICE_HOLDERS).some(([office, holder]) => norm(holder) === n && sf.includes(norm(office.replace(/\(.*\)/, ""))))) return true;
  // 펼친 이름은 짧은 고유명사다(SK하이닉스, 맨체스터 유나이티드). 긴 사건 문장은 지어낸 것
  if ([...sf].length <= 3) return name.trim().split(/\s+/).length <= 2 && !/(사건|사고|논란|의혹)$/.test(name.trim());
  return hasHangul(sf) !== hasHangul(n) || hasLatin(sf) !== hasLatin(n);
}

/**
 * 요약 끝에 붙는 빈말을 떼어낸다. 프롬프트로 금지해도 Lite가 계속 붙였다(2026-10-14:
 * "시민들의 제압 활약 화제", "뮤직비디오 공개 반응"). 떼고 나서 너무 짧아지면 그대로 둔다.
 * 캐시된 결과에도 적용되도록 읽는 쪽(describe)에서 부른다.
 */
const FILLER = /\s*(?:에\s*대한\s*)?(?:화제|반응|관심\s*집중|관심|근황|관련\s*소식|이목\s*집중)$/;
export function tidyIssue(issue) {
  if (!issue) return null;
  const t = issue.trim().replace(FILLER, "").replace(/[\s,·]+$/, "");
  return t.length >= 4 ? t : issue.trim();
}

/** 카테고리 이름 자체를 키워드로 뽑는 경우가 있어(사건·사고) 걸러낸다 */
const CATEGORY_NAMES = new Set(ISSUE_CATEGORIES.flatMap((c) => [c, ...c.split("·")]));

/**
 * 직함만 있는 이름. 프롬프트로 막아도 Lite가 3번 중 2번 "국무총리"를 뽑았다(2026-10-14).
 * OFFICE_HOLDERS에 있는 직함은 현직자 이름으로 바꾸고, 나머지는 버린다.
 */
const BARE_TITLE = /^(?:대한민국|한국)?\s*(대통령|국무총리|총리|장관|국회의장|대법원장|여당 대표|야당 대표)$/;
function resolveTitle(name) {
  const m = name.match(BARE_TITLE);
  if (!m) return name;
  return m[1] === "대통령" ? OFFICE_HOLDERS["대통령(한국)"] ?? null : null;
}

/** 모델 응답 한 줄을 검증·정리해 캐시 형식으로. rejected = 원문에 없어 버린 키워드 수 */
export function cleanItem(item, row) {
  const raw = (item.keywords ?? [])
    .filter((k) => typeof k.name === "string" && k.name.trim() && ISSUE_CATEGORIES.includes(k.category))
    .filter((k) => !CATEGORY_NAMES.has(k.name.trim()));
  const written = raw.filter((k) => isWritten(k.name, k.surface, row));
  let keywords = written
    .map((k) => ({ ...k, name: resolveTitle(k.name.trim()) }))
    .filter((k) => k.name)
    .slice(0, SEARCH_SITES.includes(row.site) ? 1 : 2)
    .map((k) => ({ name: k.name.trim(), category: k.category, issue: k.issue?.trim() || null }));
  return {
    timeliness: TIMELINESS.includes(item.timeliness) ? item.timeliness : "buzz",
    keywords,
    rejected: raw.length - written.length,
  };
}

/**
 * 1. 추출 — extractions(캐시에서 읽은 Map<textHash, …>)에 없는 글만 LLM으로 뽑아 채운다.
 * onBatch(entries)가 있으면 배치마다 호출한다(DB 저장 — 중간에 끊겨도 다음 실행이 이어서 돈다).
 *
 * 한 배치가 모든 모델에서 실패하면(한도 소진·장애) 남은 배치는 건너뛴다. 못 뽑은 글은
 * 이번 순위에서 키워드 없음으로 취급되고, 저장되지 않았으니 다음 실행에서 다시 시도된다.
 * 키 문제(400/401/403)는 다음 실행도 같으니 그대로 throw.
 */
export async function extractMissing(rows, extractions, aliases, { onBatch } = {}) {
  const videoTitles = new Map(
    rows.filter((r) => r.site === "youtube" && r.kind === "title").map((r) => [r.videoId, r.text])
  );
  const uniq = [...new Map(rows.map((r) => [r.textHash, r])).values()];
  const todo = uniq.filter((r) => !extractions.has(r.textHash));
  const stats = { unique: uniq.length, cached: uniq.length - todo.length, extracted: 0, skipped: 0,
    rejected: 0, models: new Map(), fallbackReason: null, error: null };

  for (let i = 0; i < todo.length; i += BATCH) {
    const batch = todo.slice(i, i + BATCH);
    const lines = batch.map((r, j) => formatLine(j + 1, r, videoTitles));
    const user = buildUserMessage(lines);
    let res;
    try {
      res = await withModelFallback((m) => generateJson(m, SYSTEM, user, SCHEMA), EXTRACT_MODELS);
    } catch (err) {
      if ([400, 401, 403].includes(err.status)) throw err;
      stats.error = `추출 실패: ${String(err.message).slice(0, 160)}`;
      stats.skipped = todo.length - i;
      break;
    }
    const { result, model, fallbackReason } = res;
    if (fallbackReason) stats.fallbackReason = fallbackReason;
    const byId = new Map((result.items ?? []).map((it) => [it.id, it]));
    const entries = [];
    batch.forEach((row, j) => {
      const item = byId.get(j + 1);
      if (!item) return; // 모델이 빠뜨린 줄 — 저장하지 않아 다음 실행에서 다시 뽑는다
      const { rejected, ...e } = cleanItem(item, row);
      stats.rejected += rejected;
      extractions.set(row.textHash, { ...e, model });
      entries.push({ textHash: row.textHash, ...e, model });
    });
    stats.extracted += entries.length;
    stats.models.set(model, (stats.models.get(model) ?? 0) + 1);
    if (onBatch) await onBatch(entries);
  }
  return stats;
}

/**
 * 표기만 다른 이름 통일 — 대소문자·띄어쓰기만 다른 이름을 하나로 모은다.
 * 구글 검색어는 사람들이 친 그대로("gs25", "pakistan vs sri lanka") 들어와서 프롬프트로 공식 표기를
 * 요구해도 가끔 남고, 글마다 띄어쓰기가 달라 같은 이름이 갈린다("기아타이거즈" / "기아 타이거즈").
 *   - 창 안에 대소문자·띄어쓰기만 다른 이름이 여럿이면 하나로: 대문자가 섞인 표기 우선, 그다음 많이 나온 것,
 *     같으면 띄어 쓴 쪽(읽기 쉬움)
 *   - 그렇게 고른 표기가 전부 소문자 영문이면 다듬는다: 숫자가 섞였거나 한 단어 4글자 이하면 약어로 보고
 *     대문자(gs25 → GS25, asml → ASML), 아니면 단어 첫 글자만 대문자(pakistan vs sri lanka → Pakistan vs Sri Lanka)
 * 반환: [[바꿀 이름, 바꿀 표기]] — 호출 측이 이름 사전에 넣는다.
 */
const SMALL_WORDS = new Set(["vs", "of", "and", "the", "de", "a", "in", "on"]);
function tidyLowercase(name) {
  if (!/^[a-z0-9 .'-]+$/.test(name)) return name;
  const bare = name.replace(/\s+/g, "");
  // 한 단어 4글자 이하는 약어인 경우가 대부분이다 (asml, kbo, ssg). 숫자가 섞여도 (gs25)
  if (/[0-9]/.test(bare) || (!name.includes(" ") && bare.length <= 4)) return name.toUpperCase();
  return name
    .split(" ")
    .map((w, i) => (i > 0 && SMALL_WORDS.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}
function casingFixes(extractions, aliases) {
  const canon = (n) => aliases.get(n) ?? n;
  const groups = new Map(); // 정규화 키 → Map<표기, 횟수>
  for (const e of extractions.values()) {
    for (const k of e.keywords) {
      const name = canon(k.name);
      const key = name.toLowerCase().replace(/\s+/g, "");
      const m = groups.get(key) ?? new Map();
      m.set(name, (m.get(name) ?? 0) + 1);
      groups.set(key, m);
    }
  }
  const fixes = [];
  for (const variants of groups.values()) {
    const names = [...variants.keys()];
    const best = [...names].sort(
      (a, b) =>
        Number(/[A-Z]/.test(b)) - Number(/[A-Z]/.test(a)) ||
        variants.get(b) - variants.get(a) ||
        (b.match(/\s/g)?.length ?? 0) - (a.match(/\s/g)?.length ?? 0)
    )[0];
    const target = tidyLowercase(best);
    for (const n of names) if (n !== target) fixes.push([n, target]);
  }
  return fixes;
}

/** 2·4. 점수 — 추출 결과로 rankPopular. dropped에 든 이름은 뺀다. */
function score(rows, extractions, aliases, dropped, limit, windowHours) {
  const canon = (n) => aliases.get(n) ?? n;
  return rankPopular(rows, {
    limit,
    windowHours,
    termsOf: (row) =>
      (extractions.get(row.textHash)?.keywords ?? []).map((k) => canon(k.name)).filter((n) => !dropped.has(n)),
    rowMultiplier: (row) => TIMELINESS_MULT[extractions.get(row.textHash)?.timeliness] ?? 1,
    termMultiplier: termMultiplierFor(extractions, aliases),
  });
}

/**
 * 이름별 대표 카테고리와 이슈 목록. 이슈는 검수 입력에만 쓰고 DB에는 저장하지 않는다(키워드만 모은다).
 *
 * 카테고리는 창 안 글에서 가장 많이 나온 것.
 * 이슈는 서로 다른 것을 최대 4개, 소스 가중치 × 시의성이 큰 글 순으로(댓글은 뒤로).
 * 검수가 "이 이름 아래 서로 무관한 사건이 섞였는지"를 보게 하려는 것 — 한 줄만 보여주면
 * "중국" 아래 글 9개가 전부 다른 이야기인 걸 알 수 없었다(2026-10-14).
 */
function describe(rows, extractions, aliases) {
  const canon = (n) => aliases.get(n) ?? n;
  const weights = WEIGHTS;
  const cats = new Map();
  const issues = new Map(); // name → [{ issue, rank }]
  const texts = new Map(); // name → 글 수
  const seen = new Set();
  for (const row of rows) {
    if (seen.has(row.textHash)) continue;
    seen.add(row.textHash);
    const e = extractions.get(row.textHash);
    if (!e) continue;
    const isComment = row.kind === "comment";
    const rank = (isComment ? 0 : 1000) + (weights[`${row.site}|${row.kind}`] ?? 0) * (TIMELINESS_MULT[e.timeliness] ?? 1);
    for (const k of e.keywords) {
      const name = canon(k.name);
      const m = cats.get(name) ?? new Map();
      m.set(k.category, (m.get(k.category) ?? 0) + 1);
      cats.set(name, m);
      texts.set(name, (texts.get(name) ?? 0) + 1);
      if (k.issue) issues.set(name, [...(issues.get(name) ?? []), { issue: tidyIssue(k.issue), rank }]);
    }
  }
  const top = (m) => [...(m?.entries() ?? [])].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  return (name) => {
    const list = [...new Set((issues.get(name) ?? []).sort((a, b) => b.rank - a.rank).map((x) => x.issue))].slice(0, 4);
    return { category: top(cats.get(name)), summary: list[0] ?? null, issues: list, texts: texts.get(name) ?? 0 };
  };
}

/**
 * 3. 검수 — 상위 후보를 LLM에 VOTES번 동시에 묻고, 과반이 같은 판단을 한 것만 적용한다.
 * 반환 { drop: Map<이름, 사유>, merge: [[별칭, 정식]], model, fallbackReason, votes }
 * 전부 실패하면 throw (호출 측이 검수 없이 진행할지 정한다).
 *
 * 왜 여러 번: Flash 한도가 자주 막혀 Lite가 검수하는데, Lite는 같은 입력에도 실행마다
 * 판단이 흔들렸다(2026-10-14: 같은 창에서 제거 0건 / 3건). 과반으로 우연한 누락·오판을 걸러낸다.
 * 하루 72회(3 × 24) — Flash 한도(각 20)를 넘으면 Lite(500)로 넘어간다.
 *
 * pool: [{ term, score, sample }], info(term) → { category, issues: [이슈…], texts: 글 수 }
 */
export const REVIEW_VOTES = Number(process.env.REVIEW_VOTES ?? 3) || 3;
export async function reviewPool(pool, info, { votes = REVIEW_VOTES, models = REVIEW_MODELS } = {}) {
  const list = pool
    .map((k, i) => {
      const { category, issues = [], texts = 0 } = info(k.term);
      return `${i + 1}. ${k.term} [${category ?? "-"}] | 점수 ${k.score} | 글 ${texts}개의 이슈: ${issues.join(" / ") || "-"} | 원문: ${short(decode(k.sample))}`;
    })
    .join("\n");
  const user = `## 후보 ${pool.length}개\n${list}`;
  const settled = await Promise.allSettled(
    Array.from({ length: votes }, () =>
      withModelFallback((m) => generateJson(m, REVIEW_SYSTEM, user, REVIEW_SCHEMA), models)
    )
  );
  const ok = settled.filter((r) => r.status === "fulfilled").map((r) => r.value);
  if (ok.length === 0) {
    const err = settled[0].reason;
    if ([400, 401, 403].includes(err?.status)) throw err;
    throw new Error(String(err?.message ?? err));
  }
  if (process.env.REVIEW_DEBUG) {
    console.log("[검수 입력]\n" + list);
    for (const r of ok) console.log(`[검수 원응답 ${r.model}] ` + JSON.stringify(r.result));
  }

  const names = new Set(pool.map((k) => k.term));
  const need = Math.floor(ok.length / 2) + 1; // 과반
  const dropVotes = new Map(); // 이름 → { n, reason }
  const pairVotes = new Map(); // "a|b"(정렬) → { n, into: Map<정식, 표> }
  for (const { result } of ok) {
    // 목록에 없는 이름을 지어내 답하는 경우는 무시한다
    for (const d of result.drop ?? []) {
      if (!names.has(d.name)) continue;
      const v = dropVotes.get(d.name) ?? { n: 0, reason: d.reason };
      v.n += 1;
      dropVotes.set(d.name, v);
    }
    const seen = new Set(); // 한 응답 안에서 같은 쌍을 두 번 세지 않게
    for (const m of result.merge ?? []) {
      if (!names.has(m.into)) continue;
      for (const n of m.names ?? []) {
        if (n === m.into || !names.has(n)) continue;
        const key = [n, m.into].sort().join("|");
        if (seen.has(key)) continue;
        seen.add(key);
        const v = pairVotes.get(key) ?? { n: 0, into: new Map() };
        v.n += 1;
        v.into.set(m.into, (v.into.get(m.into) ?? 0) + 1);
        pairVotes.set(key, v);
      }
    }
  }
  const drop = new Map([...dropVotes].filter(([, v]) => v.n >= need).map(([name, v]) => [name, v.reason]));
  const merge = [];
  for (const [key, v] of pairVotes) {
    if (v.n < need) continue;
    const into = [...v.into].sort((a, b) => b[1] - a[1])[0][0];
    const from = key.split("|").find((n) => n !== into);
    if (!drop.has(from) && !drop.has(into)) merge.push([from, into]);
  }
  const usedModels = [...new Set(ok.map((r) => r.model))].join(",");
  const fallbackReason = ok.map((r) => r.fallbackReason).find(Boolean) ?? null;
  return { drop, merge, model: usedModels, fallbackReason, votes: `${ok.length}/${votes}` };
}

/**
 * 2~4단계 묶음. extractions는 extractMissing을 거친 Map, aliases는 이름 사전(검수 결과로 갱신된다).
 * 반환: { ranked, meta, review: { drop, merge, model, fallbackReason, error } }
 */
export async function rankIssues(rows, extractions, aliases, { topN = 10, windowHours = 6, useReview = true } = {}) {
  for (const [from, to] of casingFixes(extractions, aliases)) aliases.set(from, to);
  const dropped = new Set();
  const { ranked: pool, meta } = score(rows, extractions, aliases, dropped, REVIEW_POOL, windowHours);
  let info = describe(rows, extractions, aliases);

  const reviewResult = { drop: new Map(), merge: [], model: null, fallbackReason: null, error: null };
  if (useReview && pool.length > 0) {
    try {
      Object.assign(reviewResult, await reviewPool(pool, info));
      for (const name of reviewResult.drop.keys()) dropped.add(name);
      for (const [from, to] of reviewResult.merge) aliases.set(from, to);
      // A→B가 있는데 이번에 B→C로 묶였으면 A도 C로 — 사전을 한 번만 따라가면 끝나게
      for (const [from, to] of aliases) if (aliases.has(to)) aliases.set(from, aliases.get(to));
      info = describe(rows, extractions, aliases);
    } catch (err) {
      if ([400, 401, 403].includes(err.status)) throw err;
      reviewResult.error = `검수 실패: ${String(err.message).slice(0, 160)}`;
    }
  }

  const { ranked } = score(rows, extractions, aliases, dropped, topN, windowHours);
  return {
    // sample은 snapshots.reasons로 저장돼 화면에 나가므로 엔티티를 푼다. summary는 출력·검수용(저장 안 함)
    ranked: ranked.map((k) => ({ ...k, sample: decode(k.sample), ...info(k.term) })),
    meta,
    review: reviewResult,
  };
}
