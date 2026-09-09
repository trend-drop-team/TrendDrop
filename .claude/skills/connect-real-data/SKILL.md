---
name: connect-real-data
description: TrendDrop UI(현재 mock)를 팀의 실 수집 파이프라인(Neon DB, /api/trends)에 잇는 방법. mock 트렌드 데이터를 실데이터로 교체하기 전에 읽을 것.
---

# connect-real-data — mock → 실데이터

## 현재 상태 (지도)
- **UI는 mock을 직접 import**: `app/page.tsx`가 `lib/trend-data.ts`(`dailyTrends`), `app/ranking-board.tsx`가 `lib/trend-timeline.ts`(고정 시드로 만든 합성 12스냅샷)를 그대로 쓴다. `/explore`·타임머신·A/B도 전부 `lib/trend-timeline.ts` 헬퍼(`snapshots`/`getSeriesForKeyword`/`getCategoryHeat`)에 의존.
- **실데이터 경로는 이미 존재**: `GET /api/trends` → `lib/trends-service.ts:getTrendFeed(category)` → `isDbConfigured()`면 Neon `trendSnapshots` 조회, 아니면 mock `trends` 반환. 반환 `{ data, meta:{ source:'mock'|'neon', dbConnected, updatedAt } }`.
- **수집기(팀)**: `app/api/admin/collect/*`(youtube · google-news · pipeline · pipeline-v-he)가 `trendSnapshots`에 적재. 매시간 실행 전제.
- **스키마**(`db/schema.ts`): `trendSnapshots(keywordId, score, growthRate, velocity, summary, reason, sourceLabel, sourceUrl, capturedAt)` + `keywords(term, category)` + `sources(name)`.

## 원칙
1. **UI 계약(shape)을 바꾸지 마라.** `RankedItem`/`Snapshot`/`TrendItem` 모양을 유지하고 **데이터 소스만** 교체 → 랭킹보드·타임머신·explore가 그대로 동작.
2. **mock을 fallback으로 유지.** DB 미설정이거나 이력이 부족하면 합성 데이터로 degrade → 데모가 항상 뜬다.
3. **팀 파일 무수정.** `trends-service`·수집기·`app/api/**`는 팀 소유. 어댑터는 우리 파일로 새로 추가.
4. **하이드레이션 원칙 유지.** 렌더 중 `Date.now`/`new Date` 금지 — 시각은 서버에서 포맷하거나 API `meta.updatedAt`를 문자열로.

## 단계

### 1단계 (쉬움) — "24시간/현재" 랭킹을 실데이터로
- `app/page.tsx`(서버 컴포넌트)에서 `getTrendFeed()`를 **직접 호출**(동일 프로세스라 fetch 불필요)해 `daily`로 넘긴다. `meta.source==='mock'`이면 기존과 동일하게 뜬다.
- 클라이언트 fetch가 필요하면 **절대 URL 하드코딩 금지**(= `collection-log-v-he` 500 교훈: 하드코딩 `http://localhost:3000` + uncaught fetch throw). 서버 컴포넌트 직접 호출을 우선.

### 2단계 (중간) — 실시간/타임머신 스냅샷을 실 이력으로
- 새 파일 `lib/trend-timeline-live.ts`: `trendSnapshots`를 `capturedAt` 시간버킷(예 1시간)으로 그룹핑해 `Snapshot[]` 생성. 버킷 내 `score` desc로 rank, 직전 버킷과 비교해 `previousRank`, score 이력으로 `spark` — **mock timeline이 계산하던 것을 실데이터로 재현**.
- 이력이 K개 미만이면 기존 합성 `snapshots`로 fallback. `getSeriesForKeyword`/`getCategoryHeat`도 동형으로 실데이터 버전 구현.
- 랭킹보드/explore는 여전히 `Snapshot[]`·헬퍼만 받으므로 **import 소스만 교체**하면 된다.

### 3단계 — 상세(/trend) "왜 뜨나"·근거
- `summary`/`reason`/`sourceLabel`/`sourceUrl`은 스키마에 있으니 수집기가 채우면 그대로 노출 가능(현재 채우는지 먼저 확인).
- **근거 타임라인(이벤트 시각순)**은 스키마에 이벤트 로그가 없음 → 당분간 합성 유지. 이벤트 테이블 추가는 팀과 협의.

## 환경
- `DATABASE_URL`(Neon) 있으면 `isDbConfigured()` true(`.env.example` 참고). 없으면 전부 mock으로 정상 동작.

## 검증
- 교체 후 `npm run verify:ui`로 하드 게이트 통과.
- **DB 유/무 두 경우 모두** 홈이 뜨는지(fallback) 확인. 관련 규약은 [[verify-ui]].
