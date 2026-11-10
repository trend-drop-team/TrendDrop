/** 제외 목록을 뺀 실행할 어댑터 목록. 순수 함수 — collect.mjs와 테스트가 같이 쓴다. */
export function activeAdapters(adapters, excluded) {
  const skip = new Set(excluded);
  return adapters.filter(([name]) => !skip.has(name));
}
