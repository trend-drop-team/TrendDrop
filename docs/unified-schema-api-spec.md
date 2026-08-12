# TrendDrop 통합 스키마 기준 API 명세

> **소스**: `db/unified-schema.ts`(실제 코드)와 `docs/feature-checklist.md`(화면별 기능 리스트)를
> 다시 대조해서 작성한 문서입니다. 검토 과정에서 코드와 문서가 어긋난 지점 두 곳(`trend_snapshots.source_id`,
> `users` 인증 컬럼)을 찾았는데, 문서를 코드에 맞추는 대신 **코드 쪽을 의도에 맞게 고쳐서 반영**했습니다 —
> `source_id`는 컬럼을 삭제했고, `users`에는 `password_hash`/`name`/`email_verified_at`/`updated_at`을
> 추가했습니다. 아래 스키마 설명은 그 반영이 끝난 현재 코드 기준입니다.
>
> 이 문서도 **설계안(target spec)**이며, 실제 구현 상태는 기존 문서 6절 "현재 구현 상태" 표를 함께 참고하세요.

---

## 1. 커버리지 확인 — `feature-checklist.md` 요구 항목 ↔ 이 문서 엔드포인트

`feature-checklist.md`의 각 🟡 항목이 요구하는 "실데이터 연동 경로"를 모두 아래 엔드포인트로 커버합니다.

| feature-checklist.md 항목 | 필요 엔드포인트 | 이 문서 절 |
| -------------------------- | ---------------- | ---------- |
| 1.1 랭킹 리스트(탭 전환·카테고리 필터·요약 통계·FLIP·스파크라인·등락 배지·호버 프리뷰) | `GET /api/trends` | 3.2 |
| 1.1 홈 상단 실시간 하이라이트 티커 | `GET /api/trends`의 `meta.ticker` | 3.2 |
| 1.1 타임머신/타임랩스(과거 시점 이동) | `GET /api/keywords/:slug/history` 또는 시점별 `GET /api/trends?runId=` (2단계, 아래 3.2 비고) | 3.2, 3.4 |
| 1.3 워치리스트 패널 | `GET`/`POST`/`DELETE /api/watchlist` | 3.6 |
| 2.1 히트맵 | `GET /api/explore/heatmap` | 3.5 |
| 2.2 키워드 A/B 비교 | `GET /api/keywords/:slug/history` | 3.4 |
| 3 트렌드 상세(히어로·핵심지표·스파크라인·AI요약·연관 키워드·감지 채널) | `GET /api/keywords/:slug` | 3.3 |
| 3 근거 타임라인, 출처 카드 원문 발췌 | `GET /api/keywords/:slug`(확장 — `timeline`/`related[].excerpt` 추가) | 3.3, 4 |
| 카테고리 탭/히트맵 행 순서 | `GET /api/categories` | 3.1 |

`feature-checklist.md`의 모든 🟡 항목이 빠짐없이 엔드포인트를 갖습니다. "근거 타임라인"과 "원문 발췌"는
기존 스키마엔 담을 컬럼이 없어 이전 버전에선 엔드포인트 없이 남겨뒀지만, 이번에 4절에 신규 테이블/컬럼을
제안하고 3.3절 응답에 필드를 추가해 커버리지를 채웠습니다.

---

## 2. 응답 공통 규칙

- 모든 성공 응답은 `{ data, meta? }` 형태.
- `meta.updatedAt`은 응답에 포함된 데이터의 최신 갱신 시각(ISO 8601).
- 에러는 공통 포맷: `{ "error": "사람이 읽는 메시지", "detail": "원인(선택)" }`
- 상태 코드: `400`(요청 오류) · `404`(대상 없음) · `401`(인증 실패, 워치리스트·admin API) · `500`(서버 오류)

---

## 3. 엔드포인트

### 3.1 `GET /api/categories`

DB 소스: `categories` 전체, `sort_order` 오름차순.

```json
{
  "data": [
    { "name": "전체", "slug": "all", "sortOrder": 0 },
    { "name": "푸드", "slug": "food", "sortOrder": 1 }
  ]
}
```

사용 화면: 홈 카테고리 탭, `/explore` 히트맵 행 순서

### 3.2 `GET /api/trends?period=realtime|daily&category=&limit=30`

DB 소스: 가장 최근 `collection_runs.id`(=`runId`) 한 건에 속한 `trend_snapshots`를 `rank` 순으로 조회하고,
`keywords`/`categories`를 조인.

```json
{
  "data": [
    {
      "rank": 1,
      "keyword": "제로슈가 아이스티",
      "slug": "zero-sugar-ice-tea",
      "category": "푸드",
      "previousRank": 2,
      "growth": "+182%",
      "velocity": "9.1/10",
      "score": 88,
      "source": "Instagram Reels, Facebook Groups",
      "summary": "운동 루틴과 다이어트 브이로그에서 반복 노출...",
      "spark": [22, 26, 24, 41, 58, 74, 100]
    }
  ],
  "meta": {
    "period": "realtime",
    "runId": 482,
    "updatedAt": "2026-08-12T05:00:00Z",
    "ticker": [
      { "keyword": "두바이 초콜릿", "kind": "new", "delta": 0 },
      { "keyword": "저속노화 식단", "kind": "surge", "delta": 4 }
    ]
  }
}
```

필드 매핑: `rank`/`score`/`growthRate→growth`/`velocity`는 `trend_snapshots`, `keyword`/`slug`는 `keywords.term`/`slug`,
`category`는 `keywords.category_id`로 조인한 `categories.name`, `source`는 `trend_snapshots.source_label`,
`previousRank`는 직전 `run_id`의 같은 `keyword_id` 순위, `spark`는 최근 7개 `run`의 `score` 시계열.

`meta.ticker`는 이번 `runId`에서 새로 진입(`kind: "new"`)했거나 순위가 급등(`kind: "surge"`, `delta`만큼)한 키워드 목록.

> **타임머신/타임랩스 비고**: 과거 시점 이동은 `runId` 쿼리 파라미터를 추가로 받아(`GET /api/trends?runId=471`)
> 해당 시점 스냅샷을 반환하는 방식을 권장. 별도 엔드포인트를 새로 만들기보다 기존 `/api/trends`를 확장하는 편이
> `meta.ticker` 등 응답 형태를 재사용할 수 있어 더 간단합니다.

사용 화면: 홈 `RankingBoard`

### 3.3 `GET /api/keywords/:slug`

DB 소스: `keywords`(slug로 조회) + 최신 `trend_snapshots` 1건 + `trend_contents`(keyword_id) + `keyword_relations` 조인.

```json
{
  "data": {
    "rank": 1,
    "keyword": "제로슈가 아이스티",
    "category": "푸드",
    "growth": "+182%",
    "velocity": "9.1/10",
    "score": 88,
    "detectedAgo": "2시간 전",
    "updatedAgo": "2시간 전",
    "summary": "운동 루틴과 다이어트 브이로그에서 반복 노출되며...",
    "reasons": [
      {
        "source": "Instagram Reels",
        "text": "\"10초 홈카페\" 포맷 레시피 릴스가 저장 수 상위권에 반복 진입"
      }
    ],
    "series": [22, 26, 24, 41, 58, 74, 100],
    "days": ["월", "화", "수", "목", "금", "토", "일"],
    "related": [
      {
        "platform": "Instagram",
        "title": "제로슈가 홈카페 3종 레시피",
        "metric": "저장 12.4K",
        "kind": "릴스",
        "url": "https://...",
        "thumbnailUrl": "https://...",
        "excerpt": "\"제로슈가 스티비아 베이스로 만든 여름 홈카페 3종, 저장해두고 하나씩 따라 해보세요...\""
      }
    ],
    "keywords": ["#다이어트음료", "#홈카페", "#저칼로리"],
    "channels": ["Instagram Reels", "Facebook Groups", "YouTube Shorts"],
    "timeline": [
      { "channel": "Instagram Reels", "detectedAt": "2026-08-11T09:00:00Z", "label": "첫 레시피 릴스 업로드" },
      { "channel": "Facebook Groups", "detectedAt": "2026-08-11T13:20:00Z", "label": "커뮤니티 공유 시작" },
      { "channel": "YouTube Shorts", "detectedAt": "2026-08-12T02:10:00Z", "label": "쇼츠 재확산, 언급량 3배 증가" }
    ]
  }
}
```

필드 매핑: `reasons`는 `trend_snapshots.reasons`(jsonb) 그대로, `related`는 `trend_contents`
(`platform←kind`, `metric←metric_label`, `thumbnailUrl←thumbnail_url`, `excerpt←excerpt` — **NEW 컬럼, 4.1절**),
`keywords`(연관 키워드 칩)는 `keyword_relations.related_keyword_id → keywords.term`을 `weight` 내림차순으로.
`detectedAgo`는 `keywords.first_seen_at`, `updatedAgo`는 `trend_snapshots.captured_at` 기준 상대 시간.
`timeline`은 **신규 테이블 `trend_events`**(4.2절)를 `detected_at` 오름차순으로 조회.

없는 slug 요청 시: `404 { "error": "keyword not found" }`

사용 화면: `/trend/[slug]` 상세 페이지

### 3.4 `GET /api/keywords/:slug/history?window=12h`

DB 소스: 해당 `keyword_id`의 `trend_snapshots`를 `run_id` 순으로, `window` 시간 범위만큼.

```json
{
  "data": [
    { "runId": 471, "rank": 3, "score": 61 },
    { "runId": 472, "rank": null, "score": 0 },
    { "runId": 473, "rank": 2, "score": 74 }
  ]
}
```

`rank: null`은 해당 시점에 순위권 밖(이탈)을 의미.

사용 화면: `/trend` 스파크라인, `/explore` A/B 비교 차트, 홈 타임머신/타임랩스(3.2 비고)

### 3.5 `GET /api/explore/heatmap?window=12h`

DB 소스: `trend_snapshots`를 `run_id` × `category_id`로 그룹핑해 카테고리별 평균/최대 `score`를 heat(0~100)로 정규화.

```json
{
  "data": {
    "columns": [
      { "runId": 471, "clock": "14:00", "label": "12시간 전", "isLatest": false },
      { "runId": 482, "clock": "지금", "label": "지금", "isLatest": true }
    ],
    "categories": ["푸드", "뷰티", "테크"],
    "matrix": [
      [40, 55, 100],
      [30, 42, 61],
      [20, 38, 45]
    ]
  }
}
```

`matrix[행][열]` = 해당 카테고리·시점의 heat(0~100). `categories` 순서는 `categories.sort_order` 기준.

사용 화면: `/explore` 히트맵

### 3.6 워치리스트

| 엔드포인트 | 설명 | 인증 |
| ---------- | ---- | ---- |
| `GET /api/watchlist` | 저장한 키워드 목록 | 필요 |
| `POST /api/watchlist` `{ keywordSlug }` | 추가 | 필요 |
| `DELETE /api/watchlist/:id` | 삭제 | 필요 |

DB 소스: `watchlist_items`(`user_id`, `keyword_id`) + `keywords` 조인.

> **인증**: `users`에 `password_hash`/`email_verified_at` 등 인증 컬럼이 있어 이메일+비밀번호 로그인을
> 그대로 구현할 수 있습니다. 로그인 세션에서 얻은 `user_id`로 위 세 엔드포인트를 호출하면 됩니다
> (세션/토큰 발급 방식은 이 문서 범위 밖).
>
> `feature-checklist.md` 1.3절이 지적한 "홈 워치리스트 패널"과 "랭킹 행 ★ 즐겨찾기(`localStorage`)" 두 UI는
> 이 API 하나로 반드시 통합해야 합니다(중복 저장 UI 금지).

---

## 4. 신규 제안 스키마 — 근거 타임라인 · 원문 발췌

`feature-checklist.md`에 커버리지 공백을 남기지 않기 위해, 기존 스키마에 없던 두 항목을 이번에 설계해서
3.3절 응답에 편입시켰습니다. 아래 둘 다 **아직 `db/unified-schema.ts`에 없는 제안(proposal)**이며, 실제
컬럼/테이블 추가는 팀 리뷰 후 진행해야 합니다.

### 4.1 `trend_contents.excerpt` (컬럼 추가)

| 컬럼 | 타입 | 설명 |
| ---- | ---- | ---- |
| `excerpt` | text, nullable | 출처 카드의 "원문 발췌 접기/펼치기"에 쓰는 인용문. 수집기가 원문에서 대표 문단/자막 일부를 그대로 저장 |

기존 `trend_contents`(`title`/`url`/`thumbnail_url`/`metric_label`/`source`/`rank`/`published_at`)에 컬럼 하나만
추가하면 되므로, 마이그레이션 부담이 가장 작은 항목입니다.

### 4.2 `trend_events` (신규 테이블)

| 컬럼 | 타입 | 설명 |
| ---- | ---- | ---- |
| `id` | bigint PK | — |
| `keyword_id` | FK → keywords | — |
| `channel` | varchar(80) | 이벤트가 감지된 채널 (예: `Instagram Reels`, `YouTube Shorts`) — 타임라인의 채널별 마커에 사용 |
| `detected_at` | timestamptz | 이벤트가 감지된 시각. 타임라인 정렬 기준 |
| `label` | text | 사람이 읽는 한 줄 설명 (예: "첫 레시피 릴스 업로드", "쇼츠 재확산, 언급량 3배 증가") |
| `content_id` | FK → trend_contents, nullable | 특정 콘텐츠와 연결되는 이벤트면 참조(없으면 null) |

`trend_snapshots`는 run당 1행뿐이라 "몇 시 몇 분에 어느 채널에서 처음 포착됐는지" 같은 세분 이벤트를 담을 곳이
없었던 게 원래 문제였습니다. `trend_events`는 그 목적 하나만 위한 얇은 로그 테이블이라 `trend_snapshots`/
`trend_contents`의 기존 구조에는 영향을 주지 않습니다.

### 반영 위치

두 스키마 모두 새 엔드포인트를 만들지 않고 **기존 `GET /api/keywords/:slug`(3.3절)에 필드를 추가**하는
방식으로 노출합니다 — 이미 그 화면(`/trend/[slug]`)에서 근거 타임라인과 출처 카드를 같이 렌더링하므로,
별도 API 호출 없이 한 번에 받는 게 프론트 구현이 더 간단합니다.

> 컬럼/테이블이 실제로 추가되기 전까지는 `timeline`/`excerpt` 필드를 채울 데이터가 없으므로, 당분간
> 프론트에서 합성 데이터로 유지하는 게 맞습니다 — 4.1/4.2가 실제 스키마에 반영된 뒤에 API가 이 필드를 채웁니다.

---

## 5. 관리자 API (참고용)

`POST /api/admin/collect/:pipeline` — 이미 구현되어 있고(`app/api/admin/collect/*`), `Authorization: Bearer $CRON_SECRET` 필요.
이 문서의 워치리스트·트렌드 조회 API와 달리 프론트가 직접 호출하지 않으므로 상세 스펙은 다루지 않습니다.

---

## 6. 용어집

| 용어 | 의미 |
| ---- | ---- |
| **run** | 한 번의 수집 실행, 시계열의 "시점" 단위 (`collection_runs.id`) |
| **score** | 0~100 트렌드 점수(정렬·차트 기준값) |
| **rank** | 해당 run 안에서 score로 매긴 순위 |
| **growth / velocity** | 사람이 읽는 표시용 문자열. 계산에 쓰지 말 것 |
| **previousRank** | 직전 run 대비 순위. `null`이면 신규 진입(NEW) |
| **slug** | 키워드/카테고리의 URL 식별자 |
| **ticker** | 홈 상단 신규/급상승 키워드 배너. `GET /api/trends`의 `meta.ticker` |
