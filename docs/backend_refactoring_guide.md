# TrendDrop Backend Refactoring Guide

> 대상: `trend-drop-team/TrendDrop` `master` 브랜치 기준  
> 목적: Next.js Route Handler 기반 백엔드 구조를 `Route → Service → Repository → DB` 형태로 명확히 분리하고, `lib` 디렉터리에 과도하게 모여 있는 책임을 정리한다.

---

## 1. 리팩토링 목표

현재 TrendDrop은 Next.js의 `app/api/**/route.ts`를 통해 API를 제공하고 있으며, 실제 비즈니스 로직과 DB 접근 로직은 주로 `lib/api` 아래에 모여 있다.

현재 구조도 동작 자체에는 문제가 없고, 특히 `route.ts`를 비교적 얇게 유지한 점은 좋은 방향이다. 하지만 기능이 늘어나면서 `lib/api`가 HTTP 처리, 서비스 로직, DB 접근, Mock 처리, 타입, 공통 유틸까지 함께 담당하게 되었다.

이번 리팩토링의 핵심 목표는 다음과 같다.

```text
Route Handler
    ↓
Service
    ↓
Repository
    ↓
DB
```

각 레이어가 하나의 책임만 갖도록 분리한다.

---

# 2. 현재 구조

현재 `master` 브랜치에서 백엔드 관련 주요 구조는 다음과 같다.

```text
TrendDrop/
├── app/
│   └── api/
│       ├── admin/
│       ├── categories/
│       ├── db/
│       ├── docs/
│       ├── explore/
│       ├── google-news/
│       ├── keywords/
│       ├── trends/
│       │   └── route.ts
│       └── watchlist/
│
├── lib/
│   ├── api/
│   │   ├── common.ts
│   │   ├── db-source.ts
│   │   ├── http.ts
│   │   ├── mock-source.ts
│   │   ├── service.ts
│   │   └── types.ts
│   │
│   ├── docs.ts
│   ├── env.ts
│   ├── trend-data.ts
│   └── trend-timeline.ts
│
├── db/
│   ├── index.ts
│   └── schema.ts
│
└── ...
```

현재 주요 요청 흐름은 다음과 같다.

```text
Client
  ↓
app/api/trends/route.ts
  ↓
lib/api/service.ts
  ↓
lib/api/db-source.ts
  ↓
db/index.ts / Drizzle
  ↓
PostgreSQL
```

DB를 사용할 수 없는 경우에는 다음 흐름도 존재한다.

```text
lib/api/service.ts
  ↓
fromDbOrMock()
  ├── DB 성공 → db-source.ts
  └── DB 실패 → mock-source.ts
                    ↓
             trend-data.ts
             trend-timeline.ts
```

---

# 3. 현재 구조의 문제점

## 3.1 `lib/api`가 너무 많은 책임을 가지고 있음

현재 `lib/api` 안에는 실제로 서로 다른 레이어가 모두 들어 있다.

```text
lib/api/
├── common.ts       → 공통 타입 + 에러 + 유틸 + query parser
├── db-source.ts    → DB 접근 + 데이터 조립 + 일부 비즈니스 로직
├── http.ts         → HTTP 응답 + 인증 처리
├── mock-source.ts  → Mock Repository 역할
├── service.ts      → Service 역할
└── types.ts        → API 타입
```

즉, 폴더 이름은 `api`이지만 내부에는 다음 책임이 혼재되어 있다.

```text
HTTP
Service
Repository
Mock
Domain 계산
Utility
Type
```

기능이 많아질수록 특정 로직이 어디에 있어야 하는지 판단하기 어려워질 가능성이 높다.

---

## 3.2 `db-source.ts`의 책임이 너무 큼

현재 `db-source.ts`는 단순 DB 조회만 담당하지 않는다.

예를 들어 다음과 같은 역할이 함께 들어 있다.

```text
DB Query
JOIN
Aggregation
Ranking 계산
Ticker 생성
Sparkline 생성
Heatmap 계산
API 응답 형태 변환
Watchlist CRUD
Keyword 상세 데이터 조립
```

Repository는 가능한 한 다음 질문에만 답하도록 만드는 것이 좋다.

> "필요한 데이터를 DB에서 어떻게 가져올 것인가?"

랭킹 계산이나 Ticker 생성 같은 로직은 Service 또는 별도 domain/helper 계층으로 올리는 것이 더 적절하다.

---

## 3.3 `common.ts`가 잡동사니 파일이 되고 있음

현재 `common.ts`에는 다음과 같은 코드가 함께 존재한다.

```text
ApiMeta
ApiResult
NotFoundError
fromDbOrMock
slugify
relativeTime
clockLabel
normalize
parseWindowHours
parseLimit
parseRunId
```

이들은 실제로 서로 다른 관심사다.

```text
API 타입
HTTP 에러
Data Source 선택
문자열 유틸
시간 유틸
수치 유틸
Query Parameter Parser
```

프로젝트가 커질수록 `common.ts`, `utils.ts` 같은 파일은 계속 비대해지기 쉬우므로 역할에 따라 분리하는 것이 좋다.

---

## 3.4 Mock 관련 코드가 `lib` 최상단에 위치함

현재 다음 파일들은 사실상 공통 라이브러리라기보다 Mock 데이터 계층이다.

```text
lib/trend-data.ts
lib/trend-timeline.ts
lib/api/mock-source.ts
```

이들은 서로 강하게 연결되어 있으므로 별도의 `mocks` 영역으로 묶는 것이 더 명확하다.

---

## 3.5 DB 실패 시 자동 Mock fallback이 실제 오류를 숨길 수 있음

현재 `fromDbOrMock()` 방식은 DB 접근 중 대부분의 예외를 잡아 Mock으로 전환한다.

```text
DB 미설정
→ Mock

DB 연결 오류
→ Mock

Schema 오류
→ Mock

SQL 코드 버그
→ Mock
```

이 구조는 개발 중 실제 DB 오류를 놓치게 만들 수 있다.

따라서 가능하면 "DB 호출 실패 후 Mock fallback"보다 "처음부터 사용할 Repository를 선택"하는 방식이 더 안전하다.

---

## 3.6 현재 master 기준 schema import 확인 필요

현재 `db-source.ts`에서는 다음 경로를 참조하는 코드가 존재한다.

```ts
@/db/unified-schema
```

하지만 현재 `master`의 `db/` 디렉터리에서는 다음 파일만 확인된다.

```text
db/
├── index.ts
└── schema.ts
```

따라서 리팩토링 전에 실제 schema import 경로를 반드시 정리해야 한다.

권장 방향은 다음과 같다.

```ts
@/db/schema
```

Repository들이 하나의 schema 경로만 바라보도록 통일한다.

---

# 4. 변경 후 권장 구조

TrendDrop 현재 규모에서는 Clean Architecture를 과하게 적용하기보다 아래 정도의 4단 구조가 가장 적절하다.

```text
TrendDrop/
│
├── app/
│   ├── api/
│   │   ├── categories/
│   │   │   └── route.ts
│   │   │
│   │   ├── trends/
│   │   │   └── route.ts
│   │   │
│   │   ├── keywords/
│   │   │   └── [slug]/
│   │   │       ├── route.ts
│   │   │       └── history/
│   │   │           └── route.ts
│   │   │
│   │   ├── explore/
│   │   │   └── heatmap/
│   │   │       └── route.ts
│   │   │
│   │   └── watchlist/
│   │       ├── route.ts
│   │       └── [id]/
│   │           └── route.ts
│   │
│   └── ...
│
├── server/
│   ├── http/
│   │   ├── auth.ts
│   │   ├── errors.ts
│   │   ├── query.ts
│   │   └── response.ts
│   │
│   ├── services/
│   │   ├── category.service.ts
│   │   ├── heatmap.service.ts
│   │   ├── keyword.service.ts
│   │   ├── trend.service.ts
│   │   └── watchlist.service.ts
│   │
│   └── repositories/
│       ├── category.repository.ts
│       ├── heatmap.repository.ts
│       ├── keyword.repository.ts
│       ├── trend.repository.ts
│       └── watchlist.repository.ts
│
├── db/
│   ├── index.ts
│   └── schema.ts
│
├── mocks/
│   └── trends/
│       ├── data.ts
│       ├── timeline.ts
│       └── repository.ts
│
├── lib/
│   ├── env.ts
│   └── utils/
│       ├── date.ts
│       ├── normalize.ts
│       └── slug.ts
│
├── types/
│   └── api/
│       ├── category.ts
│       ├── common.ts
│       ├── heatmap.ts
│       ├── keyword.ts
│       ├── trend.ts
│       └── watchlist.ts
│
└── ...
```

---

# 5. 각 디렉터리 역할

## `app/api`

Next.js Route Handler만 둔다.

역할:

```text
Request 읽기
Query Parameter 파싱
Body 파싱
HTTP 인증 경계
Service 호출
HTTP Status 결정
JSON Response 반환
```

가능하면 비즈니스 로직이나 SQL은 넣지 않는다.

---

## `server/services`

애플리케이션의 실제 비즈니스 로직을 담당한다.

예:

```text
트렌드 랭킹 생성
카테고리 필터링
Ticker 생성
Daily / Realtime 분기
Keyword Detail 조립
Heatmap 계산
Watchlist 정책 처리
```

Service는 다음 질문에 답하는 계층이다.

> "이 기능은 어떤 규칙으로 동작해야 하는가?"

---

## `server/repositories`

DB 접근을 담당한다.

역할:

```text
SELECT
INSERT
UPDATE
DELETE
JOIN
WHERE
ORDER BY
DB row 반환
```

Repository는 다음 질문에 답한다.

> "필요한 데이터를 DB에서 어떻게 가져오는가?"

가능하면 Ranking, Ticker 생성, UI용 문자열 조립 같은 비즈니스 로직은 넣지 않는다.

---

## `server/http`

HTTP에만 필요한 공통 코드를 둔다.

예:

```text
auth.ts
→ 요청에서 사용자 정보 추출

errors.ts
→ NotFoundError, HTTP 에러 변환

query.ts
→ limit, runId, period, window 파싱

response.ts
→ 공통 응답 형태 생성
```

---

## `db`

DB 연결과 schema 정의만 담당한다.

```text
db/index.ts
→ Drizzle Client 생성

db/schema.ts
→ Table Schema
```

---

## `mocks`

Mock 데이터와 Mock Repository를 둔다.

```text
mocks/trends/data.ts
mocks/trends/timeline.ts
mocks/trends/repository.ts
```

실제 DB Repository와 최대한 비슷한 인터페이스를 사용하도록 만드는 것이 좋다.

---

## `lib`

어느 특정 도메인에도 강하게 종속되지 않는 공통 기반 코드만 둔다.

최종적으로 `lib`가 작아져도 문제없다.

예:

```text
lib/env.ts
lib/utils/date.ts
lib/utils/slug.ts
lib/utils/normalize.ts
```

---

# 6. 현재 파일 → 변경 위치

| 현재 파일                | 변경 위치                                                                |
| ------------------------ | ------------------------------------------------------------------------ |
| `lib/api/service.ts`     | `server/services/*.service.ts`                                           |
| `lib/api/db-source.ts`   | `server/repositories/*.repository.ts`                                    |
| `lib/api/mock-source.ts` | `mocks/trends/repository.ts`                                             |
| `lib/api/http.ts`        | `server/http/auth.ts`, `errors.ts`, `response.ts`                        |
| `lib/api/common.ts`      | `server/http/query.ts`, `lib/utils/*`, `types/api/common.ts` 등으로 분리 |
| `lib/api/types.ts`       | `types/api/*`                                                            |
| `lib/trend-data.ts`      | `mocks/trends/data.ts`                                                   |
| `lib/trend-timeline.ts`  | `mocks/trends/timeline.ts`                                               |
| `lib/env.ts`             | 유지                                                                     |
| `lib/docs.ts`            | 필요하면 `server/services/docs.service.ts` 또는 별도 docs 모듈로 이동    |

---

# 7. 변경 후 요청 흐름

예를 들어 다음 API가 있다고 가정한다.

```http
GET /api/trends?period=realtime&limit=30
```

변경 후 요청 흐름은 다음과 같다.

```text
Browser
   │
   │ GET /api/trends
   ▼
app/api/trends/route.ts
   │
   │ getTrends(query)
   ▼
server/services/trend.service.ts
   │
   │ repository.findRecentTrends(...)
   ▼
server/repositories/trend.repository.ts
   │
   │ Drizzle Query
   ▼
db/index.ts
   │
   ▼
PostgreSQL
```

각 레이어의 역할은 다음처럼 구분된다.

```text
route.ts
→ "HTTP 요청이 어떻게 들어왔는가?"

service.ts
→ "Trend 기능이 어떤 규칙으로 동작해야 하는가?"

repository.ts
→ "DB에서 어떤 데이터를 어떻게 가져올 것인가?"

db/
→ "DB Client와 Table Schema는 무엇인가?"
```

---

# 8. Route Handler 예시

`route.ts`는 가능한 한 얇게 유지한다.

```ts
// app/api/trends/route.ts

import { NextResponse } from "next/server";

import { handleRouteError } from "@/server/http/errors";
import { parseLimit, parsePeriod, parseRunId } from "@/server/http/query";
import { getTrends } from "@/server/services/trend.service";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  try {
    const result = await getTrends({
      period: parsePeriod(searchParams.get("period")),
      category: searchParams.get("category") ?? undefined,
      limit: parseLimit(searchParams.get("limit")),
      runId: parseRunId(searchParams.get("runId")),
    });

    return NextResponse.json(result);
  } catch (error) {
    return handleRouteError(error, "Failed to load trends");
  }
}
```

Route Handler 안에서는 가능하면 다음 코드를 작성하지 않는다.

```text
복잡한 DB Query
Ranking 계산
Heatmap 계산
여러 Repository 조합
도메인 정책
대규모 데이터 가공
```

---

# 9. Service 예시

```ts
// server/services/trend.service.ts

import { getTrendRepository } from "@/server/repositories";

export type TrendPeriod = "realtime" | "daily";

export type TrendQuery = {
  period?: TrendPeriod;
  category?: string;
  limit?: number;
  runId?: number | null;
};

const DEFAULT_LIMIT = 30;

export async function getTrends(query: TrendQuery = {}) {
  const repository = getTrendRepository();

  const period = query.period ?? "realtime";
  const limit = query.limit ?? DEFAULT_LIMIT;

  if (period === "daily") {
    const rows = await repository.findDailyRows(limit);

    return {
      data: filterByCategory(rows, query.category),
      meta: {
        period,
      },
    };
  }

  const timeline = await repository.findTimeline(12, limit);

  const snapshot = selectSnapshot(timeline, query.runId);

  const rows = filterByCategory(snapshot.rows, query.category);

  return {
    data: rows,
    meta: {
      period,
      runId: snapshot.runId,
      ticker: buildTicker(rows),
    },
  };
}
```

Service에서 다음과 같은 로직을 담당한다.

```text
Realtime / Daily 분기
Category Filtering
Snapshot 선택
Ranking
Ticker 생성
Sparkline 계산
응답 데이터 조립
```

---

# 10. Repository 예시

```ts
// server/repositories/trend.repository.ts

import { desc, inArray } from "drizzle-orm";

import { getDb } from "@/db";
import { collectionRuns, trendSnapshots } from "@/db/schema";

export async function findRecentRuns(limit: number) {
  return getDb()
    .select()
    .from(collectionRuns)
    .orderBy(desc(collectionRuns.startedAt))
    .limit(limit);
}

export async function findSnapshotsByRunIds(runIds: number[]) {
  if (runIds.length === 0) {
    return [];
  }

  return getDb()
    .select()
    .from(trendSnapshots)
    .where(inArray(trendSnapshots.runId, runIds));
}
```

Repository는 DB 접근에 집중한다.

---

# 11. Mock Repository 구성

현재처럼 DB가 없을 때 Mock 데이터를 사용하는 요구가 있다면 실제 Repository와 비슷한 인터페이스를 만들면 좋다.

```text
server/repositories/trend.repository.ts
                ▲
                │ 같은 형태
                ▼
mocks/trends/repository.ts
```

예:

```ts
export type TrendRepository = {
  findTimeline(runCount: number, rowLimit: number): Promise<TimelineSnapshot[]>;
  findDailyRows(rowLimit: number): Promise<TrendRow[]>;
};
```

실제 Repository:

```ts
export const trendRepository: TrendRepository = {
  findTimeline,
  findDailyRows,
};
```

Mock Repository:

```ts
export const mockTrendRepository: TrendRepository = {
  findTimeline: async () => mockTimeline(),
  findDailyRows: async () => mockDailyRows(),
};
```

Repository 선택은 요청 중 실패 여부가 아니라 설정값을 기준으로 결정하는 것이 더 안전하다.

```ts
export function getTrendRepository(): TrendRepository {
  if (!isDbConfigured()) {
    return mockTrendRepository;
  }

  return trendRepository;
}
```

---

# 12. 리팩토링 후 장점

## 12.1 코드 위치를 찾기 쉬워짐

예를 들어 개발자가 `/api/trends` 로직을 찾고 싶다면 다음 순서로 보면 된다.

```text
app/api/trends/route.ts
        ↓
server/services/trend.service.ts
        ↓
server/repositories/trend.repository.ts
        ↓
db/schema.ts
```

각 레이어의 역할이 명확하기 때문에 코드 탐색 비용이 줄어든다.

---

## 12.2 Route Handler가 단순해짐

Route Handler는 HTTP 처리만 담당한다.

덕분에 API 엔드포인트가 많아져도 각 `route.ts`가 비대해지는 것을 막을 수 있다.

---

## 12.3 Server Component에서도 Service 재사용 가능

Next.js Server Component에서는 굳이 자기 서버의 `/api`를 다시 호출할 필요가 없다.

```text
Server Component
        ↓
trend.service.ts
        ↓
repository
```

외부 Client가 호출할 때만:

```text
Client
  ↓
/api/trends
  ↓
route.ts
  ↓
trend.service.ts
```

가 된다.

즉 같은 비즈니스 로직을 중복 없이 재사용할 수 있다.

---

## 12.4 DB 변경 영향 범위가 줄어듦

예를 들어 Drizzle에서 다른 ORM으로 변경한다고 가정한다.

기존 구조에서는 DB 쿼리와 데이터 조립 로직이 한 파일에 섞여 있어 수정 범위가 커질 수 있다.

Repository를 분리하면 대부분 다음 폴더만 수정하면 된다.

```text
server/repositories/
db/
```

Service와 Route Handler는 그대로 유지할 가능성이 높다.

---

## 12.5 테스트하기 쉬워짐

Service가 DB 구현에 직접 종속되지 않으면 Mock Repository를 주입하거나 대체하기 쉬워진다.

예:

```text
trend.service.test.ts
        ↓
Fake Repository
```

DB를 실제로 띄우지 않아도 다음 로직을 테스트할 수 있다.

```text
랭킹
필터
Ticker
Period 분기
Snapshot 선택
에러 처리
```

---

## 12.6 비즈니스 로직과 HTTP를 분리할 수 있음

HTTP Status Code나 Query Parameter는 HTTP 관심사다.

Ranking, Watchlist 정책, Trend 계산은 비즈니스 관심사다.

두 영역을 나누면 비즈니스 로직이 HTTP 구현 방식에 덜 종속된다.

---

## 12.7 기능 확장이 쉬워짐

향후 다음 기능이 추가되더라도 역할에 맞는 위치가 분명해진다.

```text
인증
사용자별 Watchlist
Trend 비교
알림
공유
AI Summary
Trend Source 추가
Admin
```

---

# 13. 권장 리팩토링 순서

한 번에 전체 구조를 바꾸기보다 아래 순서로 진행하는 것을 권장한다.

## Step 1. DB schema 경로 정리

가장 먼저 현재 schema 참조를 확인한다.

```text
@/db/unified-schema
```

가 실제로 존재하지 않는다면 다음처럼 통일한다.

```text
@/db/schema
```

이 작업을 먼저 해야 이후 파일 이동 중 문제 원인을 구분하기 쉽다.

---

## Step 2. `server/http` 분리

현재 `lib/api/http.ts`, `lib/api/common.ts`에서 HTTP 관련 코드를 먼저 옮긴다.

```text
server/http/
├── auth.ts
├── errors.ts
├── query.ts
└── response.ts
```

이 단계는 비즈니스 로직을 거의 건드리지 않기 때문에 상대적으로 안전하다.

---

## Step 3. `service.ts`를 도메인별로 분리

현재 하나의 `service.ts`에 있는 함수를 다음과 같이 분리한다.

```text
getCategories
→ category.service.ts

getTimeline
getTrends
→ trend.service.ts

getKeywordDetail
getKeywordHistory
→ keyword.service.ts

getHeatmap
→ heatmap.service.ts

getWatchlist
addWatchlistItem
removeWatchlistItem
→ watchlist.service.ts
```

이 단계에서는 우선 기존 구현을 그대로 이동하고 동작 변경은 최소화한다.

---

## Step 4. `db-source.ts` 분리

현재 큰 `db-source.ts`를 다음 Repository들로 분리한다.

```text
trend.repository.ts
keyword.repository.ts
category.repository.ts
heatmap.repository.ts
watchlist.repository.ts
```

처음에는 단순히 함수를 파일별로 이동하는 것부터 시작한다.

---

## Step 5. Repository에서 비즈니스 계산 제거

Repository 파일 이동이 끝난 후 다음 로직을 Service 쪽으로 이동한다.

```text
Ticker 계산
Ranking 계산
Spark 생성
Daily Aggregate 정책
Heatmap Weight 계산
API DTO 조립
```

단, DB에서 계산하는 것이 성능상 훨씬 유리한 Aggregate는 무조건 Service로 옮길 필요는 없다.

SQL에서 수행할지 Service에서 수행할지는 데이터 크기와 쿼리 비용을 보고 판단한다.

---

## Step 6. Mock 코드 이동

```text
lib/trend-data.ts
→ mocks/trends/data.ts

lib/trend-timeline.ts
→ mocks/trends/timeline.ts

lib/api/mock-source.ts
→ mocks/trends/repository.ts
```

---

## Step 7. 타입 분리

기능이 충분히 안정된 후 마지막으로 타입을 나눈다.

```text
types/api/
├── common.ts
├── trend.ts
├── keyword.ts
├── category.ts
├── heatmap.ts
└── watchlist.ts
```

타입 분리는 파일 이동량이 많기 때문에 초기 단계에서 동시에 수행하면 import 변경이 지나치게 커질 수 있다.

---

# 14. 구현 과정에서 유의할 점

## 14.1 파일 이동과 로직 변경을 동시에 너무 많이 하지 않기

리팩토링 중 가장 위험한 패턴은 다음을 한 PR에서 모두 바꾸는 것이다.

```text
폴더 구조 변경
+
함수 이름 변경
+
DB Query 변경
+
응답 Spec 변경
+
비즈니스 로직 변경
```

문제가 발생했을 때 원인을 찾기 어려워진다.

가능하면 다음 순서를 지킨다.

```text
1. 파일 이동
2. Import 정리
3. 기존 동작 확인
4. 책임 분리
5. 로직 개선
```

---

## 14.2 API Response Spec은 리팩토링 중 변경하지 않기

프론트엔드는 현재 API 응답 형태에 의존하고 있다.

따라서 리팩토링 중에는 가능한 한 다음 형태를 유지한다.

```json
{
  "data": [],
  "meta": {
    "source": "db",
    "updatedAt": "..."
  }
}
```

폴더 구조 변경과 API 계약 변경을 동시에 진행하면 프론트 오류와 백엔드 리팩토링 오류를 구분하기 어렵다.

---

## 14.3 Repository에 `NextResponse`, `Request`를 넘기지 않기

Repository는 HTTP 계층을 몰라야 한다.

잘못된 예:

```ts
async function getTrends(request: Request) {
  ...
}
```

좋은 예:

```ts
async function findTrends({ limit, runId }: TrendRepositoryQuery) {
  ...
}
```

---

## 14.4 Service에서도 가능하면 `NextResponse`를 반환하지 않기

Service는 HTTP Status Code를 직접 결정하기보다 데이터 또는 의미 있는 예외를 반환하는 것이 좋다.

잘못된 예:

```ts
return NextResponse.json(...)
```

좋은 예:

```ts
throw new NotFoundError(...)
```

그리고 Route Handler에서 이를 HTTP 404로 변환한다.

---

## 14.5 Repository 반환 타입을 UI에 지나치게 맞추지 않기

Repository가 다음처럼 UI 문자열까지 만들어 반환하기 시작하면 다시 책임이 섞인다.

```text
"3시간 전"
"NEW"
"+182%"
"방금 전"
```

가능하면 Repository는 원본 데이터에 가까운 값을 반환하고 Service에서 필요한 형태로 변환한다.

---

## 14.6 Server-only 코드가 Client Bundle로 들어가지 않도록 주의

다음 코드는 서버에서만 사용되어야 한다.

```text
DB Client
환경변수 Secret
Repository
Node fs
인증 Secret
외부 API Secret
```

Client Component에서 `server/services`, `server/repositories`, `db`를 직접 import하지 않도록 주의한다.

필요하면 서버 전용 모듈에 `server-only` 사용을 고려한다.

---

## 14.7 `lib`를 다시 잡동사니 폴더로 만들지 않기

리팩토링 이후 다음과 같은 파일을 무분별하게 다시 `lib`에 넣지 않는다.

```text
lib/createTrend.ts
lib/watchlist.ts
lib/trendService.ts
lib/apiHelper.ts
lib/common.ts
```

파일의 책임이 명확하다면 해당 도메인/레이어 폴더에 둔다.

`lib`에는 범용적이고 작은 기반 코드만 유지한다.

---

## 14.8 Service를 지나치게 잘게 쪼개지 않기

반대로 모든 함수마다 Service 파일을 하나씩 만드는 것도 좋지 않다.

예:

```text
getTrend.service.ts
getTimeline.service.ts
getDailyTrend.service.ts
getTrendDetail.service.ts
```

보다는 도메인 단위로 묶는 것이 좋다.

```text
trend.service.ts
keyword.service.ts
watchlist.service.ts
```

현재 TrendDrop 규모에는 이 정도가 적절하다.

---

## 14.9 Repository도 무조건 테이블 단위로 만들 필요 없음

Repository는 DB 테이블 하나당 하나씩 만드는 것이 목적이 아니다.

예를 들어 Trend 조회에 다음 테이블이 같이 필요할 수 있다.

```text
collection_runs
trend_snapshots
keywords
categories
```

이들을 하나의 `trend.repository.ts`에서 조회해도 된다.

핵심 기준은 "기능/도메인 단위로 자연스러운가"이다.

---

## 14.10 Mock과 실제 DB의 반환 구조를 동일하게 유지

Mock Repository와 실제 Repository가 다른 구조를 반환하면 Service에 분기가 계속 생긴다.

나쁜 예:

```ts
if (source === "db") {
  ...
} else {
  ...
}
```

좋은 구조:

```text
DB Repository ─┐
               ├→ 같은 타입 → Service
Mock Repository ┘
```

---

## 14.11 DB 오류를 Mock으로 무조건 숨기지 않기

Mock fallback은 다음 경우에만 명시적으로 사용하도록 하는 것이 좋다.

```text
DATABASE_URL 자체가 없음
명시적인 MOCK_MODE 사용
개발/Preview 환경에서 Mock 사용 설정
```

실제 DB가 설정되어 있는데 Query가 실패했다면 기본적으로 오류를 노출해야 한다.

그래야 schema mismatch, migration 누락, SQL 버그를 빨리 발견할 수 있다.

---

# 15. 권장 환경 설정 방식

향후에는 DB 사용 여부를 보다 명시적으로 만드는 것도 좋다.

예:

```env
DATA_SOURCE=db
```

또는

```env
DATA_SOURCE=mock
```

Repository 선택:

```ts
export function getTrendRepository() {
  switch (process.env.DATA_SOURCE) {
    case "mock":
      return mockTrendRepository;

    case "db":
      return trendRepository;

    default:
      throw new Error("DATA_SOURCE is invalid");
  }
}
```

이렇게 하면 "DB 오류 때문에 우연히 Mock 화면이 보이는 상황"을 방지할 수 있다.

---

# 16. 리팩토링 완료 후 목표 상태

최종적으로 개발자가 코드를 볼 때 다음처럼 이해할 수 있어야 한다.

```text
/api/trends는 어디서 처리하지?
→ app/api/trends/route.ts

Trend 계산은 어디 있지?
→ server/services/trend.service.ts

Trend DB 조회는 어디 있지?
→ server/repositories/trend.repository.ts

DB Schema는 어디 있지?
→ db/schema.ts

Mock Trend는 어디 있지?
→ mocks/trends/

Query Parameter 처리 공통 코드는?
→ server/http/query.ts

날짜/문자열 공통 유틸은?
→ lib/utils/
```

코드 위치를 예측할 수 있는 구조가 좋은 구조다.

---

# 17. 최종 정리

TrendDrop에서 권장하는 핵심 구조는 다음과 같다.

```text
app/api
   ↓
server/services
   ↓
server/repositories
   ↓
db
```

그리고 나머지 책임을 다음처럼 분리한다.

```text
HTTP 공통 처리
→ server/http

Mock
→ mocks

DB 연결 / Schema
→ db

범용 Utility
→ lib

공유 API Type
→ types
```

현재 구조에서 가장 먼저 개선할 부분은 다음 세 가지다.

1. `lib/api/service.ts`를 도메인별 Service로 분리
2. `lib/api/db-source.ts`를 Repository 계층으로 분리
3. `lib/api/common.ts`의 HTTP / Utility / Type 책임을 각각 이동

단, 리팩토링 과정에서는 **기존 API 응답 계약과 실제 동작을 최대한 유지하면서 파일 이동 → 책임 분리 → 로직 개선 순서로 진행하는 것**이 중요하다.

TrendDrop 현재 규모에는 복잡한 Clean Architecture보다 이 정도의 구조가 과하지 않으면서 유지보수성과 확장성을 크게 높일 수 있다.
