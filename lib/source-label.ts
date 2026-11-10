/**
 * 파이프라인 소스 id(`xtrends`, `dcbest` …)를 화면에 보일 이름으로.
 * 근거 목록이 내부 id를 그대로 보여 주면 사용자는 어디서 뜬 건지 알 수 없다.
 * 모르는 id는 그대로 돌려준다(새 소스가 생겨도 화면이 깨지지 않게).
 */
const SOURCE_LABELS: Record<string, string> = {
  xtrends: "X 실시간 트렌드",
  gtrends: "구글 급상승 검색어",
  dcbest: "디시 실시간 베스트",
  youtube: "유튜브 인기 영상",
  theqoo: "더쿠",
  instiz: "인스티즈",
  natepann: "네이트판",
  fmkorea: "에펨코리아",
};

export function sourceLabel(source: string): string {
  const key = source.trim().toLowerCase();
  return SOURCE_LABELS[key] ?? source;
}

/** 근거 문장이 키워드를 그대로 반복할 뿐이면(예: "리제 오하" → "리제 오하") 보여 줄 정보가 없다. */
export function isEchoOfKeyword(text: string, keyword: string): boolean {
  const norm = (value: string) => value.replace(/[\s#·.,!?"'“”‘’]/g, "").toLowerCase();
  return norm(text) === norm(keyword);
}
