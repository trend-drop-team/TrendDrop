/**
 * Postgres 저장 계층 — 모든 데이터가 TrendDrop Postgres 한 곳에 들어간다.
 *
 * 스키마 소유권은 db/schema.ts에 있다. 이 파일은 테이블을 만들지 않는다 —
 * 스키마가 없으면 assertSchema()가 안내 메시지와 함께 즉시 중단시킨다.
 * (스키마 반영: `npm run db:push` 또는 `npx drizzle-kit push --config=drizzle.config.mjs`)
 *
 * 이 파이프라인이 쓰는 테이블 8개:
 *   sources             수집 소스 마스터 (dcbest/theqoo/instiz/youtube/gtrends 5행 고정) — 데이터만 시드
 *   raw_signals         수집 원문 (1시간 버킷). run_id로 어느 collect 실행에서 왔는지 귀속
 *   collection_runs     파이프라인 실행 로그. 이 파이프라인은 두 종류를 남긴다:
 *                          pipeline='collect'  매시간 1건 — raw_signals 소유
 *                          pipeline='popular'  랭킹마다 1건 — trend_snapshots 소유
 *                        (수집과 랭킹이 분리돼 있어 run 자체가 별개다. 11장 PIPELINE.md 참고)
 *   categories           카테고리 마스터 — issue-prompt.mjs ISSUE_CATEGORIES와 같은 8행 고정.
 *                        sources처럼 데이터만 시드
 *   keywords             키워드 엔티티. category_id(FK→categories)는 이슈 추출이 붙인 카테고리로 채운다
 *   trend_snapshots      랭킹 실행의 top-N. keyword_id FK, reasons(jsonb)에 소스별 근거 보관
 *   text_extractions     글 단위 이슈 추출 캐시 (text_hash PK)
 *   keyword_aliases      이름 사전 — 검수가 같은 대상으로 묶은 이름(별칭 → 정식)

 *
 * env: DATABASE_URL. 없으면 호출 측에서 저장을 스킵한다.
 */
import { EXCLUDED_GALLERIES } from "./sources/dcbest-galleries.mjs"; // 의존성 없는 상수 모듈 (스크래퍼는 import하지 않는다)

// postgres는 지연 import — DB를 안 쓰는 경로(스크래핑만)에선 패키지 없어도 동작.
let sqlInstance = null;

async function sql() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured");
  if (!sqlInstance) {
    const { default: postgres } = await import("postgres");
    sqlInstance = postgres(process.env.DATABASE_URL, {
      prepare: false,
      max: 5,
      onnotice: () => {}, // "relation already exists" 등 NOTICE 소음 억제
    });
  }
  return sqlInstance;
}

export async function closeDb() {
  if (sqlInstance) await sqlInstance.end();
  sqlInstance = null;
}

/**
 * 스키마 존재 확인. 이 파일은 CREATE TABLE을 하지 않으므로, unified 스키마가 아직
 * DB에 반영 안 된 상태에서 트렌드라이징을 돌리면 여기서 바로 멈춰야 한다 — 조용히
 * 지나가면 뒤에서 훨씬 알아보기 어려운 에러(컬럼 없음 등)로 튄다.
 */
let schemaChecked = false;
async function assertSchema() {
  if (schemaChecked) return;
  const s = await sql();
  const [row] = await s`SELECT to_regclass('public.raw_signals') AS reg`;
  if (!row?.reg) {
    throw new Error(
      "unified 스키마가 DB에 없습니다. 먼저 반영하세요: " +
        "npm run db:push (= npx drizzle-kit push --config=drizzle.config.mjs)"
    );
  }
  schemaChecked = true;
}

/** 5개 수집 소스 고정 목록. kind가 raw_signals.source_id가 가리키는 대상을 정한다. */
const SOURCE_SEED = [
  { name: "디시인사이드 실시간 베스트", kind: "dcbest" },
  { name: "더쿠 핫게시판", kind: "theqoo" },
  { name: "인스티즈 실시간 인기", kind: "instiz" },
  { name: "YouTube Data API", kind: "youtube" },
  { name: "Google Trends RSS", kind: "gtrends" },
];

/**
 * sources 5행 시드(멱등). 테이블은 이미 있다고 가정(assertSchema)하고 데이터만 넣는다.
 *
 * db/schema.ts의 sources는 name에만 UNIQUE가 있고 kind엔 없다(설계 허점 —
 * 백엔드에 공유 필요). 그래서 ON CONFLICT는 kind가 아니라 name 기준으로 건다.
 */
export async function seedSources() {
  const s = await sql();
  await assertSchema();
  for (const src of SOURCE_SEED) {
    await s`INSERT INTO sources (name, kind) VALUES (${src.name}, ${src.kind})
      ON CONFLICT (name) DO NOTHING`;
  }
}

/**
 * 카테고리 8행 고정 목록 — issue-prompt.mjs ISSUE_CATEGORIES와 같은 이름이어야 한다.
 * (slug·정렬 순서가 필요해 여기 따로 둔다. ISSUE_CATEGORIES를 바꾸면 여기도 같이 맞출 것)
 */
const CATEGORY_SEED = [
  { name: "인물", slug: "people", sortOrder: 1 },
  { name: "작품·콘텐츠", slug: "content", sortOrder: 2 },
  { name: "기업·주식", slug: "business", sortOrder: 3 },
  { name: "사건·사고", slug: "incident", sortOrder: 4 },
  { name: "재난·속보", slug: "breaking", sortOrder: 5 },
  { name: "정치·사회", slug: "politics", sortOrder: 6 },
  { name: "스포츠", slug: "sports", sortOrder: 7 },
  // 2026-10-14 이슈 추출 전환 때 추가 — 서비스 목적이 "유행어·인기 검색어"라서
  { name: "유행어·밈", slug: "meme", sortOrder: 8 },
];

/** categories 8행 시드(멱등). seedSources와 같은 방식 — name UNIQUE 기준 ON CONFLICT. */
export async function seedCategories() {
  const s = await sql();
  await assertSchema();
  for (const c of CATEGORY_SEED) {
    await s`INSERT INTO categories (name, slug, sort_order)
      VALUES (${c.name}, ${c.slug}, ${c.sortOrder})
      ON CONFLICT (name) DO NOTHING`;
  }
}

/** 카테고리 이름(인물 등) → categories.id. sourceIdMap과 같은 캐시 패턴. */
let categoryIdCache = null;
async function categoryIdMap() {
  if (categoryIdCache) return categoryIdCache;
  const s = await sql();
  await seedCategories();
  const rows = await s`SELECT id, name FROM categories`;
  categoryIdCache = new Map(rows.map((r) => [r.name, r.id]));
  return categoryIdCache;
}

/** site 문자열(dcbest 등) → sources.id. 매번 새로 조회하지 않도록 캐시한다. */
let sourceIdCache = null;
async function sourceIdMap() {
  if (sourceIdCache) return sourceIdCache;
  const s = await sql();
  await seedSources();
  const rows = await s`SELECT id, kind FROM sources`;
  sourceIdCache = new Map(rows.map((r) => [r.kind, r.id]));
  return sourceIdCache;
}

/**
 * 파이프라인 실행 1건 시작. collection_runs는 master/v-he 등 다른 파이프라인과
 * 공유하는 테이블이라 pipeline 컬럼으로 반드시 구분해야 한다.
 *
 * 이 파이프라인은 이 함수를 두 자리에서 부른다 — collect.mjs(pipeline: "collect",
 * 매시간 1건)와 rank-popular.mjs(pipeline: "popular",
 * 랭킹마다 1건). 반환된 runId를 뒤이어 insertRawItems/saveTrendSnapshots에 넘긴다.
 */
export async function startRun({ pipeline, geo = "KR", bucketAt, windowHours, buckets } = {}) {
  if (!pipeline) throw new Error("startRun: pipeline은 필수");
  const s = await sql();
  await assertSchema();
  const [run] = await s`INSERT INTO collection_runs
    (pipeline, geo, bucket_at, window_hours, buckets, status)
    VALUES (${pipeline}, ${geo}, ${bucketAt ?? null}, ${windowHours ?? null}, ${buckets ?? null}, 'running')
    RETURNING id`;
  return run.id;
}

/** startRun()으로 연 실행을 마무리(성공/실패 공통). */
export async function finishRun(
  runId,
  { status = "success", rawSignalCount, keywordCount, apiCallLog, errorMessage, filtered } = {}
) {
  const s = await sql();
  await assertSchema();
  await s`UPDATE collection_runs SET
    finished_at = now(),
    status = ${status},
    raw_signal_count = ${rawSignalCount ?? null},
    keyword_count = ${keywordCount ?? null},
    api_call_log = ${apiCallLog ? s.json(apiCallLog) : null},
    error_message = ${errorMessage ?? null},
    filtered = COALESCE(${filtered ?? null}, filtered)
  WHERE id = ${runId}`;
}

/**
 * 수집 원문 저장. 반환: 새로 저장된 수(중복 제외).
 * row: {site, kind, text, textHash, meta, bucketAt, capturedAt}
 * runId: startRun({ pipeline: "collect" })로 얻은 이번 수집 실행의 run.
 */
export async function insertRawItems(rows, runId) {
  if (rows.length === 0) return 0;
  if (!runId) throw new Error("insertRawItems: runId는 필수 (startRun으로 먼저 생성)");
  const s = await sql();
  await assertSchema();
  const bySite = await sourceIdMap();
  let saved = 0;
  await s.begin(async (tx) => {
    for (const r of rows) {
      const sourceId = bySite.get(r.site);
      if (!sourceId) throw new Error(`알 수 없는 site: ${r.site} (sources 테이블에 없음)`);
      const res = await tx`INSERT INTO raw_signals
        (run_id, source_id, source, text, text_hash, video_id, meta, bucket_at, captured_at)
        VALUES (${runId}, ${sourceId}, ${r.kind}, ${r.text}, ${r.textHash}, ${r.meta?.videoId ?? null},
                ${r.meta ? tx.json(r.meta) : null}, ${r.bucketAt}, ${r.capturedAt})
        ON CONFLICT (source_id, text_hash, bucket_at) DO NOTHING`;
      saved += res.count;
    }
  });
  return saved;
}

/**
 * 인기 랭킹용 로더 — 최근 N시간의 원문. {site, kind, text, videoId, meta, bucketAt}
 *
 * 창은 "직전 N개 버킷"이 아니라 "직전 N시간"이다. 수집이 빠진 시간대가 있어도
 * 과거로 더 뻗지 않고 표본만 줄어든다 — "6시간 창"이 실제로 6시간을 뜻하게 된다.
 * 기준점은 now()가 아니라 max(bucket_at): 이번 시각 수집이 실패해도 직전 데이터로
 * 랭킹은 나오게 하되, 호출 측이 기준 시각을 출력해 오래된 데이터를 알아채게 한다.
 * 디시 뉴스 갤러리(EXCLUDED_GALLERIES)는 여기서 거른다 — 수집 단계 제외 전에 쌓인 과거 글도 순위에서 빠진다.
 */
export async function loadRecentItems(hours = 6, { offsetHours = 0 } = {}) {
  const s = await sql();
  await assertSchema();
  // offsetHours: 창 끝을 최신 버킷에서 그만큼 과거로 민다(실험에서 다른 시간대 비교용)
  const rows = await s`
    SELECT src.kind AS site, r.source, r.text, r.text_hash, r.video_id, r.meta, r.bucket_at
    FROM raw_signals r JOIN sources src ON src.id = r.source_id
    WHERE r.bucket_at > (SELECT max(bucket_at) FROM raw_signals)
                      - make_interval(hours => ${hours + offsetHours})
      AND r.bucket_at <= (SELECT max(bucket_at) FROM raw_signals)
                      - make_interval(hours => ${offsetHours})
      AND NOT (src.kind = 'dcbest' AND COALESCE(r.meta->>'gallery', '') = ANY(${EXCLUDED_GALLERIES}::text[]))
    ORDER BY r.bucket_at, r.id`;
  return rows.map((r) => ({
    site: r.site,
    kind: r.source,
    text: r.text,
    textHash: r.text_hash,
    videoId: r.video_id ?? r.meta?.videoId ?? null,
    meta: r.meta ?? null, // viewCount·likeCount·approxTraffic 등 가중 보정용
    bucketAt: new Date(r.bucket_at).toISOString(),
  }));
}

/**
 * growth_rate 표시 문자열. 직전 popular run에 이 키워드가 없었으면(prevScore == null)
 * 비교 기준이 없으므로 언급 횟수로 대신한다. score가 0이었던 적은 없어서(테이블에 안
 * 남으므로) prevScore === 0은 이론상 발생하지 않지만 나눗셈 보호용으로 남겨둔다.
 */
function formatGrowthRate(score, mentions, prevScore) {
  if (prevScore == null) return `${mentions ?? 0}회 언급`;
  if (prevScore === 0) return "NEW";
  const pct = Math.round(((score - prevScore) / prevScore) * 100);
  return `${pct >= 0 ? "+" : ""}${pct}%`;
}

/** 한글 포함 슬러그: 문자/숫자만 남기고 나머지는 하이픈으로. */
function slugify(term) {
  const base = term
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return base || "keyword";
}

/**
 * term을 keywords 엔티티로 승격(멱등). 이미 있으면 그 id를 반환한다 —
 * first_seen_at은 "최초" 발견 시각이라 이후 run에서 덮어쓰지 않는다.
 *
 * category_id는 신규 행에 채우고, 기존 행은 **비어 있을 때만** 채운다(자연 백필).
 * 이미 붙은 카테고리는 덮어쓰지 않는다 — 판정이 흔들려 매 run 카테고리가 바뀌는 것을 막는다.
 *
 * slug는 한글 슬러그(공백→하이픈) 기본형을 쓰되, 서로 다른 term이 같은 슬러그로
 * 뭉개지는 드문 경우엔 짧은 난수를 붙여 갈라놓는다.
 */
export async function upsertKeyword(term, { sourceId, categoryId } = {}) {
  const s = await sql();
  await assertSchema();

  const existing = await s`SELECT id, category_id FROM keywords WHERE term = ${term}`;
  if (existing.length > 0) {
    if (categoryId != null && existing[0].category_id == null) {
      await s`UPDATE keywords SET category_id = ${categoryId} WHERE id = ${existing[0].id}`;
    }
    return existing[0].id;
  }

  const base = slugify(term);
  for (let attempt = 0; attempt < 3; attempt++) {
    const slug = attempt === 0 ? base : `${base}-${Math.random().toString(36).slice(2, 7)}`;
    try {
      const [row] = await s`
        INSERT INTO keywords (term, slug, source_id, category_id)
        VALUES (${term}, ${slug}, ${sourceId ?? null}, ${categoryId ?? null})
        ON CONFLICT (term) DO NOTHING
        RETURNING id`;
      if (row) return row.id;
      // term이 그새 다른 트랜잭션에서 먼저 들어간 경우(레이스) — 조회해서 반환
      const raced = await s`SELECT id FROM keywords WHERE term = ${term}`;
      if (raced.length > 0) return raced[0].id;
    } catch (err) {
      if (!String(err?.message ?? err).includes("keywords_slug_idx")) throw err;
      // slug 충돌 — 다음 반복에서 난수 접미사로 재시도
    }
  }
  throw new Error(`upsertKeyword: slug 충돌 재시도 초과 (term=${term})`);
}

/**
 * 인기 랭킹 top-N을 trend_snapshots에 저장. ranked[i] = popular.mjs의 항목(issues.mjs가
 * 검수까지 마친 결과). run은 호출 측이 startRun({ pipeline:
 * "popular" })으로 미리 만들어 runId를 넘긴다.
 *
 * 이 함수가 하지 않는 것 — previousRank는 저장하지 않는다. unified 스키마는
 * trend_snapshots에 그 컬럼이 없다(API가 read 시점에 직전 run과 조인해 계산하는
 * 방식으로 설계됨 — docs/unified-schema-api-spec.md 3.2절).
 * summary는 채우지 않는다 — 이 서비스는 키워드만 모은다(2026-10-14 yang 결정).
 * 이슈 추출의 issue는 검수 판단 근거로만 쓰고 저장하지 않는다.
 */
export async function saveTrendSnapshots(runId, bucketAt, ranked) {
  const s = await sql();
  await assertSchema();
  const bySite = await sourceIdMap();
  const byCategory = await categoryIdMap();

  // ranked에 있는 term은 전부 keywords로 승격한다(스펙 §2.10). source_id는
  // 가중치가 가장 높은 소스로 추정, category_id는 이슈 추출이 붙인 카테고리 이름을
  // categories.id로 변환(시드에 없는 이름이면 null).
  // upsertKeyword는 트랜잭션 밖에서 순차 호출 —
  // 레이스 재시도 로직이 자체 커넥션을 쓰는 편이 트랜잭션 안에서보다 단순하다.
  const keywordIds = [];
  for (const k of ranked) {
    const topSite = k.sources?.[0]?.source ?? null;
    keywordIds.push(
      await upsertKeyword(k.term, {
        sourceId: topSite ? bySite.get(topSite) ?? null : null,
        categoryId: k.category ? byCategory.get(k.category) ?? null : null,
      })
    );
  }

  // growth_rate 계산용 — 직전 popular run(이번 run 이전, pipeline='popular')의
  // keyword_id별 score. LLM 없이 순수 비교로 낸다.
  const [prevRun] = await s`SELECT id FROM collection_runs
    WHERE pipeline = 'popular' AND id < ${runId}
    ORDER BY id DESC LIMIT 1`;
  const prevScores = prevRun
    ? new Map(
        (await s`SELECT keyword_id, score FROM trend_snapshots WHERE run_id = ${prevRun.id}`).map(
          (r) => [r.keyword_id, r.score]
        )
      )
    : new Map();

  await s.begin(async (tx) => {
    for (let i = 0; i < ranked.length; i++) {
      const k = ranked[i];
      // sources({source, weightSum}) + sample(대표 예문 1개) → reasons(jsonb)로 흡수.
      // sample은 term 전체에 대한 대표 예문 하나뿐이라 최상위 가중치 소스 항목에만 붙인다.
      // text는 API(parseReasons)가 요구하는 필수 필드라 sample과 같은 값을 넣는다 —
      // 나중에 LLM 요약이 붙으면 text만 따로 갈아끼울 수 있도록 sample은 그대로 둔다.
      const reasons = (k.sources ?? []).map((src, idx) => ({
        source: src.source,
        weight: src.weightSum,
        ...(idx === 0 && k.sample ? { text: k.sample, sample: k.sample } : {}),
      }));
      const sourceLabel = k.sources?.map((src) => src.source).join(", ") || null;
      const growthRate = formatGrowthRate(k.score, k.mentions, prevScores.get(keywordIds[i]));
      const velocity = typeof k.velocity === "number" ? `${k.velocity.toFixed(1)}/10` : null;

      await tx`INSERT INTO trend_snapshots
        (keyword_id, run_id, rank, score, growth_rate, velocity, mentions, rising_score, baseline_mentions, reasons, source_label, captured_at)
        VALUES (${keywordIds[i]}, ${runId}, ${i + 1}, ${Math.round(k.score)}, ${growthRate}, ${velocity},
                ${k.mentions ?? null}, ${k.risingScore ?? null}, ${k.baselineMentions ?? null},
                ${tx.json(reasons)}, ${sourceLabel}, ${bucketAt})`;
    }
  });
  return ranked.length;
}

/**
 * 이슈 추출 캐시(text_extractions) 조회 — 현재 프롬프트 버전으로 뽑은 것만.
 * 반환: Map<textHash, { timeliness, keywords, model }>
 *
 * 테이블이 아직 없으면(스키마 반영 전 --save 없이 미리 돌려볼 때) 빈 Map — 전부 새로 뽑는다.
 */
export async function loadExtractions(hashes, promptVersion) {
  if (hashes.length === 0) return new Map();
  const s = await sql();
  if (!(await tableExists("text_extractions"))) return new Map();
  const rows = await s`SELECT text_hash, timeliness, keywords, model FROM text_extractions
    WHERE text_hash = ANY(${hashes}) AND prompt_version = ${promptVersion}`;
  return new Map(rows.map((r) => [r.text_hash, { timeliness: r.timeliness, keywords: r.keywords, model: r.model }]));
}

/** 추출 결과 저장. 예전 프롬프트 버전으로 뽑은 행은 덮어쓴다. entries: [{ textHash, timeliness, keywords, model }] */
export async function saveExtractions(entries, promptVersion) {
  if (entries.length === 0) return;
  const s = await sql();
  await s.begin(async (tx) => {
    for (const e of entries) {
      await tx`INSERT INTO text_extractions (text_hash, prompt_version, model, timeliness, keywords)
        VALUES (${e.textHash}, ${promptVersion}, ${e.model}, ${e.timeliness}, ${tx.json(e.keywords)})
        ON CONFLICT (text_hash) DO UPDATE SET
          prompt_version = EXCLUDED.prompt_version, model = EXCLUDED.model,
          timeliness = EXCLUDED.timeliness, keywords = EXCLUDED.keywords, extracted_at = now()`;
    }
  });
}

/** 이름 사전 전체 — Map<별칭, 정식 이름>. 테이블이 없으면 빈 Map. */
export async function loadAliases() {
  const s = await sql();
  if (!(await tableExists("keyword_aliases"))) return new Map();
  const rows = await s`SELECT alias, canonical FROM keyword_aliases`;
  return new Map(rows.map((r) => [r.alias, r.canonical]));
}

/**
 * 검수가 묶은 이름 저장. pairs: [[별칭, 정식 이름]]
 * 정식 이름이 다른 별칭의 정식 이름으로 다시 묶이면(A→B 뒤 B→C) 기존 A도 C로 당긴다 —
 * 사전을 한 번만 따라가면 끝나게(체인 없이) 유지한다.
 */
export async function saveAliases(pairs, model) {
  if (pairs.length === 0) return;
  const s = await sql();
  await s.begin(async (tx) => {
    for (const [alias, canonical] of pairs) {
      if (alias === canonical) continue;
      await tx`INSERT INTO keyword_aliases (alias, canonical, model)
        VALUES (${alias}, ${canonical}, ${model})
        ON CONFLICT (alias) DO UPDATE SET canonical = EXCLUDED.canonical, model = EXCLUDED.model`;
      await tx`UPDATE keyword_aliases SET canonical = ${canonical} WHERE canonical = ${alias}`;
      // 정식 이름이 예전엔 별칭이었다면(순환 방지) 그 행은 지운다
      await tx`DELETE FROM keyword_aliases WHERE alias = ${canonical}`;
    }
  });
}

async function tableExists(name) {
  const s = await sql();
  const [row] = await s`SELECT to_regclass(${"public." + name}) AS reg`;
  return Boolean(row?.reg);
}
