/**
 * Postgres 저장 계층 — 모든 데이터가 TrendDrop Postgres 한 곳에 들어간다.
 * 테이블 5개를 이 파일이 담당한다:
 *   sources             수집 소스 마스터 (dcbest/theqoo/instiz/youtube/gtrends 5행 고정)
 *   raw_signals         수집 원문 (1시간 버킷)
 *   collection_runs     랭킹 실행 1건 (수집 run이 아니라 랭킹 run — trend-rising은
 *                       수집과 랭킹이 분리돼 있어 원문에 run_id를 두지 않는다)
 *   popular_snapshots   그 실행의 top-N (trend_snapshots로의 통합은 3단계 — jin의
 *                       db/schema.ts가 그 이름을 아직 쓰고 있어 충돌을 피해 미룸)
 *   keyword_verdicts    LLM 판정 캐시
 *
 * 테이블/컬럼 이름은 통합 스키마 문서(docs/trend-data-schema-and-api-spec.md,
 * docs/trend-rising-rename-plan.md)를 따른다.
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

/** 5개 수집 소스 고정 목록. kind가 raw_signals.source_id가 가리키는 대상을 정한다. */
const SOURCE_SEED = [
  { name: "디시인사이드 실시간 베스트", kind: "dcbest" },
  { name: "더쿠 핫게시판", kind: "theqoo" },
  { name: "인스티즈 실시간 인기", kind: "instiz" },
  { name: "YouTube Data API", kind: "youtube" },
  { name: "Google Trends RSS", kind: "gtrends" },
];

/** sources 마스터 테이블 생성 + 시드(멱등). */
export async function ensureSources() {
  const s = await sql();
  await s`CREATE TABLE IF NOT EXISTS sources (
    id         int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name       varchar(80) NOT NULL UNIQUE,
    kind       varchar(40) NOT NULL UNIQUE,
    created_at timestamptz NOT NULL DEFAULT now()
  )`;
  for (const src of SOURCE_SEED) {
    await s`INSERT INTO sources (name, kind) VALUES (${src.name}, ${src.kind})
      ON CONFLICT (kind) DO NOTHING`;
  }
}

/** site 문자열(dcbest 등) → sources.id. 매번 새로 조회하지 않도록 캐시한다. */
let sourceIdCache = null;
async function sourceIdMap() {
  if (sourceIdCache) return sourceIdCache;
  const s = await sql();
  await ensureSources();
  const rows = await s`SELECT id, kind FROM sources`;
  sourceIdCache = new Map(rows.map((r) => [r.kind, r.id]));
  return sourceIdCache;
}

/** 수집 원문 테이블 생성(멱등). */
export async function ensureTables() {
  const s = await sql();
  await ensureSources();
  await s`CREATE TABLE IF NOT EXISTS raw_signals (
    id           bigserial PRIMARY KEY,
    source_id    int NOT NULL REFERENCES sources(id),
    source       text NOT NULL,  -- 신호 종류(title/comment) — 통합 스키마의 raw_signals.source
    text         text NOT NULL,
    text_hash    text NOT NULL,
    video_id     text,
    meta         jsonb,
    bucket_at    timestamptz NOT NULL,
    captured_at  timestamptz NOT NULL,
    UNIQUE (source_id, text_hash, bucket_at)
  )`;
}

/** 수집 원문 저장. 반환: 새로 저장된 수(중복 제외). row: {site, kind, text, textHash, meta, bucketAt, capturedAt} */
export async function insertRawItems(rows) {
  if (rows.length === 0) return 0;
  const s = await sql();
  await ensureTables();
  const bySite = await sourceIdMap();
  let saved = 0;
  await s.begin(async (tx) => {
    for (const r of rows) {
      const sourceId = bySite.get(r.site);
      if (!sourceId) throw new Error(`알 수 없는 site: ${r.site} (sources 테이블에 없음)`);
      const res = await tx`INSERT INTO raw_signals
        (source_id, source, text, text_hash, video_id, meta, bucket_at, captured_at)
        VALUES (${sourceId}, ${r.kind}, ${r.text}, ${r.textHash}, ${r.meta?.videoId ?? null},
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
  await ensureTables();
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
  await ensureTables();
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

/** 인기 랭킹 결과 테이블 2개 생성(멱등). raw_signals 와 분리해 나란히 비교한다. */
export async function ensurePopularTables() {
  const s = await sql();
  await s`CREATE TABLE IF NOT EXISTS collection_runs (
    id               bigserial PRIMARY KEY,
    started_at       timestamptz NOT NULL DEFAULT now(),
    bucket_at        timestamptz NOT NULL,
    buckets          int NOT NULL,
    raw_signal_count int NOT NULL
  )`;
  // 창 길이(시간). buckets는 그 창 안에 실제로 있던 버킷 수 — 둘을 비교하면
  // 그 시점에 수집이 얼마나 빠졌는지 바로 보인다 (6시간 창에 버킷 4개 = 2회 누락).
  await s`ALTER TABLE collection_runs ADD COLUMN IF NOT EXISTS window_hours int`;
  // LLM 필터가 실제로 걸렸는지. 키 없음·API 오류 시 false로 남아 "이 run은 안 걸렀다"를 구분한다.
  await s`ALTER TABLE collection_runs ADD COLUMN IF NOT EXISTS filtered boolean NOT NULL DEFAULT false`;
  await s`CREATE TABLE IF NOT EXISTS popular_snapshots (
    id        bigserial PRIMARY KEY,
    run_id    bigint NOT NULL REFERENCES collection_runs(id),
    term      text NOT NULL,
    rank      int NOT NULL,
    prev_rank int,
    score     real,
    mentions  int,
    breadth   int,
    sources   jsonb,
    units     jsonb,
    sample    text
  )`;
  // 기준 시각을 스냅샷 행에도 둔다. collection_runs 조인 없이 시간으로 바로 조회하기 위함
  // (예: 최근 6시간 랭킹 = WHERE bucket_at > now() - interval '6 hours').
  await s`ALTER TABLE popular_snapshots ADD COLUMN IF NOT EXISTS bucket_at timestamptz`;
  await s`CREATE INDEX IF NOT EXISTS popular_snapshots_term_idx ON popular_snapshots (term)`;
  await s`CREATE INDEX IF NOT EXISTS popular_snapshots_run_idx ON popular_snapshots (run_id)`;
  await s`CREATE INDEX IF NOT EXISTS popular_snapshots_time_idx ON popular_snapshots (bucket_at DESC, rank)`;
}

/**
 * LLM 판정 캐시 — term 하나당 한 행. 같은 단어를 두 번 묻지 않기 위한 장치다.
 * (창이 6시간인데 1시간씩만 밀려서, 연속한 두 실행의 후보가 85% 겹친다.)
 *
 * DB 컬럼은 content_type(통합 스키마 이름)이지만, verdict.mjs 등 호출부는 여전히
 * category라는 이름으로 다룬다 — LLM 프롬프트·JSON 스키마의 필드명과 맞추기 위해
 * 이 파일 안에서만 별칭 처리한다(loadVerdicts는 content_type을 category로 셀렉트,
 * saveVerdicts는 category를 content_type 컬럼에 쓴다).
 *
 * (한때 여기에 ui_category라는 별도 축을 뒀었다. 프론트 mock의 카테고리 값을 그대로
 * 가져다 쓴 것이었는데, trend-rising 실제 콘텐츠와 안 맞아 재판정 결과 87%가 "기타"로
 * 나왔다 — 2026-08-11에 되돌렸다. UI 카테고리가 필요하면 이 content_type을 쓴다.)
 */
export async function ensureVerdictTable() {
  const s = await sql();
  await s`CREATE TABLE IF NOT EXISTS keyword_verdicts (
    term         text PRIMARY KEY,
    keep         boolean NOT NULL,
    canonical    text,          -- 병합·복원된 이름. 그대로면 null
    content_type text,
    reason       text,
    sample       text,          -- 판정 근거가 된 예문 (나중에 판정을 재검토할 때 필요)
    model        text,
    decided_at   timestamptz NOT NULL DEFAULT now()
  )`;
}

/** 주어진 term들의 캐시된 판정. 반환: Map<term, verdict>. verdict.category는 content_type 컬럼의 별칭. */
export async function loadVerdicts(terms) {
  if (terms.length === 0) return new Map();
  const s = await sql();
  await ensureVerdictTable();
  const rows = await s`SELECT term, keep, canonical, content_type AS category, reason
    FROM keyword_verdicts WHERE term = ANY(${terms})`;
  return new Map(rows.map((r) => [r.term, r]));
}

/** 판정 저장(업서트). 같은 term을 다시 판정하면 덮어쓴다. */
export async function saveVerdicts(verdicts, model) {
  if (verdicts.length === 0) return 0;
  const s = await sql();
  await ensureVerdictTable();
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

/** 한글 포함 슬러그: 문자/숫자만 남기고 나머지는 하이픈으로. */
function slugify(term) {
  const base = term
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return base || "keyword";
}

/** keywords 테이블 생성(멱등). */
export async function ensureKeywords() {
  const s = await sql();
  await s`CREATE TABLE IF NOT EXISTS keywords (
    id            int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    term          varchar(160) NOT NULL UNIQUE,
    slug          varchar(200) NOT NULL UNIQUE,
    category      varchar(80),                  -- content_type(verdict.mjs CATEGORIES) 재사용. categories 테이블 생기면 category_id FK로 전환 예정
    source_id     int REFERENCES sources(id),    -- 최초 발견 소스
    first_seen_at timestamptz NOT NULL DEFAULT now(),
    created_at    timestamptz NOT NULL DEFAULT now()
  )`;
}

/**
 * term을 keywords 엔티티로 승격(멱등). 이미 있으면 그 id를 반환하고 아무것도
 * 바꾸지 않는다 — first_seen_at은 "최초" 발견 시각이라 이후 run에서 덮어쓰지 않는다.
 *
 * slug는 한글 슬러그(공백→하이픈) 기본형을 쓰되, 서로 다른 term이 같은 슬러그로
 * 뭉개지는 드문 경우엔 짧은 난수를 붙여 갈라놓는다.
 */
export async function upsertKeyword(term, { category, sourceId } = {}) {
  const s = await sql();
  await ensureKeywords();

  const existing = await s`SELECT id FROM keywords WHERE term = ${term}`;
  if (existing.length > 0) return existing[0].id;

  const base = slugify(term);
  for (let attempt = 0; attempt < 3; attempt++) {
    const slug = attempt === 0 ? base : `${base}-${Math.random().toString(36).slice(2, 7)}`;
    try {
      const [row] = await s`
        INSERT INTO keywords (term, slug, category, source_id)
        VALUES (${term}, ${slug}, ${category ?? null}, ${sourceId ?? null})
        ON CONFLICT (term) DO NOTHING
        RETURNING id`;
      if (row) return row.id;
      // term이 그새 다른 트랜잭션에서 먼저 들어간 경우(레이스) — 조회해서 반환
      const raced = await s`SELECT id FROM keywords WHERE term = ${term}`;
      if (raced.length > 0) return raced[0].id;
    } catch (err) {
      if (!String(err?.message ?? err).includes("keywords_slug_key")) throw err;
      // slug 충돌 — 다음 반복에서 난수 접미사로 재시도
    }
  }
  throw new Error(`upsertKeyword: slug 충돌 재시도 초과 (term=${term})`);
}

/** 인기 랭킹 실행 1건 + top-N 저장. ranked[i] = popular.mjs의 항목. */
export async function savePopularRun(
  { bucketAt, buckets, rawSignalCount, windowHours, filtered = false },
  ranked
) {
  const s = await sql();
  await ensurePopularTables();

  // ranked는 verdict.mjs가 이미 keep=true만 남긴 결과다 — 여기 있는 term은 전부
  // keywords로 승격한다(스펙 §2.10). category는 content_type(k.category)을 그대로
  // 쓴다 — UI 탭 전용 값을 새로 만들려다 실패한 적이 있어(위 keyword_verdicts 주석
  // 참고) 이미 계산되는 축을 재사용한다. source_id는 가중치가 가장 높은 소스로 추정.
  const bySite = await sourceIdMap();
  for (const k of ranked) {
    const topSite = k.sources?.[0]?.source ?? null;
    await upsertKeyword(k.term, {
      category: k.category ?? null,
      sourceId: topSite ? bySite.get(topSite) ?? null : null,
    });
  }

  // 직전 run = 가장 마지막에 들어간 run. 백필은 버킷 순으로 삽입하므로 started_at(now())이
  // 전부 같아도 id 순서면 시간 순서가 된다.
  const prevRows = await s`SELECT term, rank FROM popular_snapshots
    WHERE run_id = (SELECT id FROM collection_runs ORDER BY id DESC LIMIT 1)`;
  const prev = new Map(prevRows.map((r) => [r.term, r.rank]));

  const [run] = await s`INSERT INTO collection_runs
    (bucket_at, buckets, raw_signal_count, window_hours, filtered)
    VALUES (${bucketAt}, ${buckets}, ${rawSignalCount}, ${windowHours ?? null}, ${filtered})
    RETURNING id`;
  await s.begin(async (tx) => {
    for (let i = 0; i < ranked.length; i++) {
      const k = ranked[i];
      await tx`INSERT INTO popular_snapshots
        (run_id, bucket_at, term, rank, prev_rank, score, mentions, breadth, sources, units, sample)
        VALUES (${run.id}, ${bucketAt}, ${k.term}, ${i + 1}, ${prev.get(k.term) ?? null},
                ${k.score}, ${k.mentions}, ${k.breadth},
                ${tx.json(k.sources)}, ${tx.json(k.units)}, ${k.sample})`;
    }
  });
  return run.id;
}
