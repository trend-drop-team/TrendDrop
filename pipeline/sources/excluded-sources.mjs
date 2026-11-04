/**
 * 수집·랭킹에서 제외하는 소스 목록 (2026-10-21).
 * 서비스 목적(유행어·장소·화제의 콘텐츠)에 맞춰 소스를 줄인다는 결정으로 더쿠·인스티즈를 뺀다.
 *
 * 되돌리는 법: 이 목록에서 해당 이름을 빼면 수집(collect.mjs)과 랭킹 로더(store.mjs loadRecentItems)가 모두 복귀한다.
 * 소스 파일(sources/theqoo.mjs, instiz.mjs)과 raw_signals 원문은 지우지 않았다.
 *
 * 의존성 없는 별도 파일인 이유: dcbest-galleries.mjs와 같다 — store.mjs가 스크래퍼 모듈을 import하지 않게 하려고.
 */
export const EXCLUDED_SOURCES = ["theqoo", "instiz"];
