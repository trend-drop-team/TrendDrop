# 데이터 수집 파이프라인 (pipeline/)

커뮤니티·유튜브·구글트렌드에서 매시간 원문을 긁어와, **"지금 많이 언급되는 키워드" top10**을 만들어 Postgres에 쌓는다. 원래는 "평소 대비 갑자기 늘어난 단어"를 뽑는 급상승(rising) 방식이었으나 **인기(popular) 방식으로 전환**했다. 예전 폴더 이름 `trend-rising/`이 그때의 잔재였고, 이번에 `pipeline/`으로 정리했다 — `rank-popular.mjs`·`backfill-popular.mjs`처럼 파일 이름은 이미 현재 방식(popular)을 따르고 있었다.

**스키마는 `db/schema.ts`가 소유한다.** 이 파이프라인은 테이블을 스스로 만들지 않고(`store.mjs`가 DDL을 안 함), 이미 존재하는 스키마에 데이터만 넣는다. DB는 **Neon**(클라우드 Postgres)이고, 스키마 반영은 **drizzle-kit**이 한다 — 구성과 절차는 8장.

---

## 0. 전체 흐름

**수집과 랭킹은 이제 서로 다른 주기로 따로 돈다.** GitHub Actions 워크플로가 각각 하나씩이다.

```
collect.yml — 매시 :05  (cron "5 * * * *")
    │
    └─▶ collect.mjs ─────────────────────────────────────────
          collection_runs 1행 생성 (pipeline='collect')
          5개 소스 병렬 스크래핑
          raw_signals에 N행 INSERT (run_id = 방금 만든 run)
          collection_runs 그 행 UPDATE (status/raw_signal_count)

rank.yml — 2시간마다 :20  (cron "20 */2 * * *")
    │
    └─▶ rank-popular.mjs --save ─────────────────────────────
          최근 6시간 raw_signals 읽기 (SELECT만)
          tokenize.mjs로 토큰화
          popular.mjs: 소스별 가중치 + 참여도 보정 → 후보 50개, term별 velocity 계산
          verdict.mjs: LLM 판정으로 노이즈 제거·복원·병합 (keyword_verdicts 캐시) → top10
          store.mjs:
            collection_runs 1행 생성 (pipeline='popular')
            keywords UPSERT (신규 term만 승격)
            trend_snapshots에 top10 INSERT (run_id = 방금 만든 run, keyword_id로 연결)
            collection_runs 그 행 UPDATE (keyword_count)
```

**둘의 주기가 다른 이유.** Claude 호출은 `rank`(→`verdict.mjs`)에만 있고 `collect`은 LLM을 쓰지 않는다. 그런데 **`collect`을 늦추면 되돌릴 수 없다** — 버킷이 1시간 단위라 거른 시간대의 글은 이미 사라져 복구가 안 되고, 체류시간 신호(1장)가 절반 해상도로 뭉개진다. 반대로 `rank`는 원문만 있으면 언제든 다시 계산된다. 그래서 **원문 수집은 촘촘하게, 비싼 계산은 성기게** 둔다.

`rank`가 2시간인 건 앱 개발 중 비용을 아끼기 위한 임시 설정이다. 신선도가 중요해지면 `"20 * * * *"`로 바꾸면 된다.

**시각을 :05와 :20으로 어긋나게 뒀다.** 같은 시각이면 `rank`가 `collect`이 아직 쓰는 중인 버킷을 읽어 반쪽짜리 집계가 나온다.

**수집과 랭킹이 분리된 게 핵심이다.** 원문이 DB에 남아 있으므로 가중치를 바꿔도 API를 다시 호출하지 않고 과거 전 구간을 재계산할 수 있다(`backfill-popular.mjs`). LLM 판정도 같은 이유로 캐시에 저장한다 — 비싼 건 한 번, 싼 건 언제든.

그래서 **`collection_runs`에 이 파이프라인이 남기는 run은 두 종류**다 — `pipeline` 컬럼으로 구분되고, 서로 다른 하위 테이블을 소유한다:

| pipeline 값            | 만드는 곳                                 | 빈도         | 소유하는 것                      |
| ---------------------- | ----------------------------------------- | ------------ | -------------------------------- |
| `collect` | `collect.mjs`(+ 1회용 `seed.mjs`)         | 매시간 1건   | 그 실행에서 저장된 `raw_signals` |
| `popular` | `rank-popular.mjs`/`backfill-popular.mjs` | 랭킹마다 1건 | 그 실행의 `trend_snapshots`      |

---

## 1. 수집 — `collect.mjs`

5개 소스를 `Promise.all`로 동시에 긁는다. 한 소스가 실패해도 나머지는 그대로 저장된다.

| 소스      | 대상                                                | 방식          | 저장 단위(unit) |
| --------- | --------------------------------------------------- | ------------- | --------------- |
| `dcbest`  | 디시인사이드 실시간 베스트                          | HTML 스크래핑 | title           |
| `theqoo`  | 더쿠 핫게시판                                       | HTML 스크래핑 | title           |
| `instiz`  | 인스티즈 실시간 인기                                | HTML 스크래핑 | title           |
| `youtube` | 인기 급상승 영상 20개 + 상위 8개 영상의 댓글 15개씩 | 공식 Data API | title + comment |
| `gtrends` | 구글 트렌드 한국 급등검색어 20개                    | 공식 RSS      | title           |

> **네이트판은 2026-08-03에 제외했다.** 사연·신변잡기 위주라 트렌드 키워드가 거의 안 나왔다.

### 이 단계에서 DB에 쓰는 것

```
collection_runs  1행  (pipeline='collect', geo='KR', bucket_at=이번 정시)
raw_signals      N행  (run_id = 위 run, source_id/source/text/text_hash/video_id/meta/bucket_at/captured_at)
sources          최초 1회만 5행 시드 (dcbest/theqoo/instiz/youtube/gtrends)
```

수집한 행은 **1시간 버킷**(정시로 내림)으로 묶인다. `UNIQUE(source_id, text_hash, bucket_at)`이라 같은 시간대·같은 소스의 같은 글은 무시되지만, **디시 실베에 3시간 머문 글은 3개 버킷에 3번 저장**된다 — 체류시간이 자연스럽게 점수에 반영되는 구조.

`meta`(jsonb)에 소스별 부가정보가 들어간다:

- `youtube|title` → `videoId`, `publishedAt`, `viewCount`, `likeCount`, `commentCount`
- `youtube|comment` → `videoId`, `likeCount`
- `gtrends|title` → `rank`, `approxTraffic`("1000+" 형태), `newsTitles`
- `dcbest|title` → `gallery`(출처 갤러리명)

실제 예:

```
collection_runs  id=57  pipeline='collect'  bucket_at='21:00'  raw_signal_count=199
raw_signals      id=5650  run_id=57  source_id=5(gtrends)  source='title'  text='lg그룹'  bucket_at='21:00'
```

---

## 2. 토큰화 — `tokenize.mjs`

제목/댓글 한 줄을 단어 배열로 쪼갠다(DB에 쓰지 않는 순수 변환 단계).

1. URL 제거 → 이모지 제거 → 자모 반복(`ㅋㅋㅋ`) 제거 → 특수문자 제거
2. 공백 분리
3. **조사·어미 접미사 제거** — `에서는`, `습니다`, `까지` 등. 1글자 조사는 남는 어간이 3글자 이상일 때만 뗀다(`김고은`→`김고` 훼손 방지)
4. 필터: 길이 2~20 / 숫자만 아님 / 자모만 아님 / `XX갤` 형태 아님 / 불용어 아님

> 완벽하지 않다. `오디세이`→`오디세`, `변요한`→`요한`처럼 훼손되는 경우가 남는데, 이건 규칙으로 못 막고 **4장의 LLM 판정이 원문을 보고 복원**한다.

---

## 3. 랭킹 계산 — `popular.mjs`

메모리에서만 계산되는 단계(아직 DB에 안 씀). 입력: `raw_signals`를 읽은 행들. 출력: `ranked[]` 배열(term·score·velocity 등).

### 창(window)

기본 **최근 6시간**. **버킷 개수가 아니라 시계 기준**이다 — 수집이 빠진 시간대가 있어도 과거로 더 뻗지 않고 표본만 줄어든다. 기준점은 `now()`가 아니라 `max(bucket_at)`.

### 점수 공식

```
score = Σ (소스별 가중치 × 참여도 보정)  ×  교차 소스 보너스
```

**소스별 기본 가중치**:

| source\|unit                                        | 가중치 |
| --------------------------------------------------- | -----: |
| `gtrends\|title`                                    |     20 |
| `youtube\|title`                                    |     12 |
| `dcbest\|title` / `theqoo\|title` / `instiz\|title` |      4 |
| `youtube\|comment`                                  |      3 |

**참여도 보정** — `meta`가 있을 때만 곱해지고 없으면 ×1:

| 대상               | 공식                             | 범위      |
| ------------------ | -------------------------------- | --------- |
| `gtrends`          | 검색량 기준(500+를 ×1.0)         | ×0.7~×1.8 |
| `youtube\|title`   | 시간당 조회수 + 좋아요           | ×1~×3.5   |
| `youtube\|comment` | 댓글 좋아요 × 그 영상의 확산속도 | ×1~×7     |
| 커뮤니티 3곳       | 조회수·추천수 미수집             | 항상 ×1   |

**교차 소스 보너스** — 2개 이상 소스에 등장하면 ×1.25. **최소 언급 필터** — 2회 이상 언급 또는 gtrends 등장.

### `velocity` — 참여도 보정의 평균 (0.5~10)

토큰 누적 시 이 보정값(`boost`)을 term별로 같이 쌓아서 평균낸다:

```js
entry.boostSum += boost;
entry.boostCount += 1;
// ...
velocity: clamp(entry.boostSum / entry.boostCount, 0.5, 10);
```

커뮤니티만 언급되면 보정이 없어 1점대, 조회수·좋아요·검색량이 높으면 3~5점대 이상으로 나온다. 이 값이 나중에 `trend_snapshots.velocity`로 저장된다.

### 후보 풀 — 왜 50개인가

최종은 top10이지만 **후보 50개**(`POOL`)까지 뽑는다 — 다음 LLM 판정에서 40~50%가 탈락·병합되기 때문. 실측: 50개 → 26개 제거 + 2개 병합 → 22개 생존.

### 중복 제거

같은 행 안 같은 단어는 1회만 카운트(`new Set(tokenize(text))`). 유튜브는 **영상 단위**로도 막아 댓글 15개가 같은 단어를 반복해 점수를 부풀리는 걸 방지.

---

## 4. LLM 판정 — `verdict.mjs`

### 왜 필요한가

토크나이저는 "단어"를 뽑기 때문에 구조적으로 노이즈가 섞인다(문법 조각 `같아서`·`혼자`, 장르 일반어 `배우`·`드라마`, 훼손된 고유명사 `오디세`→오디세이 등). 불용어 목록으로는 못 막는다 — 두더지잡기다.

### 주고받는 것

**보내는 것** (미판정 term만, 예문 포함 — `sample`은 이미 랭킹 결과에 있어 추가 수집 비용 0):

```
- 아나운서 | 점수 40 | 소스 gtrends | 예문: 김윤희 아나운서
```

**받는 것** (JSON schema로 형식 강제):

| 필드        | 내용                                                                            |
| ----------- | ------------------------------------------------------------------------------- |
| `term`      | 입력한 단어                                                                     |
| `keep`      | true/false                                                                      |
| `canonical` | 병합·복원된 이름. 그대로면 null                                                 |
| `category`  | 인물/작품·콘텐츠/기업·주식/사건·사고/재난·속보/정치·사회/스포츠/일반어/문법조각 |
| `reason`    | 판정 이유 한 줄                                                                 |

### 적용 순서 → 이 단계에서 DB에 쓰는 것

```
1. loadVerdicts()   keyword_verdicts 캐시 조회 (term 목록으로)
2. judgeTerms()     미판정 term만 LLM 1회 호출
3. saveVerdicts()   keyword_verdicts UPSERT (term PK, keep/canonical/content_type/reason/sample/model/decided_at)
4. keep=false 제거
5. canonical 병합   같은 이름이면 점수 높은 쪽 하나만 남김(합산 안 함 — 이중계산 방지)
6. 카테고리 계수    현재 전부 1.0 (verdict.mjs의 CATEGORY_WEIGHTS)
7. 재정렬 → top10
```

### 캐시가 비용의 핵심

창이 6시간이고 실행 간격이 그보다 짧아서, 연속한 두 실행의 후보 50개가 크게 겹친다. **LLM에 보내는 건 실행당 최대 50개지만 캐시 히트로 실제 신규 판정은 그중 일부뿐** — 호출이 60초에서 0.13초로 떨어진다.

**겹치는 비율은 실행 주기에 따라 달라진다.** 창 6시간 기준으로:

| 실행 주기 | 창 겹침 | 월 실행 | 판정 시도(50개 기준) |
| --------- | ------- | ------- | -------------------- |
| 1시간 (예전 launchd) | 5/6 ≈ 83% | 730회 | 36,500회 |
| **2시간 (현재 rank.yml)** | **4/6 ≈ 67%** | **360회** | **18,000회** |

주기를 늘리면 실행 횟수는 절반이 되지만 겹침이 줄어 **실행당 신규 판정은 늘어난다.** 그래서 실제 LLM 비용은 정확히 절반이 아니라 그보다 조금 덜 준다.

> ⚠️ **캐시 히트율 실측값은 아직 없다.** Neon에서 새로 시작하면서 `keyword_verdicts`를 비웠다 — 2026-08-16 첫 실행은 `후보 50 → 캐시 0 / 신규 49`였다. 며칠 쌓인 뒤 다시 재야 한다. (`collection_runs`에 실행별 기록이 남으므로 사후 계산 가능)

**한계**: 캐시 키가 term 단일이라 맥락이 바뀌어도 판정이 유지된다(`일본`이 재난 맥락으로 캐싱되면 나중에 잡담 맥락에서도 그대로). 교정: `DELETE FROM keyword_verdicts WHERE term = '일본'`.

### 실패 처리

매시간 크론이라 LLM 장애로 그 시각 수집분이 통째로 날아가면 안 된다.

| 상황                     | 동작                              |
| ------------------------ | --------------------------------- |
| `ANTHROPIC_API_KEY` 없음 | 필터 건너뛰고 원본 top10 저장     |
| API 오류·타임아웃        | 캐시된 판정만 적용, 나머지는 통과 |
| `--no-llm` 플래그        | 호출 자체를 안 함(비교용)         |

`collection_runs.filtered`(popular run)에 필터 적용 여부가 기록된다.

---

## 5. 저장 — `store.mjs`

`verdict.mjs`가 최종 top10(`ranked[]`)을 넘기면, `store.mjs`가 아래 순서로 커밋한다. **스키마는 `db/schema.ts` 소유** — 이 파일은 `CREATE TABLE`을 하지 않고, 스키마가 없으면 `assertSchema()`가 즉시 멈춘다.

```
startRun({ pipeline: 'popular', ... })  → collection_runs 1행
upsertKeyword(term)  각 term마다  → keywords UPSERT (이미 있으면 그대로 둠)
saveTrendSnapshots() → trend_snapshots에 top10 INSERT
finishRun()  → collection_runs UPDATE (keyword_count 등)
```

### `sources` — 소스 마스터 (5행 고정)

| 컬럼                            | 내용                                                                                                                       |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `id`/`name`/`kind`/`created_at` | `dcbest`/`theqoo`/`instiz`/`youtube`/`gtrends`. `kind`엔 DB UNIQUE가 없어(unified 스키마 설계 허점) 시드는 `name`으로 우회 |

### `raw_signals` — 수집 원문

| 컬럼                                                           | 내용                                                       |
| -------------------------------------------------------------- | ---------------------------------------------------------- |
| `run_id`                                                       | → `collection_runs.id` (`pipeline='collect'`) |
| `source_id`/`source`                                           | 어느 사이트 / 신호 종류(title·comment)                     |
| `text`/`text_hash`/`video_id`/`meta`/`bucket_at`/`captured_at` | 1장 참고                                                   |

`UNIQUE(source_id, text_hash, bucket_at)`.

### `collection_runs` — 파이프라인 실행 로그 (공유 테이블)

| 컬럼                                            | 내용                                                              |
| ----------------------------------------------- | ----------------------------------------------------------------- |
| `pipeline`                                      | `collect` / `popular`                   |
| `geo`                                           | 항상 `KR`                                                         |
| `status`                                        | `success`/`partial`/`error`                                       |
| `raw_signal_count`                              | collect: 저장한 원문 수 / popular: 창에서 읽은 원문 수            |
| `keyword_count`                                 | popular run에서만 — top-N 개수                                    |
| `api_call_log`                                  | collect run에서만 — 소스별 `{source, items, error}`               |
| `bucket_at`/`window_hours`/`buckets`/`filtered` | 기준 시각 / 창 길이 / 창에 실제 있던 버킷 수 / LLM 필터 적용 여부 |

### `keywords` — 키워드 엔티티

| 컬럼            | 내용                                                                   |
| --------------- | ---------------------------------------------------------------------- |
| `term`/`slug`   | 정식 이름(canonical 반영) / 한글 슬러그                                |
| `source_id`     | 최초 발견 시 가중치 최상위 소스                                        |
| `first_seen_at` | 최초 발견 시각(이후 안 바뀜 — 이미 있으면 `upsertKeyword`가 그대로 둠) |
| `category_id`   | **항상 NULL** — 맨 아래 TODO 참고                                      |

### `trend_snapshots` — 실행별 top10

| 컬럼                                    | 내용                                                                                                                                     |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `keyword_id`/`run_id`                   | → `keywords.id` / → `collection_runs.id`(popular run)                                                                                    |
| `rank`/`score`/`mentions`/`captured_at` | 랭킹 결과 그대로                                                                                                                         |
| `growth_rate`                           | **계산값**(LLM 아님). 직전 popular run 대비 `score` 변화율 — `"+23%"`/`"NEW"`(직전 점수 0)/`"N회 언급"`(직전 run에 없던 신규 진입)       |
| `velocity`                              | **계산값**. 3장에서 계산한 참여도 보정 평균을 `"X.X/10"`으로 포맷                                                                        |
| `reasons`                               | `[{source, weight, text?, sample?}]`. 최상위 가중치 소스에만 `text`/`sample`(원문 예문, 같은 값) 부착. `text`는 API가 요구하는 필수 필드 |
| `source_label`                          | **계산값**. `reasons[].source`를 `", "`로 join                                                                                           |
| `summary`/`external_ref`/`source_url`   | **항상 NULL** — TODO 참고                                                                                                                |

실제 예 (2026-08-12 21:00 popular run):

```
term='NCT' rank=1 score=58 growth_rate='+0%' velocity='3.5/10' source_label='youtube'
reasons=[{"source":"youtube","weight":43,"text":"NCT 127 엔시티 127 'Piñata' Track Video","sample":"..."},
         {"source":"theqoo","weight":4}]
```

### `keyword_verdicts` — LLM 판정 캐시

| 컬럼                                                                 | 내용                                                                   |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `term`(PK)/`keep`/`canonical`/`reason`/`sample`/`model`/`decided_at` | 4장 참고                                                               |
| `content_type`                                                       | 인물/작품·콘텐츠/…/일반어/문법조각. `categories`(UI 탭 축)와는 다른 축 |

---

## 6. 실행 방법

```bash
# 정기 실행은 GitHub Actions가 한다 (8장) — 아래는 전부 수동용

npm run collect     # 5소스 수집 → raw_signals
npm run rank        # 최근 6시간 랭킹 계산 → trend_snapshots (--save 포함)

# 수동 확인 (DB에 안 씀)
node pipeline/rank-popular.mjs
node pipeline/rank-popular.mjs --no-llm   # LLM 없이 순수 점수 순위만

# 파라미터 실험 (TOP_N 기본 10, POOL 기본 50, HOURS 기본 6)
HOURS=24 TOP_N=30 POOL=100 node pipeline/rank-popular.mjs

# 판정 캐시 워밍 — 전 기간 term 일괄 판정
node pipeline/warm-verdicts.mjs --dry
node pipeline/warm-verdicts.mjs

# 전 기간 재생성 — keyword_verdicts 캐시만 읽고 LLM은 호출 안 함
node pipeline/backfill-popular.mjs --reset
```

`backfill-popular.mjs --reset`은 `popular` run과 그 `trend_snapshots`만 지우고 다시 채운다(`collect` run·`raw_signals`는 안 건드림). 가중치나 카테고리 계수를 고치고 이걸 돌리면 전체 시계열이 새 기준으로 재생성된다 — **API 호출 0회.**

> `npm run collect` / `npm run rank`은 `--env-file=.env.local`이 붙어 있다. 러너에는 `.env.local`이 없으므로(gitignore) 워크플로는 `node pipeline/*.mjs`를 직접 부르고 Secrets를 `env:`로 주입한다.

### 스케줄 — launchd(구) → GitHub Actions(현재)

**예전:** `~/Library/LaunchAgents/com.trendrising.hourly.plist`가 매시 정각에 `run-hourly.sh`를 실행했다. 맥이 꺼지거나 잠들면 그 시간이 통째로 비었고 소급도 안 됐다. **현재 이 작업은 `disabled` 상태이고 마지막 실행 로그는 2026-08-04다.**

`run-hourly.sh`는 절대 경로(`/Users/yang/...`)·nvm 경로·로컬 pg 기동 로직이 박혀 있어 러너에서 못 쓴다. **Actions에서는 아예 호출하지 않는다** — 실제로 필요한 건 `node pipeline/collect.mjs` 한 줄뿐이었다.

---

## 7. 파일 목록

| 파일                   | 역할                                | API 호출 |
| ---------------------- | ----------------------------------- | -------- |
| `collect.mjs`          | 5소스 병렬 수집 → `raw_signals`     | YouTube  |
| `sources/*.mjs`        | 소스별 스크래퍼                     |          |
| `tokenize.mjs`         | 문장 → 단어                         | ❌       |
| `popular.mjs`          | 랭킹 로직(가중치·보정·velocity)     | ❌       |
| `verdict.mjs`          | LLM 판정                            | ✅       |
| `rank-popular.mjs`     | 최신 창 계산·판정·저장              | 간접     |
| `warm-verdicts.mjs`    | 전 기간 term 일괄 판정              | ✅       |
| `backfill-popular.mjs` | 전 기간 재생성(캐시만 읽음)         | ❌       |
| `store.mjs`            | Postgres 저장 계층(DDL 없음)        | ❌       |
| `seed.mjs`             | 초기 1회 데이터 적재                | ❌       |

---

## 8. 인프라 — Neon · 마이그레이션 · Actions

### 8-1. DB는 Neon이다

```
프로젝트    Neon / aws-us-east-1 (N. Virginia)
엔드포인트  ep-red-pine-av0rffus
서버        PostgreSQL 18.4
DB / 계정   neondb / neondb_owner
```

**왜 Neon인가.** 이 파이프라인은 매시간 몇 분 일하고 나머지는 논다(90%+ 유휴). Neon은 유휴가 5분 이어지면 컴퓨트를 정지시키고(scale-to-zero) 그동안 과금하지 않는다 — 워크로드 모양이 맞는다. 콜드 스타트는 실측 2.5초인데 배치 작업엔 무의미하다. 다만 **나중에 API/UI를 붙이면 첫 방문자가 그만큼 기다린다.**

**왜 버지니아인가.** Neon에 도쿄·서울 리전이 없다(아시아는 싱가포르·시드니뿐). 최종 실행 위치가 GitHub Actions 러너(대부분 US)라 거기 붙는 게 맞다. `store.mjs`가 행 단위 INSERT를 루프로 돌려서 왕복 지연이 행 수만큼 곱해지는데, 러너 기준으로 버지니아가 압도적으로 가깝다.

**연결 문자열이 두 개다.** 호스트에 `-pooler`가 붙었는지로 구분한다.

| | 경로 | 쓰는 곳 |
| --- | --- | --- |
| **direct** (`-pooler` 없음) | Postgres에 바로 | **파이프라인**, `db:migrate` |
| **pooled** (`-pooler` 있음) | PgBouncer 경유 | `app/api/**` (재작성 예정) |

pooled는 접속을 돌려막아 동시 접속 상한이 높지만 **트랜잭션이 끝나면 세션 상태가 날아간다.** `store.mjs`의 `prepare: false`가 정확히 이걸 위한 설정이다. 파이프라인은 매시간 프로세스 하나뿐이라 direct로 충분하고, DDL은 세션이 유지되는 direct가 안전하다.

로컬 `.env.local`에는 `DATABASE_URL`(direct)과 `DATABASE_URL_POOLED`가 있다. **후자는 현재 어떤 코드도 읽지 않는다** — API 재작성 때 쓰려고 적어둔 메모다.

> ⚠️ **무료 플랜 스토리지가 0.5GB다.** `raw_signals`는 계속 쌓인다 — 버킷당 195행 · 행당 ~305 bytes → **연 170만 행 / 약 1GB**. 즉 **6개월쯤 뒤에 한도에 닿는다.** 넘으면 데이터가 지워지는 게 아니라 **INSERT/UPDATE/DELETE가 실패한다** — Actions는 초록불인데 데이터만 안 늘어나는, 알아채기 어려운 형태로 멈춘다. 원문은 재계산의 근거라 함부로 못 지운다(그게 이 설계의 핵심). 정리 정책이 필요하다. 컴퓨트(100 CU-hour/월)는 월 ~30으로 여유롭다.

### 8-2. 스키마 마이그레이션

**`db/schema.ts`가 유일한 소유자다.** 파이프라인은 drizzle을 런타임에 쓰지 않는다 — `pipeline/**`에 import가 0건이고 `store.mjs`는 `postgres` 패키지로 생 SQL을 쓴다. drizzle의 역할은 **테이블을 만드는 것**뿐이다.

```
db/schema.ts       ─ drizzle-kit ─▶  테이블 생성/변경   (스키마 바뀔 때마다)
pipeline/store.mjs ─ 생 SQL ──────▶  데이터 적재        (매시간)
app/api/** (예정)  ─ drizzle-orm ─▶  데이터 조회        (타입 안전 쿼리)
```

**바꾸는 절차:**

```bash
# 1) db/schema.ts 수정
npm run db:generate   # 2) → drizzle/0001_xxx.sql 생성. DB 연결 불필요
                      # 3) 생성된 .sql을 눈으로 확인 ★ 건너뛰지 말 것
npm run db:migrate    # 4) → 안 돌린 것만 DB에 적용 + __drizzle_migrations에 기록
                      # 5) 커밋 (db/schema.ts + drizzle/ 통째로)
```

**`drizzle/` 안의 세 가지가 각각 다르다:**

| 파일 | DB에 감? | 역할 |
| --- | --- | --- |
| `0000_*.sql` | **감** | 실행할 명령 — "무엇을 할지" |
| `meta/0000_snapshot.json` | 안 감 | 비교 기준 — "하고 나면 어떤 모습인지" |
| `meta/_journal.json` | 안 감 | 순서 목차 |

`generate`는 **실제 DB가 아니라 스냅샷 파일과** `schema.ts`를 대조해 diff를 뜬다. 그래서 DB 연결 없이 돌아가고, 그래서 **`drizzle/`은 `meta/`까지 통째로 커밋해야 한다** — 스냅샷이 없으면 이미 있는 테이블을 처음부터 다시 만드는 SQL을 뽑아낸다.

적용 여부는 파일이 아니라 DB의 **`public.__drizzle_migrations`** 에만 있다. 파일 이름이 아니라 `.sql` **내용의 SHA256**을 저장한다(기본은 별도 `drizzle` 스키마인데, Neon 콘솔 Tables가 스키마를 하나씩만 보여줘서 `public`으로 옮겼다 — `drizzle.config.mjs`의 `migrations` 항목).

**세 가지 주의:**

- **`npm run db:push`는 쓰지 않는다.** 파일도 이력도 남기지 않고 DB를 즉시 바꾼다. 실 DB가 생긴 이상 되돌릴 근거가 없다.
- **이미 적용된 `.sql`은 수정하지 않는다.** 해시가 어긋난다. 고칠 게 있으면 새 마이그레이션을 만든다.
- **Neon 콘솔 SQL Editor로 `ALTER TABLE`을 치지 않는다.** 스냅샷과 현실이 어긋나 다음 `generate`가 엉뚱한 SQL을 뽑는다. 조회(`SELECT`)는 괜찮다.

> **데이터 값을 옮기는 건 drizzle이 추론하지 못한다.** 구조 변경(컬럼 추가·삭제·인덱스)만 자동이다. 컬럼 이름을 바꾸면 종종 "옛 컬럼 DROP + 새 컬럼 ADD"로 뽑는데 그러면 데이터가 날아간다 — 생성된 `.sql`을 `ALTER TABLE ... RENAME COLUMN`으로 직접 고쳐 쓰면 된다. 그냥 SQL 파일이라 손대도 된다.

### 8-3. GitHub Actions

```
.github/workflows/collect.yml   cron "5 * * * *"      매시간
.github/workflows/rank.yml      cron "20 */2 * * *"   2시간마다
```

파일 안에 결정 근거를 주석으로 달아뒀다. 주기를 나눈 이유는 0장에 있다.

**Secrets 3개** (레포 Settings → Secrets and variables → Actions → New repository secret):

| Name | 값 |
| --- | --- |
| `DATABASE_URL` | Neon **direct** 문자열 |
| `YOUTUBE_API_KEY` | |
| `ANTHROPIC_API_KEY` | `rank.yml`에만 주입됨 |

`REGION_CODE=KR`은 민감값이 아니라 워크플로에 직접 적었다. **`collect.yml`에는 `ANTHROPIC_API_KEY`를 일부러 주지 않는다** — 수집 경로에 LLM 호출이 섞여 들어오면 조용히 돌지 않고 바로 실패해서 드러난다.

**함정 넷:**

① **시간대는 안전하다.** `collect.mjs`의 `hourBucket()`이 `setMinutes(0,0,0)` 후 `toISOString()`인데, KST는 UTC+9 정시 오프셋이고 서머타임이 없어서 정시 내림 결과가 UTC에서든 KST에서든 같은 순간이다. 러너가 UTC라도 버킷은 안 틀어진다.

② **cron은 밀린다.** 러너 혼잡 시 수십 분 지연이 흔하다. 1시간 버킷 기준이라 정각(`0 * * * *`)에 걸면 밀렸을 때 버킷이 비거나 겹친다. **`5 * * * *`** 로 두면 밀려도 같은 버킷에 떨어질 확률이 높다.

③ **60일 무활동이면 GitHub이 스케줄을 자동으로 끈다.** 커밋이 뜸해지면 조용히 멈춘다.

④ **스크래핑 차단 위험.** dcbest·theqoo·instiz는 HTML 스크래핑이라 러너 IP 대역이 막힐 수 있다. **이관 직후 소스별 수집 건수를 반드시 대조할 것** — 기준값(로컬 실측, 2026-08-16 13:00 UTC 버킷):

```
dcbest 49 · theqoo 20 · instiz 10 · youtube 110 · gtrends 10 = 199건
```

총합은 시간대에 따라 흔들리지만 **특정 소스만 0건**인 건 다르다. 막히면 그 소스만 별도 경로(자체 서버/프록시)가 필요하다.

> **`schedule:`은 기본 브랜치(master)에서만 돈다.** `workflow_dispatch` 버튼도 파일이 기본 브랜치에 있어야 UI에 나타난다. 머지 전에는 Actions 탭에 아무것도 보이지 않는 게 정상이다.
>
> 머지에는 팀 조율이 걸려 있다 — **머지하면 master에서 `next build`가 깨진다.** `app/api/**`의 import 9곳이 구 스키마를 가리킨 채 끊겨 있어서다(의도한 상태이고 API 재작성 때 해소된다). 파이프라인 워크플로 자체는 `node`만 돌리므로 build와 무관하게 정상 동작한다. `lib/pipeline-v-he/**` 삭제도 songhaeunsong 브랜치가 살아 있어 공지가 필요하다.

> **`npm ci`가 아니라 `npm ci --omit=dev`를 쓴다.** 파이프라인은 devDependencies(drizzle-kit·typescript·eslint)를 쓰지 않는다. `pipeline/**`의 외부 import는 `postgres`와 `@anthropic-ai/sdk` 둘뿐이고 모두 지연 import이며 dependencies에 있다.

**YouTube 할당량은 여유롭다.** `youtube.mjs`가 비싼 `search.list`(100 units)를 쓰지 않고 `videos?chart=mostPopular`(1) + 영상당 `commentThreads`(1)만 쓴다 → 실행당 약 21 units, 매시간 돌려도 하루 ~500 units로 무료 한도 10,000의 5%다.

---

## TODO

**카테고리(`keywords.category_id`)** — 계속 NULL. `keyword_verdicts.content_type`(인물/사건·사고/스포츠 등, 이미 판정·캐싱됨)을 그대로 `categories`/`category_id`로 옮기면 추가 LLM 비용 없이 채울 수 있음. 단 지금 `categories`(푸드/뷰티/테크)는 이 파이프라인 콘텐츠와 축이 안 맞아서(예전에 억지로 매핑했다가 87%가 "기타") **`categories` 마스터 목록 자체를 이 파이프라인 도메인에 맞게 바꿀지부터 팀(송하은/UI 담당)과 확인 필요**. master/v-he가 폐기되면 다른 파이프라인이 필요로 하는 카테고리가 없어지므로 바꾸기 더 쉬워짐.

**`trend_contents`(상세페이지 "근거 콘텐츠" 카드)** — 지금 아예 안 씀. 필요한 필드: `url`/`thumbnail_url`/`metric_label`/`excerpt`.

- 유튜브: `video_id`·`viewCount`·`likeCount`가 이미 있어서 거의 매핑만 하면 됨(URL/썸네일은 표준 패턴으로 조합 가능)
- dcbest/theqoo/instiz: 스크래퍼가 제목만 긁고 게시글 URL을 안 잡음 — 스크래퍼 자체를 확장해야 하는 **진짜 별도 수집** 작업

**`keyword_relations`(연관 키워드 칩)** — 수집이 아니라 계산 문제. 같은 버킷·같은 원문에 같이 등장하는 키워드로 co-occurrence 점수를 내면 됨(외부 데이터 불필요).

**`trend_snapshots.summary`(AI 요약)** — LLM 필요. `keyword_verdicts`처럼 term 단위로 캐싱하면 "매 run마다 최신이어야 하는 값"과 충돌(예전 맥락이 계속 재사용되는 문제)이라 별도 설계 필요 — 최종 top10만 대상으로 하는 추가 LLM 호출 후보(설계는 논의했으나 미착수).

**`trend_snapshots.external_ref`/`source_url`** — 원문 URL을 안 모으고 있어 채울 데이터가 없음. `trend_contents` 작업과 연결됨.
