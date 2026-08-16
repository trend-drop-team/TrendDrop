# 작업 현황 — 파이프라인 & DB (yang)

> 다음 세션 인수인계용. **최종 갱신: 2026-08-16**
> 브랜치: `feat/trend-rising-schema` (master 미머지)

---

## 0. 한 줄 요약

TrendDrop은 팀 프로젝트고, **나(yang)는 데이터 수집 파이프라인(`pipeline/`)과 DB를 맡는다.**
이번 작업은 "실제로 DB를 띄우기 전에, 중복·잔재를 걷어내고 이름을 정리하는 것"이었다.

| 영역 | 담당 | 상태 |
| --- | --- | --- |
| `pipeline/` 수집 파이프라인 | **yang (나)** | 동작함. 스케줄러 이관 필요 |
| `db/schema.ts` 스키마 | **yang (나)** — 원안은 songhaeunsong | 확정. DB 반영 대기 |
| `app/**` UI | jin / ppoddo | **손대지 않음.** 재작성 예정 |
| `app/api/**` 백엔드 | 미정 | `db/schema.ts` 기준으로 **재작성 예정** |

---

## 1. 이번에 한 것

### 1-1. 중복 파이프라인·구 스키마 제거 (22개 파일, ~1,876줄)

이 레포에는 수집 파이프라인이 **3벌** 있었다. 하나만 남겼다.

```
lib/bootstrap-trends.ts  db-setup.ts  trend-pipeline.ts  trends-service.ts
lib/google-news-collector.ts  google-news-rss.ts  google-trends.ts
lib/youtube-api.ts  youtube-collector.ts  youtube-seed-queries.ts
lib/pipeline-v-he/**            ← songhaeunsong의 병렬 파이프라인 (vhe_* 테이블)
scripts/db-setup.mjs  db-seed.mjs  db-check.mjs  trend-seed-data.mjs
scripts/collection-report-v-he.mjs  run-pipeline-v-he.sh
db/schema.ts (구)               ← 통합 스키마와 테이블 이름이 충돌하던 것
```

**왜 지워야 했나 — 선택이 아니라 필수였다.** 구 `db/schema.ts`와 통합 스키마가
`sources` / `keywords` / `trend_snapshots` / `trend_contents` **같은 테이블 이름을
서로 다른 컬럼으로** 정의하고 있었다. 한 DB에 공존이 불가능하다:

- `keywords`: 구 = `category varchar NOT NULL` / 신 = `slug NOT NULL` + `category_id` FK
- `trend_snapshots`: 신에 **`run_id NOT NULL`** 추가 → 구 수집기의 INSERT는 전부 실패
- PK 타입 `integer` → `bigint`

### 1-2. 네이밍 정리

| 이전 | 이후 | 이유 |
| --- | --- | --- |
| `trend-rising/` | **`pipeline/`** | rising(급상승) → popular(인기) 방식으로 전환했는데 폴더명만 잔재로 남아 있었음 |
| `db/unified-schema.ts` | **`db/schema.ts`** | 구 스키마가 사라져 "unified" 수식어가 무의미. drizzle 관례에도 맞음 |
| `drizzle.config.unified.mjs` + `drizzle/unified/` | **`drizzle.config.mjs`** + `drizzle/` | 위와 동일 |
| `npm run db:push:unified` | **`npm run db:push`** | 위와 동일 |
| `collection_runs.pipeline` = `'trend-rising-collect'` / `'trend-rising-popular'` | **`'collect'` / `'popular'`** | 폴더명과 어긋나지 않게 |

**일부러 안 바꾼 것:** `docs/trend-rising-rename-plan.md` 파일명.
**당시 기록**이라 그때 이름이 그대로 있어야 정확하다.

### 1-3. 로그 삭제 (자격증명 노출)

`pipeline/.data/launchd.err.log`에 `ANTHROPIC_API_KEY`가 평문으로 찍혀 있었다.
(8/3 셸 오류 — `.env.local` sourcing 실패 시 값이 명령어로 해석돼 에러 메시지에 노출.
현재 `.env.local`은 정상 sourcing되므로 원인 자체는 해결된 상태.)

로그 3개(`launchd.err.log` `launchd.out.log` `hourly.log`)를 삭제했다.

> ⚠️ **미확인 항목:** 로그의 키는 현재 `.env.local`의 키와 **다르다**(해시 비교).
> 이미 교체한 것으로 보이나, **옛 키가 Anthropic 콘솔에서 폐기됐는지 확인 필요.**

---

## 2. 지금 구조

```
TrendDrop/
├── pipeline/              ← 내 담당. 수집 파이프라인 (자립 — lib/·db/ import 0건)
│   ├── collect.mjs            5개 소스 병렬 스크래핑 → raw_signals
│   ├── rank-popular.mjs       최근 6시간 재계산 → trend_snapshots (--save)
│   ├── backfill-popular.mjs   과거 전 구간 재계산 (API 0회)
│   ├── popular.mjs            가중치·참여도 보정 → 후보 50개
│   ├── verdict.mjs            LLM 판정 (keyword_verdicts 캐시)
│   ├── tokenize.mjs  store.mjs  seed.mjs  warm-verdicts.mjs
│   ├── sources/               dcbest · theqoo · instiz · youtube · gtrends
│   ├── run-hourly.sh          launchd가 매시 정각 호출 (로컬 전용 — Actions에선 안 씀)
│   ├── PIPELINE.md            ★ 파이프라인 상세 설계 문서 (먼저 읽을 것)
│   └── TODO.md                ★ 미해결 과제 5건
│
├── db/schema.ts           ← 내 담당. 스키마 단일 소유자
├── drizzle.config.mjs     ← db/schema.ts를 가리킴
├── drizzle/               ← 생성된 DDL + 스냅샷
│
├── app/  components/      ← 팀 UI/API. 무수정. 재작성 예정
├── lib/                   ← docs.ts · env.ts · trend-data.ts · trend-timeline.ts (UI 자산만 남음)
├── scripts/verify-ui.mjs  ← UI 품질 게이트
└── docs/                  ← 리서치·설계 문서
```

### `pipeline/.data/` — 지우면 안 되는 것

gitignore라 **이 머신에만 존재**한다. 재수집 불가·비용 발생분이라 백업 가치가 있다.

| 파일 | 내용 |
| --- | --- |
| `raw-items-snapshot.json` (6.4M) | 원문 스냅샷. `seed.mjs`의 입력 |
| `pre-unified-backup.json` (2.5M) | 004 마이그레이션 직전 백업 (sources/raw_signals/keyword_verdicts) |
| `backups/pre-schema-sync-*.sql` (1.4M) | 스키마 동기화 직전 pg_dump |

---

## 3. 확정한 방향 (2026-08-16 논의 결과)

```
DB 호스팅        Neon (클라우드 Postgres)
스키마·마이그레이션  drizzle 하나로 통일
pipeline/        변경 없음 — 이미 그대로 붙는다
스케줄러         로컬 테스트 → GitHub Actions
```

**왜 Neon인가.** 이 파이프라인은 매시간 몇 분 일하고 나머지는 논다(90%+ 유휴).
Neon은 유휴가 이어지면 컴퓨트를 정지시키고(scale-to-zero) 그동안 과금하지 않는다 —
워크로드 모양이 맞는다. "무료라서"가 아니라 "모양이 맞아서"가 이유고, 유료로 가도
같은 이유로 저렴하다. 콜드 스타트(수백 ms)는 배치 작업엔 무의미하지만,
**나중에 API/UI를 붙이면 첫 방문자가 그만큼 기다린다** — 그때 다시 판단할 것.

> ⚠️ `raw_signals`는 계속 쌓인다. 실측 기준 버킷당 195행 · 행당 ~305 bytes →
> **연 170만 행 / 약 1GB**. 원문은 재계산의 근거라 함부로 못 지운다(그게 설계의 핵심).
> 1년치는 여유롭지만 언젠가 정리 정책이 필요해진다.

**왜 drizzle로 통일인가.** 지금 마이그레이션 체계가 둘이었다 —
`drizzle/`(추적 있음)과 `pipeline/migrations/`(손으로 `psql -f`, **추적 없음**).
진짜 문제는 후자였다: "005를 돌렸던가?"를 확인할 방법이 없었다.
drizzle-kit은 `generate` → `migrate`로 적용 이력을 DB에 기록하고 순서를 보장한다.
생성되는 건 그냥 `.sql`이라 **데이터 이전이 필요하면 그 파일에 직접 써넣으면 된다** —
파이프라인의 생 SQL 세계와 다르지 않다.

- **스키마 구조 변경** (컬럼 추가/삭제, 인덱스) → drizzle이 자동 생성
- **데이터 값 변경** (기존 행의 값 옮기기) → 자동 추론 불가. 생성된 `.sql`에 직접 작성
- 둘이 얽히면 3단계: 컬럼 추가 → 데이터 채우기(직접) → 옛 컬럼 삭제

그래서 `pipeline/migrations/`(001~005)는 **삭제했다.** 이미 적용된 과거 기록이고,
새 DB는 `drizzle/0000_certain_tattoo.sql`이 최종 상태를 한 번에 만든다. git 이력에 남아 있다.

**`pipeline/`은 코드 변경이 없다.** 확인 결과 Neon에 그대로 붙는다:
`DATABASE_URL` 환경변수만 읽고, `prepare: false`(Neon 풀러 호환)가 이미 설정돼 있고,
SSL은 연결 문자열의 `sslmode=require`를 postgres.js가 처리하며, 테이블을 만들지 않아
drizzle과 역할이 겹치지 않는다. 손볼 건 `run-hourly.sh` 하나인데 이건 로컬 launchd
전용이라 Actions에선 아예 안 쓴다.

---

## 3-1. 다음 할 일 (순서대로)

- [ ] **Neon 프로젝트 생성** → 연결 문자열 확보
- [ ] **`npm run db:push`** — `db/schema.ts`를 Neon에 반영
      (또는 `psql "$NEON_URL" -f drizzle/0000_certain_tattoo.sql` — 동등)
- [ ] **`db:push` → `db:generate` + `migrate`로 전환**
      실 DB가 생기면 push는 이력이 안 남고 되돌릴 수 없어 위험하다.
      `package.json`에 `"db:migrate": "drizzle-kit migrate --config=drizzle.config.mjs"` 추가.
- [ ] **로컬에서 `DATABASE_URL`만 Neon으로 바꿔 1회 실행** — `npm run collect` → `npm run rank`
      ★ 이 단계를 건너뛰면 Actions 실패 시 원인이 DB인지 러너인지 구분이 안 된다
- [ ] **데이터 이전** — `raw_signals` + `keyword_verdicts`만 옮기고
      `node pipeline/backfill-popular.mjs --reset`으로 파생 재생성 (API 0회).
      전체 pg_dump보다 이 방식이 깔끔하다 — 원문만 있으면 나머지는 언제든 재계산된다.
- [ ] **GitHub Actions 워크플로 생성** (아래 4절)
- [ ] **소스별 수집 건수 대조** → 이상 없으면 launchd 비활성화
- [ ] **`app/api/**` 재작성** — `db/schema.ts` 기준. 근거 문서: `docs/unified-schema-api-spec.md`
- [ ] `pipeline/TODO.md`의 미해결 과제 5건 (이슈 파편화, 카테고리 계수 등)

> **`005` 마이그레이션은 실행할 필요가 없어졌다.** `collection_runs.pipeline` 값에서
> `trend-rising-` 접두사를 떼는 UPDATE였는데, Neon에서 새로 시작하면 그런 값을 가진 행이
> 애초에 없다. `backfill-popular.mjs --reset`이 새 코드 기준(`collect`/`popular`)으로
> `collection_runs`를 다시 만든다. **로컬 pg를 계속 쓸 때만 필요했고, 파일은 삭제됐다**
> (git 이력에서 복구 가능).

---

## 4. 스케줄러: launchd(현재) → GitHub Actions(목표)

**현재.** `~/Library/LaunchAgents/com.trendrising.hourly.plist` → `pipeline/run-hourly.sh`.
경로는 `pipeline/`으로 고쳐 뒀지만 **작업이 `disabled` 상태**이고 마지막 실행 로그는
**8월 4일**이 끝이다. 로컬에서 다시 돌리려면:

```bash
launchctl enable "gui/$(id -u)/com.trendrising.hourly"
launchctl bootstrap "gui/$(id -u)" ~/Library/LaunchAgents/com.trendrising.hourly.plist
```
(plist 라벨은 아직 `com.trendrising.hourly` — 바꾸려면 파일명·라벨 변경 후 재등록)

**워크플로 뼈대** (`.github/workflows/pipeline.yml` — 아직 안 만듦):

```yaml
name: hourly pipeline
on:
  schedule:
    - cron: "5 * * * *"     # UTC. 정각이 아니라 5분 뒤 — 아래 ② 참고
  workflow_dispatch:         # 수동 실행 버튼 (디버깅에 필수)

jobs:
  run:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: node pipeline/collect.mjs
      - run: node pipeline/rank-popular.mjs --save
    env:
      DATABASE_URL:      ${{ secrets.DATABASE_URL }}
      YOUTUBE_API_KEY:   ${{ secrets.YOUTUBE_API_KEY }}
      ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

`run-hourly.sh`는 절대 경로(`/Users/yang/...`)·nvm 경로·로컬 pg 기동 로직이 박혀 있어
그대로 못 쓴다. 실제로 필요한 건 위의 두 줄뿐이다.

**함정 4가지:**

① **시간대는 안전하다 (확인 완료).** `collect.mjs`의 `hourBucket()`이
`setMinutes(0,0,0)` 후 `toISOString()`인데, **KST는 UTC+9 정시 오프셋이고 서머타임이
없어서** 정시 내림 결과가 UTC에서든 KST에서든 같은 순간이다. 러너가 UTC라도
버킷은 안 틀어진다. (로그의 KST 표시 문자열만 다름)

② **cron은 밀린다.** 러너 혼잡 시 수십 분 지연이 흔하다. 이 파이프라인은
**1시간 버킷** 기준이라 밀리면 버킷이 비거나 겹칠 수 있다. 정각(`0 * * * *`) 대신
**`5 * * * *`** 로 두면 밀려도 같은 버킷 안에 떨어질 확률이 높다.

③ **60일 무활동이면 GitHub이 스케줄을 자동으로 끈다.** 커밋이 뜸해지면 조용히 멈춘다 —
가장 자주 당하는 함정.

④ **스크래핑 차단 위험.** dcbest·theqoo·instiz는 HTML 스크래핑이라 GitHub 러너 IP
대역이 막힐 수 있다. **이관 직후 소스별 수집 건수를 로컬 실행과 반드시 대조할 것.**
한 소스만 0건이 되면 조용히 품질이 떨어진다. 막히면 그 소스만 별도 경로(자체 서버/프록시)가
필요하다.

> **DB 이전이 선행되어야 한다.** `DATABASE_URL`이 `localhost:5432/trenddrop`인 상태로는
> 러너에서 아무것도 안 된다. 레포는 원래 Neon 전제로 시작했고(커밋 `6f946cc`,
> `docs/page-analysis-and-backend-design.md`), 로컬 pg는 파이프라인 개발용으로
> 나중에 붙인 것이다.

---

## 5. 팀 조율 필요 (master 머지 전)

- **`lib/pipeline-v-he/**` 삭제** — songhaeunsong 작업물이고
  `songhaeunsong/feat/trend-pipeline-v-he` 브랜치가 아직 살아 있다. 공지 필요.
- **`app/api/**`의 import 9곳이 끊긴 상태다** (`app/api/trends`,
  `admin/collect/*`, `admin/bootstrap`, `admin/db/setup`, `google-news/preview`,
  `app/collection-log`). 의도한 것 — API 재작성 때 해소된다.
  **그래서 지금 `next build`와 `npm run verify:ui`는 실패한다.**
- **`categories` 마스터 목록** — 현재 UI 축(푸드/뷰티/테크)과
  파이프라인의 `content_type`(인물/사건사고/스포츠…)이 안 맞는다.
  자세한 내용은 `pipeline/PIPELINE.md` 마지막 절.

---

## 6. 자주 쓰는 명령

```bash
npm run db:push     # db/schema.ts → DB 반영
npm run collect     # 5개 소스 수집 → raw_signals
npm run rank        # 최근 6시간 랭킹 계산 → trend_snapshots (--save 포함)

node pipeline/backfill-popular.mjs --reset   # 과거 전 구간 재계산 (API 0회)
node pipeline/warm-verdicts.mjs --dry        # LLM 판정 캐시 예열
```

---

## 7. 용어

| 용어 | 뜻 |
| --- | --- |
| **Neon** | Postgres를 서버 관리 없이 빌려 쓰는 클라우드 서비스. 설치·기동 없이 연결 문자열 하나로 어디서든 접근 |
| **유휴(idle)** | DB에 접속도 쿼리도 없는 상태. 이 파이프라인은 매시간 몇 분만 일해서 90% 이상이 유휴 |
| **scale-to-zero** | 유휴가 이어지면 **컴퓨트(쿼리 처리 프로세스)를 정지**시키고 과금을 멈추는 것. **데이터는 스토리지에 그대로 남는다** — 노트북 절전 모드에 가깝다. 다음 접속 때 자동 기동(콜드 스타트 수백 ms) |
| **drizzle-orm** | TypeScript로 스키마를 정의(`pgTable`)하고 타입 안전 쿼리를 짜는 라이브러리. **지금은 스키마 정의로만 쓴다** — 쿼리 빌더는 API 재작성 때 |
| **drizzle-kit** | `db/schema.ts`를 실제 DB에 반영하는 CLI. `push`(즉시 반영, 이력 없음) / `generate`+`migrate`(파일로 남기고 적용, 이력 추적) |
| **버킷(bucket)** | 수집 원문을 묶는 1시간 단위(정시로 내림). 같은 버킷·같은 소스의 같은 글은 중복 제거되지만, 3시간 머문 글은 3개 버킷에 3번 저장돼 체류시간이 점수에 반영된다 |

> **파이프라인은 drizzle을 런타임에 쓰지 않는다.** `pipeline/**`에 import가 0건이고
> `store.mjs`는 `postgres` 패키지로 생 SQL을 쓴다. drizzle의 역할은 **테이블을 만드는 것**뿐이다.
>
> ```
> db/schema.ts       ─ drizzle-kit ─▶  테이블 생성/변경   (스키마 바뀔 때마다)
> pipeline/store.mjs ─ 생 SQL ──────▶  데이터 적재        (매시간)
> app/api/** (예정)  ─ drizzle-orm ─▶  데이터 조회        (타입 안전 쿼리)
> ```

---

## 8. 먼저 읽을 문서

| 문서 | 내용 |
| --- | --- |
| `pipeline/PIPELINE.md` | 파이프라인 전체 흐름·소스별 수집 방식·점수 계산 |
| `pipeline/TODO.md` | 미해결 과제 5건 |
| `docs/unified-schema-api-spec.md` | **현행** 스키마·API 사양 (API 재작성의 기준) |
| `docs/trend-rising-rename-plan.md` | 스키마 통합 시 컬럼 이름 매핑 근거 |
| `docs/page-analysis-and-backend-design.md` | 페이지별 필요 데이터 → 백엔드 설계 |
