/**
 * 수집·랭킹에서 제외하는 커뮤니티 소스 목록.
 * X·유튜브·Google Trends RSS 중심으로 운영하기 위해 디시·더쿠·인스티즈를 뺀다.
 *
 * 되돌리는 법: 이 목록에서 해당 이름을 빼면 수집(collect.mjs)과 랭킹 로더(store.mjs loadRecentItems)가 모두 복귀한다.
 * 소스 파일(sources/dcbest.mjs, theqoo.mjs, instiz.mjs)과 raw_signals 원문은 지우지 않았다.
 *
 * 의존성 없는 별도 파일인 이유: dcbest-galleries.mjs와 같다 — store.mjs가 스크래퍼 모듈을 import하지 않게 하려고.
 */
export const EXCLUDED_SOURCES = ["dcbest", "theqoo", "instiz"];
