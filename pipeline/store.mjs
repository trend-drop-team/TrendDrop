/**
 * Postgres 저장 계층 — 모든 데이터가 TrendDrop Postgres 한 곳에 들어간다.
 *
 * 스키마 소유권은 db/schema.ts에 있다. 이 파일은 테이블을 만들지 않는다 —
 * 스키마가 없으면 assertSchema()가 안내 메시지와 함께 즉시 중단시킨다.
 * (스키마 반영: `npm run db:push` 또는 `npx drizzle-kit push --config=drizzle.config.mjs`)
 *
 * 이 파이프라인이 쓰는 테이블 7개:
 *   sources             수집 소스 마스터 (dcbest/theqoo/instiz/youtube/gtrends 5행 고정) — 데이터만 시드
 *   raw_signals         수집 원문 (1시간 버킷). run_id로 어느 collect 실행에서 왔는지 귀속
 *   collection_runs     파이프라인 실행 로그. 이 파이프라인은 두 종류를 남긴다:
 *                          pipeline='collect'  매시간 1건 — raw_signals 소유
 *                          pipeline='popular'  랭킹마다 1건 — trend_snapshots 소유
 *                        (수집과 랭킹이 분리돼 있어 run 자체가 별개다. 11장 PIPELINE.md 참고)
 *   categories           카테고리 마스터 — verdict.mjs CATEGORIES에서 노이즈 2종(일반어·문법조각)을
 *                        뺀 7행 고정. sources처럼 데이터만 시드
 *   keywords             키워드 엔티티. category_id(FK→categories)는 LLM 판정의 content_type으로
 *                        채운다 — content_type 축(인물/사건·사고 등)을 공식 카테고리로 쓰기로 결정
 *                        (예전 UI 축 푸드/뷰티/테크는 폐기. PIPELINE.md TODO 참고)
 *   trend_snapshots      랭킹 실행의 top-N. keyword_id FK, reasons(jsonb)에 소스별 근거 보관
 *   keyword_verdicts     LLM 판정 캐시
 *
 * env: DATABASE_URL. 없으면 호출 측에서 저장을 스킵한다.
 */
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
 * 카테고리 7행 고정 목록 — verdict.mjs CATEGORIES 중 keep=true 키워드가 받을 수 있는 것들.
 * (일반어·문법조각은 keep=false 전용 노이즈 라벨이라 키워드로 승격되지 않아 뺐다.)
 * verdict.mjs가 이 파일을 import하므로 순환을 피하려고 목록을 여기 복제한다 —
 * verdict.mjs CATEGORIES를 바꾸면 여기도 같이 맞출 것.
 */
const CATEGORY_SEED = [
  { name: "인물", slug: "people", sortOrder: 1 },
  { name: "작품·콘텐츠", slug: "content", sortOrder: 2 },
  { name: "기업·주식", slug: "business", sortOrder: 3 },
  { name: "사건·사고", slug: "incident", sortOrder: 4 },
  { name: "재난·속보", slug: "breaking", sortOrder: 5 },
  { name: "정치·사회", slug: "politics", sortOrder: 6 },
  { name: "스포츠", slug: "sports", sortOrder: 7 },
];

/** categories 7행 시드(멱등). seedSources와 같은 방식 — name UNIQUE 기준 ON CONFLICT. */
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
 * 매시간 1건)와 rank-popular.mjs/backfill-popular.mjs(pipeline: "popular",
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
 */
export async function loadRecentItems(hours = 6) {
  const s = await sql();
  await assertSchema();
  const rows = await s`
    SELECT src.kind AS site, r.source, r.text, r.video_id, r.meta, r.bucket_at
    FROM raw_signals r JOIN sources src ON src.id = r.source_id
    WHERE r.bucket_at > (SELECT max(bucket_at) FROM raw_signals)
                      - make_interval(hours => ${hours})
    ORDER BY r.bucket_at, r.id`;
  return rows.map((r) => ({
    site: r.site,
    kind: r.source,
    text: r.text,
    videoId: r.video_id ?? r.meta?.videoId ?? null,
    meta: r.meta ?? null, // viewCount·likeCount·approxTraffic 등 가중 보정용
    bucketAt: new Date(r.bucket_at).toISOString(),
  }));
}

/** 백필용 — 전체 기간 원문을 버킷 순으로. (loadRecentItems와 같은 형식) */
export async function loadAllItems() {
  const s = await sql();
  await assertSchema();
  const rows = await s`
    SELECT src.kind AS site, r.source, r.text, r.video_id, r.meta, r.bucket_at
    FROM raw_signals r JOIN sources src ON src.id = r.source_id
    ORDER BY r.bucket_at, r.id`;
  return rows.map((r) => ({
    site: r.site,
    kind: r.source,
    text: r.text,
    videoId: r.video_id ?? r.meta?.videoId ?? null,
    meta: r.meta ?? null,
    bucketAt: new Date(r.bucket_at).toISOString(),
  }));
}

/**
 * LLM 판정 캐시 — term 하나당 한 행. 같은 단어를 두 번 묻지 않기 위한 장치다.
 * (창이 6시간인데 1시간씩만 밀려서, 연속한 두 실행의 후보가 85% 겹친다.)
 *
 * DB 컬럼은 content_type(통합 스키마 이름)이지만, verdict.mjs 등 호출부는 여전히
 * category라는 이름으로 다룬다 — LLM 프롬프트·JSON 스키마의 필드명과 맞추기 위해
 * 이 파일 안에서만 별칭 처리한다(loadVerdicts는 content_type을 category로 셀렉트,
 * saveVerdicts는 category를 content_type 컬럼에 쓴다).
 */
export async function loadVerdicts(terms) {
  if (terms.length === 0) return new Map();
  const s = await sql();
  await assertSchema();
  const rows = await s`SELECT term, keep, canonical, content_type AS category, reason
    FROM keyword_verdicts WHERE term = ANY(${terms})`;
  return new Map(rows.map((r) => [r.term, r]));
}

/** 판정 저장(업서트). 같은 term을 다시 판정하면 덮어쓴다. */
export async function saveVerdicts(verdicts, model) {
  if (verdicts.length === 0) return 0;
  const s = await sql();
  await assertSchema();
  await s.begin(async (tx) => {
    for (const v of verdicts) {
      await tx`INSERT INTO keyword_verdicts
        (term, keep, canonical, content_type, reason, sample, model)
        VALUES (${v.term}, ${v.keep}, ${v.canonical ?? null}, ${v.category ?? null},
                ${v.reason ?? null}, ${v.sample ?? null}, ${model})
        ON CONFLICT (term) DO UPDATE SET
          keep = EXCLUDED.keep, canonical = EXCLUDED.canonical,
          content_type = EXCLUDED.content_type, reason = EXCLUDED.reason,
          sample = EXCLUDED.sample, model = EXCLUDED.model, decided_at = now()`;
    }
  });
  return verdicts.length;
}

/**
 * 기존 keywords의 category_id 일괄 백필 — keyword_verdicts 캐시에서, LLM 재호출 없이.
 * keywords.term은 병합된 canonical이므로 COALESCE(canonical, term) 기준으로 잇고,
 * 같은 canonical에 판정이 여럿이면 최신 decided_at을 쓴다. 비어 있는 행만 채운다.
 * 반환: 채운 행 수. (실행: node pipeline/backfill-categories.mjs)
 */
export async function backfillKeywordCategories() {
  const s = await sql();
  await assertSchema();
  await seedCategories();
  const res = await s`
    UPDATE keywords k SET category_id = c.id
    FROM (
      SELECT DISTINCT ON (COALESCE(canonical, term))
        COALESCE(canonical, term) AS term, content_type
      FROM keyword_verdicts
      WHERE keep AND content_type IS NOT NULL
      ORDER BY COALESCE(canonical, term), decided_at DESC
    ) v
    JOIN categories c ON c.name = v.content_type
    WHERE k.term = v.term AND k.category_id IS NULL`;
  return res.count;
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
 * 인기 랭킹 top-N을 trend_snapshots에 저장. ranked[i] = popular.mjs의 항목(이미
 * verdict.mjs가 keep=true만 남긴 결과). run은 호출 측이 startRun({ pipeline:
 * "popular" })으로 미리 만들어 runId를 넘긴다.
 *
 * 이 함수가 하지 않는 것 — previousRank는 저장하지 않는다. unified 스키마는
 * trend_snapshots에 그 컬럼이 없다(API가 read 시점에 직전 run과 조인해 계산하는
 * 방식으로 설계됨 — docs/unified-schema-api-spec.md 3.2절). summary도 아직 안 채운다
 * (LLM이 필요한데 term 단위 캐시와 맞지 않아 별도 설계 필요 — 후속 과제).
 */
export async function saveTrendSnapshots(runId, bucketAt, ranked) {
  const s = await sql();
  await assertSchema();
  const bySite = await sourceIdMap();
  const byCategory = await categoryIdMap();

  // ranked에 있는 term은 전부 keywords로 승격한다(스펙 §2.10). source_id는
  // 가중치가 가장 높은 소스로 추정, category_id는 verdict.mjs가 붙인 카테고리 이름을
  // categories.id로 변환(노이즈 카테고리 등 시드에 없는 이름이면 null).
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
