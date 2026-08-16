# 데이터 수집 파이프라인 (pipeline/)

커뮤니티·유튜브·구글트렌드에서 매시간 원문을 긁어와, **"지금 많이 언급되는 키워드" top10**을 만들어 Postgres에 쌓는다. 원래는 "평소 대비 갑자기 늘어난 단어"를 뽑는 급상승(rising) 방식이었으나 **인기(popular) 방식으로 전환**했다. 예전 폴더 이름 `trend-rising/`이 그때의 잔재였고, 이번에 `pipeline/`으로 정리했다 — `rank-popular.mjs`·`backfill-popular.mjs`처럼 파일 이름은 이미 현재 방식(popular)을 따르고 있었다.

**스키마는 `db/schema.ts`가 소유한다.** 이 파이프라인은 테이블을 스스로 만들지 않고(`store.mjs`가 DDL을 안 함), 이미 존재하는 스키마에 데이터만 넣는다. 처음 셋업할 때 한 번:

```bash
npm run db:push   # = drizzle-kit push --config=drizzle.config.mjs
```

---

## 0. 전체 흐름

```
매시 정각 (launchd → run-hourly.sh)
    │
    ├─▶ collect.mjs ─────────────────────────────────────────
    │     collection_runs 1행 생성 (pipeline='collect')
    │     5개 소스 병렬 스크래핑
    │     raw_signals에 N행 INSERT (run_id = 방금 만든 run)
    │     collection_runs 그 행 UPDATE (status/raw_signal_count)
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

창이 6시간인데 1시간씩만 밀려서, 연속한 두 실행의 후보 50개가 85%쯤 겹친다. **LLM엔 매시간 1회, 50개가 전부지만 캐시 히트로 실제 신규 판정은 5~10개뿐** — 시간당 60초 걸리던 게 0.13초로.

|              | 캐시 없음 | 캐시 있음  |
| ------------ | --------- | ---------- |
| 월 판정 횟수 | 36,500회  | 약 5,000회 |
| 이후 호출    | 60초      | **0.13초** |

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
# 최초 1회 — 스키마 반영
npm run db:push

# 매시간 자동 (launchd → run-hourly.sh)
#   collect.mjs → rank-popular.mjs --save

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

### 스케줄

`~/Library/LaunchAgents/com.trendrising.hourly.plist`가 매시 정각에 `run-hourly.sh`(collect → rank-popular --save)를 실행한다. 맥이 꺼지거나 잠들면 그 시간은 비고, launchd는 놓친 시간을 소급 채우지 않는다.

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

## TODO

**카테고리(`keywords.category_id`)** — 계속 NULL. `keyword_verdicts.content_type`(인물/사건·사고/스포츠 등, 이미 판정·캐싱됨)을 그대로 `categories`/`category_id`로 옮기면 추가 LLM 비용 없이 채울 수 있음. 단 지금 `categories`(푸드/뷰티/테크)는 이 파이프라인 콘텐츠와 축이 안 맞아서(예전에 억지로 매핑했다가 87%가 "기타") **`categories` 마스터 목록 자체를 이 파이프라인 도메인에 맞게 바꿀지부터 팀(송하은/UI 담당)과 확인 필요**. master/v-he가 폐기되면 다른 파이프라인이 필요로 하는 카테고리가 없어지므로 바꾸기 더 쉬워짐.

**`trend_contents`(상세페이지 "근거 콘텐츠" 카드)** — 지금 아예 안 씀. 필요한 필드: `url`/`thumbnail_url`/`metric_label`/`excerpt`.

- 유튜브: `video_id`·`viewCount`·`likeCount`가 이미 있어서 거의 매핑만 하면 됨(URL/썸네일은 표준 패턴으로 조합 가능)
- dcbest/theqoo/instiz: 스크래퍼가 제목만 긁고 게시글 URL을 안 잡음 — 스크래퍼 자체를 확장해야 하는 **진짜 별도 수집** 작업

**`keyword_relations`(연관 키워드 칩)** — 수집이 아니라 계산 문제. 같은 버킷·같은 원문에 같이 등장하는 키워드로 co-occurrence 점수를 내면 됨(외부 데이터 불필요).

**`trend_snapshots.summary`(AI 요약)** — LLM 필요. `keyword_verdicts`처럼 term 단위로 캐싱하면 "매 run마다 최신이어야 하는 값"과 충돌(예전 맥락이 계속 재사용되는 문제)이라 별도 설계 필요 — 최종 top10만 대상으로 하는 추가 LLM 호출 후보(설계는 논의했으나 미착수).

**`trend_snapshots.external_ref`/`source_url`** — 원문 URL을 안 모으고 있어 채울 데이터가 없음. `trend_contents` 작업과 연결됨.
