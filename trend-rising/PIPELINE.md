# trend-rising 파이프라인

커뮤니티·유튜브·구글트렌드에서 매시간 원문을 긁어와, **"지금 많이 언급되는 키워드" top10**을 만들어 DB에 쌓는다.

원래는 "평소 대비 갑자기 늘어난 단어"를 뽑는 급상승(rising) 방식이었으나, **인기(popular) 방식으로 전환**했다. 폴더 이름(`trend-rising/`)은 그때의 잔재다 — 테이블 이름은 2026-08-11에 통합 스키마 이름(`raw_signals` 등)으로 옮겨서 더는 `rising_*`가 아니다.

---

## 1. 전체 흐름

```
매시 정각 (launchd → run-hourly.sh)
    │
    ├─▶ collect.mjs        5개 소스 병렬 스크래핑 → raw_signals 에 축적
    │
    └─▶ rank-popular.mjs
           ├─ 최근 6시간 원문을 읽어 토큰화
           ├─ 소스별 가중치로 점수 합산 → 후보 50개
           ├─ LLM 판정으로 노이즈 제거·복원·병합 → top10
           └─ collection_runs / popular_snapshots 저장
```

**수집과 랭킹이 분리된 게 핵심이다.** 원문이 DB에 남아 있으므로 가중치를 바꿔도 API를 다시 호출하지 않고 과거 전 구간을 재계산할 수 있다. LLM 판정도 같은 이유로 캐시에 저장한다 — 비싼 건 한 번, 싼 건 언제든.

---

## 2. 수집 — `collect.mjs`

5개 소스를 `Promise.all`로 동시에 긁는다. 한 소스가 실패해도 나머지는 그대로 저장된다.

| 소스 | 대상 | 방식 | 저장 단위(unit) |
|---|---|---|---|
| `dcbest` | 디시인사이드 실시간 베스트 | HTML 스크래핑 | title |
| `theqoo` | 더쿠 핫게시판 | HTML 스크래핑 | title |
| `instiz` | 인스티즈 실시간 인기 | HTML 스크래핑 | title |
| `youtube` | 인기 급상승 영상 20개 + 상위 8개 영상의 댓글 15개씩 | 공식 Data API | title + comment |
| `gtrends` | 구글 트렌드 한국 급등검색어 20개 | 공식 RSS | title |

> **네이트판은 2026-08-03에 제외했다.** 사연·신변잡기 위주라 트렌드 키워드가 거의 안 나왔다 — `남편`·`시어머니`·`강아지`처럼 LLM 판정에서 대부분 탈락하는 일반명사만 올라왔다. 수집기(`sources/natepann.mjs`)와 기존 수집분 299행을 함께 지웠다.

수집한 행은 **1시간 버킷**(정시로 내림)으로 묶여 `raw_signals`에 들어간다.

```
UNIQUE (source, text_hash, bucket_at)
```

같은 시간대에 같은 소스에서 같은 글이 또 들어오면 무시된다. 반대로 **디시 실베에 3시간 머문 글은 3개 버킷에 3번 저장**된다 — 체류시간이 자연스럽게 점수에 반영되는 구조다.

`meta`(jsonb)에 소스별 부가정보가 들어간다:

- `youtube|title` → `videoId`, `publishedAt`, `viewCount`, `likeCount`, `commentCount`
- `youtube|comment` → `videoId`, `likeCount`
- `gtrends|title` → `rank`, `approxTraffic`("1000+" 형태), `newsTitles`
- `dcbest|title` → `gallery`(출처 갤러리명)

> `viewCount`/`likeCount`는 **2026-08-03 22시 버킷부터** 수집을 시작했다. 그 이전 데이터에는 없다.

---

## 3. 토큰화 — `tokenize.mjs`

제목/댓글 한 줄을 단어 배열로 쪼갠다. 순서대로:

1. URL 제거 → 이모지 제거 → 자모 반복(`ㅋㅋㅋ`, `ㅠㅠ`) 제거 → 특수문자 제거
2. 공백 분리
3. **조사·어미 접미사 제거** — `에서는`, `습니다`, `까지`, `은/는/이/가` 등
   - 단, 1글자 조사는 남는 어간이 3글자 이상일 때만 뗀다. (`김고은` → `김고` 로 훼손되는 걸 막기 위함)
4. 필터: 길이 2~20 / 숫자만 아님 / 자모만 아님 / `XX갤` 형태 아님 / **불용어 아님**

불용어는 소문자로 비교한다. (원문에 `The`, `Official`처럼 대문자로 나오는데 목록은 소문자라 여태 하나도 안 걸리던 버그를 고쳤다.)

> 토큰화는 완벽하지 않다. `오디세이` → `오디세`, `변요한` → `요한`처럼 고유명사를 훼손하는 경우가 남아 있다. 이건 규칙으로 못 막고 **6장의 LLM 판정이 원문을 보고 복원**한다. 불용어 목록은 1차 방어선으로만 유지한다.

---

## 4. 랭킹 — `popular.mjs`

### 4-1. 창(window)

기본 **최근 6시간**(약 900~1,500행). 1시간이면 표본이 250행 안팎이라 순위가 뭉갠다.

**버킷 개수가 아니라 시계 기준이다.** 수집이 빠진 시간대가 있어도 과거로 더 뻗지 않고 표본만 줄어든다 — "6시간 창"이 실제로 6시간을 뜻한다. `collection_runs`에 `window_hours`(창 길이)와 `buckets`(그 창에 실제로 있던 버킷 수)를 둘 다 남기므로, 둘을 비교하면 그 시점에 수집이 몇 회 빠졌는지 바로 보인다.

기준점은 `now()`가 아니라 `max(bucket_at)`이다. 이번 시각 수집이 실패해도 직전 데이터로 랭킹은 나오되, 출력에 기준 시각이 찍혀 오래된 데이터를 알아챌 수 있다.

> **창 안에 시간 감쇠는 없다.** 6시간 전 언급과 10분 전 언급의 점수가 같다. 따라서 엄밀히는 "지금 인기"가 아니라 **"최근 6시간 누적 인기"**다.

### 4-2. 점수 공식

```
score = Σ (소스별 가중치 × 참여도 보정)  ×  교차 소스 보너스
```

한 행(제목 1개 또는 댓글 1개)을 토큰화해 나온 단어들에게 **아이템당 1회씩** 가중치를 더한다.

**소스별 기본 가중치** — 유튜브가 메인, 커뮤니티가 서브:

| source \| unit | 가중치 |
|---|---:|
| `gtrends \| title` | 20 |
| `youtube \| title` | 12 |
| `dcbest \| title` | 4 |
| `theqoo \| title` | 4 |
| `instiz \| title` | 4 |
| `youtube \| comment` | 3 |

**참여도 보정** — meta가 있을 때만 곱해지고, 없으면 ×1이다. 과거 데이터와 신규 데이터가 같은 코드로 돌아간다.

| 대상 | 공식 | 범위 |
|---|---|---|
| `gtrends` | 검색량 기준. 500+를 ×1.0으로 놓고 로그 스케일 | ×0.7 ~ ×1.8 |
| `youtube \| title` | 시간당 조회수 + 좋아요 | ×1 ~ ×3.5 |
| `youtube \| comment` | 댓글 좋아요(×1~2) × 그 영상의 확산속도 | ×1 ~ ×7 |
| 커뮤니티 3곳 | 조회수·추천수를 수집하지 않음 | 항상 ×1 |

**교차 소스 보너스** — 2개 이상 소스에 등장하면 ×1.25.

**최소 언급 필터** — 창 안에서 2회 이상 언급됐거나, gtrends에 있으면 통과.

### 4-3. 중복 제거

- 한 행 안에서 같은 단어가 여러 번 나와도 **1회만** 카운트 (`new Set(tokenize(text))`)
- 유튜브는 **영상 단위**로도 막는다 — 인기 영상 하나의 댓글 15개가 같은 단어를 반복해 점수를 부풀리는 걸 방지

---

## 5. 후보 풀 — 왜 50개인가

최종 결과는 top10이지만, 랭킹 계산은 **후보 50개까지 뽑는다**(`POOL`).

다음 장의 LLM 판정에서 절반 안팎이 탈락·병합되기 때문이다. 10개만 뽑으면 최종이 5~6개밖에 안 남는다.

실측: 후보 50개 → 26개 제거 + 2개 병합 → **22개 생존**. top10을 채우고도 두 배 여유가 있다.

> 이전에 top30 × 2.5배(75개)로 돌렸을 때는 43개 제거 + 3개 병합 → 29개만 남아 top30을 못 채웠다. **탈락률이 40~50%라 배수를 넉넉히 잡아야 한다.**

---

## 6. LLM 판정 — `verdict.mjs`

### 6-1. 왜 필요한가

토크나이저는 "단어"를 뽑기 때문에 구조적으로 노이즈가 섞인다. LLM 도입 전 top30을 직접 판정해보니 **13개(43%)가 버려야 할 것**이었다.

| 유형 | 예시 |
|---|---|
| 문법 조각 | `같아서` `혼자` `하면` `나오면` `대한` |
| 장르·일반명사 | `배우` `드라마` `영화` `출연진` `신인` |
| 영어 파편 | `like`(원문: "like i do") `vocals` |
| 맥락 없는 지역명 | `일본`(원문: "일본 여학생들의 체육복") |

불용어 목록으로 막아봤지만 30개 넘게 추가해도 계속 새로 나왔다. **두더지잡기다.**

그리고 불용어로는 아예 못 고치는 문제가 있다:

| 현재 | 실제 | 원인 |
|---|---|---|
| `오디세` | 오디세이 | 조사 `이`를 뗌 |
| `요한` | 변요한 | `변`이 1글자라 길이 필터에 걸림 |
| `김윤희` + `아나운서` | 김윤희 아나운서 | 공백으로 분리 |
| `최애의` | 최애의 사원 | 작품명이 잘림 |

한 대상이 여러 조각으로 쪼개져 **순위를 두 칸씩 낭비**하고 있었다.

### 6-2. 주고받는 것

**보내는 것** (미판정 term만):

```
- 아나운서 | 점수 40 | 소스 gtrends | 예문: 김윤희 아나운서
- 오디세   | 점수 25 | 소스 dcbest  | 예문: [이갤] 놀런·맷 데이먼 내한…오디세이 흥행 질주
- 같아서   | 점수 34 | 소스 dcbest,youtube | 예문: "대통령님, X는 보실 것 같아서"…
```

예문은 이미 랭킹 결과에 들어 있어(`sample`) **추가 수집 비용이 0이다.** 이 한 줄이 복원·병합·맥락 판단을 가능하게 한다.

**받는 것** (`output_config.format`의 json_schema로 형식 강제):

| 필드 | 내용 |
|---|---|
| `term` | 입력한 단어 |
| `keep` | true/false |
| `canonical` | 병합·복원된 이름. 그대로면 null |
| `category` | 인물 / 작품·콘텐츠 / 기업·주식 / 사건·사고 / 재난·속보 / 정치·사회 / 스포츠 / 일반어 / 문법조각 |
| `reason` | 판정 이유 한 줄 |

### 6-3. 적용 순서

```
1. loadVerdicts()   캐시 조회
2. judgeTerms()     미판정 term만 LLM 1회 호출
3. saveVerdicts()   캐시 저장
4. keep=false 제거
5. canonical 병합   같은 이름이면 점수 높은 쪽 하나만 남김
6. 카테고리 계수    (현재 전부 1.0)
7. 재정렬 → top10
```

**병합 시 점수를 합산하지 않는다.** `김윤희`(40)와 `아나운서`(40)는 같은 원문에서 나온 조각이라, 합치면(80) 이중계산이 된다. 높은 쪽 하나만 남기고 이름만 바꾼다.

### 6-4. 카테고리 계수는 코드에 있다

```
LLM:  "김병지"는 스포츠다        ← 여기까지
코드: 스포츠 = ×1.0             ← 숫자는 verdict.mjs
```

LLM이 점수를 직접 매기면 같은 `하이브`가 이번엔 85, 다음엔 78이 되어 **순위가 이유 없이 출렁인다.** 카테고리는 한번 판정하면 캐시에 박히므로 매시간 같은 값이고, 계수는 코드에 있으니 재현 가능하다. 마음에 안 들면 API 재호출 없이 숫자만 고쳐 재계산할 수 있다.

**현재 전부 1.0** = 필터·병합만 하고 점수엔 개입하지 않음. 필터 효과를 먼저 관찰한 뒤 계수를 켠다.

---

## 7. 판정 캐시 — 비용의 핵심

**캐시는 한 호출 안이 아니라 시간을 가로질러 작동한다.**

창이 6시간인데 1시간씩만 밀리므로, 연속한 두 실행은 5시간치 데이터를 공유한다. 그래서 후보 50개가 대부분 겹친다.

```
21시 후보: 하이브, 스파이더맨, 리센느, 쿠팡, 일본, 요금, ... (50개)
22시 후보: 하이브, 스파이더맨, 리센느, 쿠팡, 일본, 돌핀, ... (50개)
           └──────── 43개쯤 동일 ────────┘  └─ 신규 7개쯤
```

**LLM에 보내는 건 매시간 1회, 후보 50개가 전부다.** 창 안의 고유 토큰은 2,474개지만 최소 언급 필터로 808개가 남고, 그중 점수 상위 50개만 판정 대상이 된다.

과거 12일 데이터로 잰 적중률: **147 run × top30 = 4,410개 판정 대상 중 고유 키워드는 655개**(85.1%). `일본`은 92번 후보에 올랐지만 판정은 1번뿐이었다.

| | 캐시 없음 | 캐시 있음 |
|---|---|---|
| 시간당 판정 | 50개 | 약 5~10개 |
| 월 판정 횟수 | 36,500회 | 약 5,000회 |
| 첫 호출 소요 | 60초 | 60초 |
| 이후 호출 | 60초 | **0.13초** |

### 캐시의 한계 — 알고 쓸 것

캐시 키가 **term 단일**이라, 한번 판정되면 맥락이 바뀌어도 그대로 유지된다.

실제 사례: `일본`이 처음 판정될 때 예문이 "[싱갤] 훌쩍훌쩍 일본 지진 안타까운 죽음"이라 **[재난·속보] keep=true**로 캐시됐다. 맥락 판단이 제대로 작동한 사례지만, 나중에 "일본 여학생들의 체육복" 같은 잡담 맥락일 때도 계속 유지된다.

(term, 예문) 조합을 키로 쓰면 정확해지지만 캐시 적중률이 무너져 비용이 다시 올라간다. 트레이드오프를 받아들인 선택이다.

**교정 방법:** `keyword_verdicts`에서 해당 행을 지우거나 `keep`을 직접 고치면 다음 실행부터 반영된다. `sample` 컬럼에 판정 근거가 남아 있어 왜 그렇게 판정됐는지 확인할 수 있다.

---

## 8. 왜 원문을 통째로 주지 않았나

원문을 주는 쪽이 품질은 더 낫다. 훼손이 애초에 안 일어나니 복원할 것도 없다. 하지만 비용이 다르다.

| 설계 | 시간당 입출력 | Sonnet 5 | Haiku 4.5 |
|---|---|---|---|
| A. 원문 전체 (900행) | 12,500 / 4,000 | $71 | $24 |
| **B. 단어 + 예문 1줄** ← 채택 | 3,600 / 1,400 | $23 | $7.7 |
| C. 단어만 | 1,200 / 1,050 | $14 | $4.7 |

캐시를 붙이면 B는 **월 $5 안팎**으로 내려간다. C는 더 싸지만 복원·병합을 못 한다 — `요한`이라는 단어만 보고 `변요한`을 알아낼 방법이 없다.

---

## 9. 저장 — `store.mjs`

이 파이프라인이 쓰는 테이블은 6개다. 모두 `store.mjs`가 멱등하게 생성한다(`CREATE TABLE IF NOT EXISTS` + `ALTER TABLE ADD COLUMN IF NOT EXISTS`). 테이블·컬럼 이름은 통합 스키마 문서(`docs/trend-data-schema-and-api-spec.md`, `docs/trend-rising-rename-plan.md`)를 따른다 — 2026-08-11에 `rising_*`/`popular_*` 접두사에서 이 이름들로 옮겼다(`trend-rising/migrations/` 참고).

```
sources                 소스 마스터        5행 (dcbest/theqoo/instiz/youtube/gtrends 고정)
raw_signals              수집 원문          5,451행
collection_runs          랭킹 실행 이력     28행 — 랭킹 run이다. 수집과 랭킹이 분리돼 있어
                                            raw_signals는 이 테이블을 참조하지 않는다(11장 참고)
popular_snapshots        실행별 top10       280행
keyword_verdicts         LLM 판정 캐시     300여행
keywords                 키워드 엔티티      keep=true term의 승격본. slug·카테고리 보유
```

> `popular_snapshots` → `trend_snapshots` 통합은 미뤄뒀다. 그 이름을 jin의 `db/schema.ts`가 아직 쓰고 있어, 그 코드가 지워진 뒤에 `keyword_id` FK·`reasons` jsonb 구조로 다시 만든다.
>
> 2026-08-03에 원문을 최근 6시간만 남기고 42,202행을 지웠다. 옛 급상승 방식의 `rising_runs`·`rising_snapshots`도 함께 제거했다. 판정 캐시는 term 단위 자산이라 원문과 무관하게 유지한다.

### `sources` — 소스 마스터

| 컬럼 | 타입 | 내용 |
|---|---|---|
| `id` | int PK | |
| `name` | varchar(80) UNIQUE | 사람이 읽는 이름 (예: "디시인사이드 실시간 베스트") |
| `kind` | varchar(40) UNIQUE | 사이트 식별자 (dcbest/theqoo/instiz/youtube/gtrends) |
| `created_at` | timestamptz | |

### `raw_signals` — 수집 원문

| 컬럼 | 타입 | 내용 |
|---|---|---|
| `id` | bigserial PK | |
| `source_id` | int NOT NULL | → `sources.id` (어느 사이트) |
| `source` | text NOT NULL | 신호 종류: title / comment |
| `text` | text NOT NULL | 원문 한 줄 |
| `text_hash` | text NOT NULL | sha1(text) — 중복 판별용 |
| `video_id` | text | 유튜브 영상 ID(해당 시). `meta.videoId`에서 분리된 독립 컬럼 |
| `meta` | jsonb | 소스별 부가정보 (2장 참고) |
| `bucket_at` | timestamptz NOT NULL | 1시간 버킷 (정시로 내림) |
| `captured_at` | timestamptz NOT NULL | 실제 수집 시각 |

```
UNIQUE (source_id, text_hash, bucket_at)
```

같은 시간대·같은 소스의 같은 글은 한 번만 들어간다. 반대로 버킷이 다르면 또 들어가므로 **체류시간이 점수에 반영된다.**

### `collection_runs` — 랭킹 실행 이력

| 컬럼 | 타입 | 내용 |
|---|---|---|
| `id` | bigserial PK | |
| `started_at` | timestamptz NOT NULL | 실행 시각 (기본 now()) |
| `bucket_at` | timestamptz NOT NULL | 기준 시각 = 창의 최신 버킷 |
| `window_hours` | int | 창 길이(시간) |
| `buckets` | int NOT NULL | 그 창에 **실제로 있던** 버킷 수 |
| `raw_signal_count` | int NOT NULL | 창 안의 원문 행 수 |
| `filtered` | boolean NOT NULL | LLM 필터가 걸렸는지 |

`window_hours`와 `buckets`를 비교하면 그 시점에 수집이 몇 회 빠졌는지 바로 보인다 (6시간 창에 버킷 4개 = 2회 누락).

### `popular_snapshots` — 실행별 top10

| 컬럼 | 타입 | 내용 |
|---|---|---|
| `id` | bigserial PK | |
| `run_id` | bigint NOT NULL | → `collection_runs.id` |
| `bucket_at` | timestamptz | 기준 시각 — 조인 없이 시간으로 조회하려고 복제해 둔다 |
| `term` | text NOT NULL | 키워드 (병합·복원된 이름) |
| `rank` | int NOT NULL | 1~10 |
| `prev_rank` | int | 직전 run에서의 순위 |
| `score` | real | 최종 점수 |
| `mentions` | int | 창 안 언급 횟수 |
| `breadth` | int | 등장한 소스 개수 |
| `sources` | jsonb | `[{source, weightSum}]` — 어느 소스가 점수를 얼마나 냈는지 |
| `units` | jsonb | `["dcbest\|title", ...]` |
| `sample` | text | 원문 한 줄 |

인덱스: `(term)`, `(run_id)`, `(bucket_at DESC, rank)`

`sources`와 `sample`이 있어서 **"왜 이 키워드가 떴는지" 역추적이 된다.**

```sql
-- 최근 6시간 랭킹을 조인 없이
SELECT term, rank, score FROM popular_snapshots
 WHERE bucket_at > now() - interval '6 hours' ORDER BY bucket_at DESC, rank;
```

### `keyword_verdicts` — LLM 판정 캐시

| 컬럼 | 타입 | 내용 |
|---|---|---|
| `term` | text PK | 판정 대상 단어 |
| `keep` | boolean NOT NULL | 트렌드 키워드로 쓸지 |
| `canonical` | text | 병합·복원된 이름. 그대로면 null |
| `content_type` | text | 인물 / 작품·콘텐츠 / … / 일반어 / 문법조각 (콘텐츠 성격 축). `keywords.category`가 이 값을 그대로 가져다 UI 카테고리로도 쓴다 |
| `reason` | text | 판정 이유 한 줄 |
| `sample` | text | 판정 근거가 된 예문 |
| `model` | text | 판정한 모델 |
| `decided_at` | timestamptz NOT NULL | 판정 시각 |

원문을 지워도 이 테이블은 남는다. **term 단위 자산이라 데이터 정리와 수명이 다르다.**

```sql
-- 판정이 틀렸을 때: 해당 행만 지우면 다음 실행에서 다시 물어본다
DELETE FROM keyword_verdicts WHERE term = '일본';
```

> **UI 카테고리를 별도 축으로 뒀다가 되돌렸다(2026-08-11).** 프론트 mock(`lib/trend-data.ts`)의 푸드/뷰티/테크 같은 소비 라이프스타일 카테고리를 그대로 가져다 LLM에 판정시켰더니, trend-rising 콘텐츠(인물·정치·사건사고·스포츠 등 커뮤니티 담론)와 안 맞아 keep=true의 87%가 "기타"로 나왔다. UI 카테고리가 필요하면 이 `content_type`을 그대로 쓴다.

### `keywords` — 키워드 엔티티

| 컬럼 | 타입 | 내용 |
|---|---|---|
| `id` | int PK | |
| `term` | varchar(160) UNIQUE | 정식 이름 (canonical 반영됨) |
| `slug` | varchar(200) UNIQUE | 한글 슬러그(공백→하이픈). 상세페이지 라우팅용 |
| `category` | varchar(80) | `keyword_verdicts.content_type` 재사용 |
| `source_id` | int | → `sources.id`, 최초 발견 소스(가중치 최상위 소스로 추정) |
| `first_seen_at` | timestamptz | 최초 발견 시각 |
| `created_at` | timestamptz | |

`savePopularRun()`이 스냅샷을 저장하기 전, `keep=true`로 살아남은 term을 전부 `upsertKeyword()`로 승격시킨다. 이미 있는 term은 건드리지 않는다(`first_seen_at`을 "최초" 그대로 유지하기 위해).

---

## 10. 실패 처리

매시간 크론이므로 LLM 장애로 그 시각 수집분이 날아가면 안 된다.

| 상황 | 동작 |
|---|---|
| `ANTHROPIC_API_KEY` 없음 | 필터 건너뛰고 원본 top10 저장 |
| API 오류·타임아웃 | 캐시된 판정만 적용, 나머지는 통과 |
| `stop_reason: refusal` | throw → 위 오류 경로 |
| `--no-llm` 플래그 | 호출 자체를 안 함 (비교용) |

`collection_runs.filtered`에 필터 적용 여부가 기록되므로 나중에 "이 run은 안 걸렀다"를 구분할 수 있다.

---

## 11. 실행 방법

```bash
# 매시간 자동 (launchd → run-hourly.sh)
#   collect.mjs → rank-popular.mjs --save

# 수동 확인 (DB에 안 씀)
node trend-rising/rank-popular.mjs

# LLM 없이 순수 점수 순위만 (비교용)
node trend-rising/rank-popular.mjs --no-llm

# 파라미터 바꿔서 실험 (TOP_N 기본 10, POOL 기본 50, HOURS 기본 6)
HOURS=24 TOP_N=30 POOL=100 node trend-rising/rank-popular.mjs

# 판정 캐시 워밍 — 전 기간 term을 일괄 판정 (1회, 약 $2)
node trend-rising/warm-verdicts.mjs --dry     # 대상 term 수만 확인
node trend-rising/warm-verdicts.mjs

# 전 기간 재생성 — 캐시만 읽고 API는 호출하지 않음
node trend-rising/backfill-popular.mjs --reset
```

`backfill-popular.mjs`가 튜닝 루프의 핵심이다. 가중치나 카테고리 계수를 고치고 `--reset`으로 돌리면 12일치 시계열이 새 기준으로 통째로 재생성된다. **API 호출은 0회다.**

---

## 12. 스케줄과 한계

`~/Library/LaunchAgents/com.trendrising.hourly.plist`가 매시 정각(`Minute: 0`)에 `run-hourly.sh`를 실행한다.

**맥이 꺼지거나 잠들면 수집도 LLM 호출도 안 된다.** 비용은 안 나가지만 데이터에 구멍이 생긴다. launchd는 놓친 시간을 하나하나 채우지 않고 깨어날 때 한 번만 따라잡는다. 삭제 전 147버킷 기준으로 28개 시점에서 수집 누락이 있었다.

---

## 13. 남은 문제

**참여도 보정이 아직 과거에 반영되지 않았다.** 유튜브 조회수·좋아요 수집이 2026-08-03 22시부터라, 백필된 시점 대부분이 보정 없이 계산됐다. 유튜브가 과소평가된 상태이고, 며칠 뒤 `backfill-popular.mjs --reset`을 다시 돌리면 반영된다.

**카테고리 계수가 아직 전부 1.0이다.** 필터 효과를 먼저 관찰한 뒤 정한다.

---

## 14. 파일 목록

| 파일 | 역할 | API 호출 |
|---|---|---|
| `collect.mjs` | 5소스 병렬 수집 → `raw_signals` | YouTube |
| `sources/*.mjs` | 소스별 스크래퍼 (dcbest, theqoo, instiz, youtube, gtrends, http) | |
| `tokenize.mjs` | 문장 → 단어. 조사 제거 + 불용어 | ❌ |
| `popular.mjs` | 인기 랭킹 로직 (가중치·보정·보너스) | ❌ |
| `verdict.mjs` | LLM 판정 — 모델 설정·프롬프트·스키마·호출·캐시 적용 | ✅ |
| `rank-popular.mjs` | 최신 창을 읽어 랭킹 계산·판정·출력·저장 | 간접 |
| `warm-verdicts.mjs` | 전 기간 term 일괄 판정 (60개씩 배치) | ✅ |
| `backfill-popular.mjs` | 전 기간 시간순 재생성. 캐시만 읽음 | ❌ |
| `store.mjs` | Postgres 저장 계층 | ❌ |
| `seed.mjs` | 초기 1회 데이터 적재 (이미 실행됨) | ❌ |
| `migrations/*.sql`, `migrations/*.mjs` | 1회 스키마 마이그레이션 기록 (실행 완료, 되돌리기 절 포함) | 일부 ✅ |
| `run-hourly.sh` | launchd가 매시간 호출 | |

**LLM 설정** (`verdict.mjs:19-20`):

```js
const MODEL  = process.env.VERDICT_MODEL  || "claude-sonnet-5";
const EFFORT = process.env.VERDICT_EFFORT || "medium";
```
