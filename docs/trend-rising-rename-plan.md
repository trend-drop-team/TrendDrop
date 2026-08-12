# trend-rising 스키마 이름 변경 계획

> `trend-rising/store.mjs`의 실제 저장 스키마를
> [trend-data-schema-and-api-spec.md](trend-data-schema-and-api-spec.md) /
> [page-analysis-and-backend-design.md](page-analysis-and-backend-design.md)의 통합 스키마와
> 합칠 때, 용도가 같은 컬럼은 **문서 쪽 이름을 채택**한다는 원칙으로 정리한 목록입니다.
> 컬럼 추가/삭제 판단은 다루지 않고 **이름 변경 대상만** 정리합니다.

---

## 1. 테이블 이름

| 현재 (trend-rising) | 변경 후 (통합 스키마) | 비고 |
| -------------------- | ---------------------- | ---- |
| `rising_raw_items`   | `raw_signals`          | 기존 테이블과 통합 |
| `popular_runs`        | `collection_runs`      | 기존 테이블과 통합 |
| `popular_snapshots`   | `trend_snapshots`      | 기존 테이블과 통합 |
| `popular_term_verdicts` | `keyword_verdicts`   | 신설이지만, `popular_*` 접두사는 "인기 랭킹"이라는 임시 명칭의 잔재라 통합 스키마에 맞춰 이름을 바꿈 |

---

## 2. `rising_raw_items` → `raw_signals`

| 현재 컬럼 | 변경 후 | 비고 |
| --------- | ------- | ---- |
| `source` (값: `dcbest`/`theqoo`/`instiz`/`youtube`/`gtrends`) | `source_id` (FK → `sources`) | **단순 이름 변경이 아니라 구조 변경.** 문자열 대신 `sources` 테이블을 참조하도록 전환 필요. 값은 `sources.kind`로 매핑 |
| `unit` (값: `title`/`comment`) | `source` | 문서의 `raw_signals.source` 필드가 원래 이 의미(신호 종류)로 쓰이고 있음. 위 항목이 `source_id`로 빠지면서 이름이 비므로 `unit` → `source`로 이동 |
| `collected_at` | `captured_at` | 문서 필드명과 통일 |
| `meta.videoId` (jsonb 내부) | `video_id` (독립 컬럼) | 문서는 `video_id`를 `meta` 밖 별도 컬럼으로 이미 분리해 둠 — 그 방식을 따름 |
| `text`, `text_hash`, `meta`, `bucket_at` | (변경 없음) | — |

> ⚠️ `source`(사이트) → `source_id`, `unit`(종류) → `source`로 **서로 자리를 바꾸는 셈**이라 마이그레이션 시 컬럼명 혼동에 주의.

---

## 3. `popular_runs` → `collection_runs`

| 현재 컬럼 | 변경 후 | 비고 |
| --------- | ------- | ---- |
| `ran_at` | `started_at` | 문서 필드명과 통일 |
| `item_count` | `raw_signal_count` | 문서 필드명과 통일 |
| `id`, `bucket_at`, `window_hours`, `buckets`, `filtered` | (변경 없음) | 문서에 대응 필드가 없던 신규 채택 컬럼이라 이름 유지 |

---

## 4. `popular_snapshots` → `trend_snapshots`

| 현재 컬럼 | 변경 후 | 비고 |
| --------- | ------- | ---- |
| `bucket_at` | `captured_at` | 문서 필드명과 통일 |
| `sources` (jsonb `[{source, weightSum}]`) | `reasons[].weight`로 흡수 | 별도 컬럼 유지 안 함. 문서의 `reasons`(jsonb `[{source, text}]`) 배열 항목에 `weight` 키를 추가하는 형태로 병합 |
| `sample` | `reasons[].sample`로 흡수 | 위와 동일하게 `reasons` 배열 항목 안으로 이동 |
| `units` | (삭제) | `reasons` 항목 수로 파생 가능, 컬럼 유지 불필요 |
| `breadth` | (삭제) | `reasons` 배열 길이로 파생 가능 |
| `prev_rank` | (삭제) | 직전 `run` 대비 쿼리로 계산(문서 6.3절 방침) |
| `term` | `keyword_id` (FK → `keywords`) | 이름 변경이라기보다 구조 변경 — 텍스트 대신 키워드 엔티티 참조로 전환 |
| `id`, `run_id`, `rank`, `score`, `mentions` | (변경 없음) | — |

---

## 5. `popular_term_verdicts` → `keyword_verdicts`

| 현재 컬럼 | 변경 후 | 비고 |
| --------- | ------- | ---- |
| `category` | `content_type` | **이름 충돌 방지.** 문서의 `categories`/`keywords.category_id`(UI 탭용: 푸드/뷰티/테크)와 축이 완전히 다름(콘텐츠 성격 분류: 인물/작품·콘텐츠/사건·사고/스포츠/일반어 등). 같은 이름 `category`를 쓰면 혼동되므로 다른 이름 채택 |
| `term`, `keep`, `canonical`, `reason`, `sample`, `model`, `decided_at` | (변경 없음) | 문서에 대응 개념이 없던 신규 테이블이라 이름 유지 |

---

## 6. 요약 — 실제 이름이 바뀌는 컬럼만 모아보기

| trend-rising 현재 이름 | 새 이름 |
| ----------------------- | ------- |
| `rising_raw_items.source` | `raw_signals.source_id` (FK, 구조 변경) |
| `rising_raw_items.unit` | `raw_signals.source` |
| `rising_raw_items.collected_at` | `raw_signals.captured_at` |
| `rising_raw_items.meta.videoId` | `raw_signals.video_id` |
| `popular_runs.ran_at` | `collection_runs.started_at` |
| `popular_runs.item_count` | `collection_runs.raw_signal_count` |
| `popular_snapshots.bucket_at` | `trend_snapshots.captured_at` |
| `popular_snapshots.term` | `trend_snapshots.keyword_id` (FK, 구조 변경) |
| `popular_snapshots.sources` | `trend_snapshots.reasons[].weight` (구조 변경) |
| `popular_snapshots.sample` | `trend_snapshots.reasons[].sample` (구조 변경) |
| `popular_term_verdicts.category` | `keyword_verdicts.content_type` |
