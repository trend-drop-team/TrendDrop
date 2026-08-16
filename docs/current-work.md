# 작업 현황 — 파이프라인 & DB (yang)

> 다음 세션 인수인계용. **최종 갱신: 2026-08-16**
> 브랜치: `feat/trend-rising-schema` (master 미머지)
>
> **다음 세션 첫 할 일: GitHub Actions 워크플로 생성 (§4).** DB는 Neon에 올라갔고
> 로컬에서 `collect` → `rank`까지 도는 것을 확인했다(§1-7). 선행 조건은 모두 해소됐다.

---

## 0. 한 줄 요약

TrendDrop은 팀 프로젝트고, **나(yang)는 데이터 수집 파이프라인(`pipeline/`)과 DB를 맡는다.**
잔재를 걷어내고 이름을 정리한 뒤, **Neon에 DB를 실제로 띄우고 파이프라인 전 구간을 돌렸다.**
남은 건 스케줄러를 GitHub Actions로 옮기는 것이다.

| 영역 | 담당 | 상태 |
| --- | --- | --- |
| `pipeline/` 수집 파이프라인 | **yang (나)** | **Neon에서 동작 확인.** 스케줄러 이관만 남음 |
| `db/schema.ts` 스키마 | **yang (나)** — 원안은 songhaeunsong | 확정. **Neon 반영 완료** |
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

### 1-4. Neon 이전 — DB를 실제로 띄웠다

```
프로젝트    Neon / aws-us-east-1 (N. Virginia)
엔드포인트  ep-red-pine-av0rffus
서버        PostgreSQL 18.4
DB / 계정   neondb / neondb_owner
```

**리전을 버지니아로 잡은 이유.** Neon에 도쿄·서울 리전이 없다(아시아는 싱가포르·시드니뿐).
최종 실행 위치가 GitHub Actions 러너(대부분 US)라 거기 붙는 게 맞다. `store.mjs`가
행 단위 INSERT를 루프로 돌려서(`store.mjs:148`, `store.mjs:324`) 왕복 지연이 행 수만큼
곱해지는데, 러너 기준으로 버지니아가 압도적으로 가깝다. 나중에 UI를 붙여 한국 사용자
응답이 문제가 되면 그건 리전이 아니라 캐싱으로 푸는 게 맞다 — 트렌드 데이터는 시간
단위로만 바뀐다.

**`.env.local` 구성.**

```
# DATABASE_URL=postgres://...@localhost:5432/trenddrop   ← 로컬 pg. 주석 처리
DATABASE_URL=...ep-red-pine-av0rffus...neon.tech/neondb        ← direct
DATABASE_URL_POOLED=...ep-red-pine-av0rffus-pooler...          ← pooled
```

`-pooler`가 붙은 쪽은 PgBouncer를 거친다. 접속을 돌려막아 동시 접속 상한이 높지만
**트랜잭션이 끝나면 세션 상태가 날아간다.** `store.mjs`의 `prepare: false`가 정확히
이걸 위한 설정이다.

- **`DATABASE_URL`에 direct를 넣었다.** DDL(`db:migrate`)은 세션이 유지되는 쪽이 안전하고,
  파이프라인은 매시간 프로세스 하나뿐이라 접속이 몰릴 일이 없다.
- **`DATABASE_URL_POOLED`는 현재 어떤 코드도 읽지 않는다.** `app/api/**` 재작성 때
  쓰려고 적어둔 메모다. 그때는 요청마다 접속이 생기므로 pooled가 필요해진다.

### 1-5. `db:push` → `db:generate` + `db:migrate` 전환 (완료)

`db:push`는 `drizzle.config.mjs`의 `strict: true` 때문에 확인 프롬프트를 띄우는데,
TTY가 없는 환경에선 거기서 멈춘다. 어차피 넘어갈 예정이었으므로 이 참에 전환했다.

`db:generate`로 확인한 결과 `drizzle/0000_certain_tattoo.sql`이 현재 `db/schema.ts`와
일치했고(`No schema changes`), `db:migrate`로 적용해 **테이블 11개가 생성**됐다.

**`package.json`의 `db:*` 스크립트 3개를 고쳤다.** 원래 `drizzle-kit`을 그냥 호출해서
`.env.local`을 못 읽었다 — `DATABASE_URL`이 빈 문자열이었다.

```
"db:generate": "node --env-file=.env.local node_modules/drizzle-kit/bin.cjs generate --config=drizzle.config.mjs"
"db:migrate":  "node --env-file=.env.local node_modules/drizzle-kit/bin.cjs migrate  --config=drizzle.config.mjs"   ← 신규
"db:push":     (동일 패턴. 이제 안 쓴다)
```

`node_modules/drizzle-kit/bin.cjs`를 직접 가리키는 이유는 `--env-file`이 셸 shim을
거치면 안 먹기 때문이다.

### 1-6. `__drizzle_migrations`를 `public` 스키마로 이동

drizzle은 적용 이력 테이블을 기본적으로 **별도 `drizzle` 스키마**에 만든다. 그런데
Neon 콘솔 Tables 화면은 스키마를 하나씩만 보여줘서, `public`만 보면 이력 테이블이
안 보인다. 매번 드롭다운을 바꾸는 게 번거로워 `public`으로 끌어냈다.

```sql
ALTER TABLE drizzle.__drizzle_migrations SET SCHEMA public;
DROP SCHEMA drizzle;
```

그리고 `drizzle.config.mjs`에 위치를 알려줬다(주석으로 이유도 남김):

```js
migrations: { table: "__drizzle_migrations", schema: "public" },
```

**순서가 중요하다.** 설정을 먼저 바꾸면 drizzle이 새 위치에서 이력을 못 찾아
`0000`을 재실행하려 들고, 이미 있는 테이블이라 실패한다. 테이블을 먼저 옮겨야 한다.
전환 후 `db:migrate`를 다시 돌려 **재실행되지 않는 것**으로 검증했다.

> 이력 테이블은 파일 **이름**이 아니라 `.sql` **내용의 SHA256**을 저장한다.
> 그래서 폴더를 옮겨도 인식이 유지되지만, 반대로 **이미 적용된 `.sql`을 수정하면
> 해시가 어긋난다.** 적용된 마이그레이션 파일은 손대지 말고 새 마이그레이션을 만들 것.

### 1-7. 로컬에서 Neon 상대로 파이프라인 1회 실행 (성공)

```
npm run collect   →  dcbest 49 · theqoo 20 · instiz 10 · youtube 110 · gtrends 10
                     총 199건 → raw_signals / collection_runs #1 (pipeline='collect', success)
npm run rank      →  후보 962 → 필터 통과 49 → LLM 판정(신규 49 · 제거 36)
                     popular run #2 → trend_snapshots 10건
```

**`pipeline/` 코드는 한 줄도 고치지 않았다.** §3에 적어둔 "그대로 붙는다"는 예상이 맞았다.
`collection_runs.pipeline`이 `collect`로 찍힌 것으로 네이밍 정리(1-2절)도 실제 반영을 확인했다.

`rank` 로그의 `⚠️ 5회 수집 누락`은 정상이다 — 6시간 창인데 수집을 한 번만 했다.

---

### 1-8. 데이터 이전은 하지 않기로 했다 (결정)

§3-1에 "로컬 DB에서 `raw_signals` + `keyword_verdicts`를 옮긴다"고 적어뒀으나,
**그 전제가 틀렸다는 걸 확인했다.**

| 위치 | 내용 |
| --- | --- |
| 로컬 pg `trenddrop` | raw_signals **225행 / 버킷 1개 / 8-12 22:00** — 스키마 재연동 후 테스트 1회분 |
| `pipeline/.data/pre-unified-backup.json` | raw_signals **5,451행 / 버킷 28개 / 8-03 11:00 ~ 8-11 13:00** — 진짜 역사 |

로컬 DB는 `스키마 재연동`(cf8e71d) 때 초기화된 것으로 보인다. 즉 옮길 만한 역사는
로컬 DB가 아니라 **JSON 백업에만** 있었다.

**결론: 아무것도 옮기지 않고 Neon에서 새로 시작한다.** 오늘 수집한 199건이 시작점이다.

- `keyword_verdicts` 307건도 버렸다. 8/3~8/11에 뜬 키워드 판정이라 오늘 후보와
  겹칠 게 거의 없어 캐시 적중률이 낮다.
- **JSON 백업 파일은 지우지 않았다.** 마음이 바뀌면 언제든 넣을 수 있다.

**나중에 넣기로 한다면 걸림돌은 하나뿐이다 — `raw_signals.run_id NOT NULL`.**
JSON은 이 컬럼이 생기기 전 백업이라 값이 없다(1-1절에 적어둔 그 문제가 여기도 걸린다).
버킷 28개마다 `collection_runs` 1행씩 합성해 붙이면 된다. 나머지는 확인해뒀다:

- `sources` id가 양쪽 1~5로 **완전히 일치** → `source_id` 재매핑 불필요
- `keyword_verdicts`는 JSON 키가 컬럼과 **정확히 일치**(`content_type` 포함) → 그대로 INSERT

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
├── drizzle.config.mjs     ← db/schema.ts를 가리킴 + 이력 테이블 위치 지정(1-6절)
├── drizzle/               ← 통째로 커밋할 것
│   ├── 0000_certain_tattoo.sql    DB에 실제로 실행되는 SQL
│   └── meta/
│       ├── _journal.json          순서 목차
│       └── 0000_snapshot.json     적용 후 스키마 상태 — 다음 generate의 비교 기준
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

> ⚠️ **무료 플랜 스토리지가 0.5GB다 — 여기에 시한이 붙는다.**
> `raw_signals`는 계속 쌓인다. 실측 기준 버킷당 195행 · 행당 ~305 bytes →
> **연 170만 행 / 약 1GB**. 즉 **6개월쯤 뒤에 한도에 닿는다.**
> 한도를 넘으면 데이터가 지워지는 게 아니라 **INSERT/UPDATE/DELETE가 실패한다.**
> Actions는 초록불인데 데이터만 안 늘어나는, 알아채기 어려운 형태로 멈춘다.
> 원문은 재계산의 근거라 함부로 못 지운다(그게 설계의 핵심) — **정리 정책이
> "언젠가"가 아니라 6개월짜리 과제다.** 현재 DB 크기는 8.2MB.

**무료 플랜 실측 한도** (2026-08 기준, 프로젝트당):

| 항목 | 한도 | 우리 소비 |
| --- | --- | --- |
| 스토리지 | 0.5 GB | 8.2 MB → 연 ~1GB 증가 ⚠️ |
| 컴퓨트 | 100 CU-hour/월 | 매시간 몇 분 + 유휴 5분 → 월 ~30 CU-hour. 여유 |
| scale-to-zero | 5분 고정, **해제 불가** | 배치 작업이라 무관. 콜드 스타트 실측 2.5초 |
| 프로젝트 수 | 100 | 1 |

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

**끝난 것** (2026-08-16)

- [x] **Neon 프로젝트 생성** → `aws-us-east-1` / PostgreSQL 18.4 (1-4절)
- [x] **스키마 반영** — `db:migrate`로 `0000_certain_tattoo` 적용, 테이블 11개 (1-5절)
- [x] **`db:push` → `db:generate` + `db:migrate` 전환** (1-5절)
- [x] **`__drizzle_migrations`를 `public` 스키마로 이동** (1-6절)
- [x] **로컬에서 Neon 상대로 1회 실행** — `collect` 199건 → `rank` snapshots 10건 (1-7절)
- [x] ~~데이터 이전~~ → **안 하기로 결정.** Neon에서 새로 시작 (1-8절)

**남은 것** (순서대로)

- [ ] **GitHub Actions 워크플로 생성** (아래 4절)
      ★ **선행 조건이던 DB 이전은 해소됐다.** `DATABASE_URL`이 이제 Neon을 가리키므로
      러너에서 그대로 돈다. `secrets`에 `DATABASE_URL`(direct) · `YOUTUBE_API_KEY` ·
      `ANTHROPIC_API_KEY` 세 개를 넣으면 된다.
- [ ] **소스별 수집 건수 대조** → 이상 없으면 launchd 비활성화
      기준값(로컬 실측, 2026-08-16 13:00 버킷): **dcbest 49 · theqoo 20 · instiz 10 ·
      youtube 110 · gtrends 10 = 199건.** 러너에서 한 소스만 0건이면 IP 차단이다(4절 ④).
- [ ] **`app/api/**` 재작성** — `db/schema.ts` 기준. 근거 문서: `docs/unified-schema-api-spec.md`
      이때 `DATABASE_URL_POOLED`를 쓴다(1-4절). 요청마다 접속이 생기므로 direct는 상한에 걸린다.
- [ ] **`raw_signals` 정리 정책** — 무료 0.5GB에 6개월 시한이 붙어 있다 (3절 표)
- [ ] `pipeline/TODO.md`의 미해결 과제 5건 (이슈 파편화, 카테고리 계수 등)
- [ ] **옛 `ANTHROPIC_API_KEY` 폐기 확인** (1-3절 미확인 항목 — 아직 안 함)

> **`005` 마이그레이션은 실행할 필요가 없어졌다.** `collection_runs.pipeline` 값에서
> `trend-rising-` 접두사를 떼는 UPDATE였는데, Neon에서 새로 시작했으므로 그런 값을 가진
> 행이 애초에 없다. 실제로 오늘 수집분은 `collect`로 찍혔다. 파일은 삭제됐다
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

> ~~**DB 이전이 선행되어야 한다.**~~ **해소됐다 (2026-08-16).** `DATABASE_URL`이 이제
> Neon을 가리키고, 로컬에서 같은 DB 상대로 `collect` → `rank`가 도는 것까지 확인했다(1-7절).
> 러너에는 `secrets.DATABASE_URL`로 같은 direct 문자열을 넣으면 된다.
>
> 로컬 pg(`brew services postgresql@14`)는 **정지 상태로 두었다.** 파이프라인 개발용으로
> 나중에 붙인 것이고 이제 쓰지 않는다. 레포는 원래 Neon 전제로 시작했다
> (커밋 `6f946cc`, `docs/page-analysis-and-backend-design.md`).

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
npm run collect     # 5개 소스 수집 → raw_signals (원문만 쌓는다. 판단·점수 없음)
npm run rank        # 최근 6시간 랭킹 계산 → trend_snapshots (--save 포함)

node pipeline/backfill-popular.mjs --reset   # 과거 전 구간 재계산 (API 0회)
node pipeline/warm-verdicts.mjs --dry        # LLM 판정 캐시 예열
```

**스키마를 바꿀 때** — `db:push`는 쓰지 않는다(아래 주의).

```bash
# 1) db/schema.ts 수정
npm run db:generate   # 2) → drizzle/0001_xxx.sql 생성. DB 연결 불필요
                      # 3) 생성된 .sql을 눈으로 확인 ★ 건너뛰지 말 것
npm run db:migrate    # 4) → 안 돌린 것만 DB에 적용 + __drizzle_migrations에 기록
                      # 5) 커밋 (db/schema.ts + drizzle/ 통째로)
```

> **`.sql`을 확인하는 단계가 핵심이다.** drizzle이 추론하는 건 구조 변경(컬럼 추가·삭제·
> 인덱스)뿐이고 **기존 행의 값을 옮기는 건 추론하지 못한다.** 컬럼 이름을 바꾸면 종종
> "옛 컬럼 DROP + 새 컬럼 ADD"로 뽑는데 그러면 데이터가 날아간다. 그럴 땐 생성된 `.sql`을
> `ALTER TABLE ... RENAME COLUMN`으로 직접 고쳐 쓰면 된다 — 그냥 SQL 파일이라 손대도 된다.

> ⚠️ **`npm run db:push`는 이제 쓰지 않는다.** 파일도 이력도 남기지 않고 DB를 즉시
> 바꾼다. 실 DB가 생긴 이상 되돌릴 근거가 없어 위험하다. 스크립트는 남아 있을 뿐이다.

> ⚠️ **Neon 콘솔 SQL Editor로 `ALTER TABLE`을 치지 말 것.** drizzle은 실제 DB가 아니라
> `drizzle/meta/` 스냅샷을 기준으로 diff를 뜬다. 콘솔로 직접 고치면 스냅샷과 현실이
> 어긋나고, 다음 `db:generate`가 엉뚱한 SQL을 뽑는다. 조회(`SELECT`)는 얼마든지 괜찮다.

---

## 7. 용어

| 용어 | 뜻 |
| --- | --- |
| **Neon** | Postgres를 서버 관리 없이 빌려 쓰는 클라우드 서비스. 설치·기동 없이 연결 문자열 하나로 어디서든 접근 |
| **유휴(idle)** | DB에 접속도 쿼리도 없는 상태. 이 파이프라인은 매시간 몇 분만 일해서 90% 이상이 유휴 |
| **scale-to-zero** | 유휴가 이어지면 **컴퓨트(쿼리 처리 프로세스)를 정지**시키고 과금을 멈추는 것. **데이터는 스토리지에 그대로 남는다** — 노트북 절전 모드에 가깝다. 다음 접속 때 자동 기동(**실측 2.5초**) |
| **pooler / pooled 연결** | Postgres 앞에 서는 중개자(PgBouncer). 접속을 돌려막아 동시 접속 상한을 올린다. Neon은 주소에 **`-pooler`**를 붙여 구분한다. **같은 DB, 가는 길만 다르다.** 대신 트랜잭션이 끝나면 세션 상태가 날아가므로 `prepare: false`가 필요하다 |
| **direct 연결** | `-pooler` 없는 주소. Postgres에 바로 붙는다. 세션이 유지되므로 **DDL(마이그레이션)에 쓴다** |
| **drizzle-orm** | TypeScript로 스키마를 정의(`pgTable`)하고 타입 안전 쿼리를 짜는 라이브러리. **지금은 스키마 정의로만 쓴다** — 쿼리 빌더는 API 재작성 때 |
| **drizzle-kit** | `db/schema.ts`를 실제 DB에 반영하는 CLI. `generate`(파일 생성, DB 연결 불필요) → `migrate`(DB 적용 + 이력 기록). `push`는 즉시 반영하되 이력이 없어 **이제 안 쓴다** |
| **`__drizzle_migrations`** | **어떤 마이그레이션을 실제로 돌렸는지 DB에 남는 기록.** 레포에는 없고 DB 안에만 있다. 파일 이름이 아니라 `.sql` **내용의 SHA256**을 저장한다. 기본은 별도 `drizzle` 스키마인데 우리는 `public`으로 옮겼다(1-6절) |
| **스냅샷 (`drizzle/meta/`)** | "이 마이그레이션까지 적용하면 스키마가 이런 모습"을 JSON으로 찍어둔 것. **DB에 가지 않는다.** 다음 `generate`가 diff를 뜨는 기준이라 **반드시 커밋해야 한다** |
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
