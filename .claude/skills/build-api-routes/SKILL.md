---
name: build-api-routes
description: TrendDrop 백엔드를 Route → Service → Repository → DB로 작성할 때 지킬 규칙. app/api 아래 엔드포인트를 새로 만들거나 server/services·server/repositories를 고칠 때 읽을 것.
---

# build-api-routes — Route → Service → Repository로 API 구현하기

## 구조
```
app/api/**/route.ts                  ← Route Handler: HTTP만
server/services/*.service.ts         ← 비즈니스 로직 (도메인별: category/trend/keyword/heatmap/watchlist)
server/repositories/*.repository.ts  ← DB 접근만 (도메인별) + shared.ts(공유 저수준 조회·타입)
db/schema.ts, db/index.ts            ← 스키마·커넥션
mocks/trends/{data,timeline,repository}.ts ← Mock 데이터·Mock 소스
server/http/{auth,errors,query}.ts   ← HTTP 공통 코드
types/api/*.ts                       ← 응답 DTO 타입 (category/trend/keyword/heatmap/watchlist/common)
lib/{env.ts, docs.ts, utils/{date,normalize,slug,rank}.ts} ← 범용 유틸만
```
Route↔Controller, Service↔Service, Repository↔Repository가 거의 그대로 대응되므로 NestJS 이관에도 도움이 된다 — Server Action을 쓰지 않는 이유(아래 "1. 레이어 경계" 참고)와 같은 맥락.

## 핵심 규칙

### 1. 레이어 경계
- **route.ts**: Request 파싱·쿼리 파싱·인증 체크·Service 호출·상태 코드 결정만. DB 쿼리·비즈니스 계산 금지. Server Action(`"use server"`)은 쓰지 않는다 — Route Handler는 나중에 다른 백엔드로 옮길 때 컨트롤러로 그대로 대응되지만 Server Action은 Next.js에 종속된다.
- **service**: "이 기능이 어떤 규칙으로 동작하는가"만 담당. Ranking/Ticker/Sparkline 계산, Daily/Realtime 분기, 카테고리 필터링, mock 대체 여부 판단이 여기. `NextResponse`나 `Request`를 반환/인자로 받지 않는다 — 실패는 `NotFoundError` 같은 타입 에러를 throw하고 route.ts가 HTTP 상태로 변환.
- **repository**: "DB에서 데이터를 어떻게 가져오는가"만. SELECT/JOIN/WHERE/ORDER BY까지. Ranking 계산이나 "3시간 전"/"+182%" 같은 UI 문자열 조립·티커 생성·정규화는 넣지 않는다 — 원본에 가까운 값("ingredients")을 반환하고 가공은 service가 한다. 예: `dbTimelineIngredients`(trend)·`dbHeatmapIngredients`(heatmap)·`dbKeywordSnapshotHistory`(keyword)가 raw row를 돌려주면, 각 `*.service.ts`의 `build*` 함수가 최종 응답 모양을 조립한다.
- Repository는 도메인 단위(트렌드/키워드/카테고리/히트맵/워치리스트)로 묶는다. 테이블 1개 = 파일 1개가 목표가 아니다 — 한 도메인 조회에 여러 테이블이 필요하면 한 repository 안에서 조인해도 된다.
- Service도 도메인 단위 파일 하나로 묶는다. 함수 하나당 파일 하나로 쪼개지 않는다.

### 2. Mock/DB 선택은 "설정값 기준" — 예외를 잡아서 하지 않는다
`isDbConfigured()`가 없으면 mock, 있으면 DB를 직접 부른다. 진짜 쿼리 실패(연결 오류·SQL 버그)는 어디서도 잡지 않는다 — route.ts의 `handleRouteError`까지 그대로 올라가 500으로 노출되게 둔다. 스키마 불일치나 SQL 버그를 mock이 조용히 가리는 경로를 만들지 않는다.

**단, "쿼리는 성공했지만 결과가 정말 비어 있다"는 예외가 아니다.** 이럴 땐 서비스 코드에 명시적으로, 눈에 보이게 처리한다:
```ts
// server/services/category.service.ts
let rows = isDbConfigured() ? await dbCategories() : [];
let source: "db" | "mock" = isDbConfigured() ? "db" : "mock";
if (rows.length === 0) { rows = mockCategories(); source = "mock"; }  // 데이터가 아직 없는 정상 상태
```
이 처리는 아무 데나 붙이지 않는다 — 붙이는 기준:
- **붙임**: 테이블이 실제로 비어 있을 수 있는 게 알려진 정상 상태(예: 파이프라인이 아직 안 채움, 방금 띄운 DB)일 때만. `meta.source`를 `"mock"`으로 정직하게 바꾼다.
- **안 붙임**: "없음"이 요청에 고유한 정답인 경우(예: `getKeywordDetail`처럼 존재하지 않는 슬러그는 `NotFoundError`(404)로 표현 — mock 데모 콘텐츠로 가리면 오히려 혼란스럽다. `getWatchlist`처럼 로그인한 사용자가 저장한 게 없다는 정상 상태를 mock 예시 항목으로 채우면 거짓 정보가 된다).
- 새 도메인을 추가할 때 이 둘 중 뭐가 맞는지 먼저 판단할 것.
- 실제 DB Repository와 Mock Repository는 같은 도메인 타입(예: `CategoryRow[]`, `KeywordDetail`)을 반환하게 맞춘다. Service 쪽에 `if (source === "db")`로 응답 모양 자체가 갈라지는 분기가 생기면 잘못된 신호다.

### 3. 응답·에러 계약
`{ data, meta }` / `{ error, detail? }` / 400·401·404·500 규약(`docs/unified-schema-api-spec.md` 2절)을 따른다. 새 필드·엔드포인트를 추가하면 이 문서와 `types/api/*.ts`도 같이 갱신한다.

### 4. 변경은 한 번에 몰아서 하지 않기
폴더 구조 변경 + 함수명 변경 + 쿼리 변경 + 응답 스펙 변경을 같은 작업에서 동시에 하지 않는다. 파일 이동 → import 정리 → 기존 동작 확인 → 책임 분리 → 로직 개선 순서로 나눠서 진행한다. 문제가 생겼을 때 원인을 좁히기 쉬워진다.

### 5. Server-only 코드가 클라이언트 번들에 섞이지 않게
`server/services`, `server/repositories`, `db`는 Client Component(`"use client"`)에서 직접 import하지 않는다. DB client·secret·repository는 서버 전용 — 필요하면 `server-only` 패키지로 강제.

### 6. `lib`를 잡동사니 폴더로 만들지 않기
`lib`에는 `env.ts`, `docs.ts`, `utils/{date,normalize,slug,rank}.ts` 같은 범용 코드만 둔다. 도메인 로직을 `lib/createTrend.ts`처럼 lib에 넣지 않는다 — 책임이 명확하면 해당 레이어(`server/services`, `server/repositories`) 폴더로.

## 쿼리를 짤 때 주의할 것 — `RUN_AT`
`server/repositories/shared.ts`의 `RUN_AT`(= `sql<Date>\`coalesce(bucket_at, started_at)\``)은 진짜 컬럼이 아니라 raw SQL 조각이다.
- **비교할 땐 ISO 문자열로.** `gte(RUN_AT, someDate)`처럼 drizzle 비교 헬퍼에 JS `Date`를 직접 넘기면 `ERR_INVALID_ARG_TYPE`으로 크래시한다 → `sql\`${RUN_AT} >= ${since.toISOString()}\`` 처럼 raw sql 템플릿 + ISO 문자열로 비교한다.
- **select한 값은 감싸서 쓸 것.** `RUN_AT`으로 select한 값은 자동으로 `Date` 인스턴스가 안 된다 — `clockLabel`/`relativeTime`에 넘기기 전에 반드시 `new Date(row.at)`으로 감싼다(`recentRuns`가 이렇게 함).
- **`collection_runs`에 스냅샷 없는 run이 섞여 있을 수 있다.** 수집 파이프라인은 원문만 모으는 run(`trend_snapshots` 없음)과 랭킹까지 계산해 저장하는 run으로 나뉜다. "최근 run"이 필요한 쿼리는 pipeline 이름으로 거르지 말고 `exists(select 1 from trend_snapshots where run_id = ...)`처럼 실제 데이터 존재 여부로 거른다(`recentRuns()`가 이렇게 함) — pipeline 이름이 바뀌어도 안 깨진다.

## 인증
`getUserId()`(x-user-id 헤더/td-user 쿠키를 신뢰하는 임시 경계, `TODO(auth)`)는 `server/http/auth.ts`에 있다. 실제 세션 발급이 붙기 전까지 이 함수를 우회하거나 다른 곳에 별도 인증 로직을 만들지 않는다.

## 검증
- 여러 파일을 고칠 땐 단계마다 `npx tsc --noEmit`으로 깨진 import부터 잡는다.
- 다 끝나면 `npm run verify:ui`. `app/api`가 protected 경고에 뜨는 건 API를 직접 다루는 작업에서는 정상 — `components`/`db`/`app/collection-log*`가 함께 뜨면 의도한 변경인지 다시 확인.
- **반드시 실제 요청을 태워서 확인한다.** `tsc`/`eslint`/`next build`는 런타임 버그(위 `RUN_AT` 함정 등)를 못 잡는다. `npx next dev`로 띄우고 `curl`로 각 엔드포인트를 때려 `meta.source`가 기대한 값인지, 응답이 비어있지 않은지 확인한다.
- 관련 규약: [[verify-ui]]
