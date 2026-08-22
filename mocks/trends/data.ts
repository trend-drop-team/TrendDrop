export type TrendItem = {
  rank: number;
  keyword: string;
  category: string;
  growth: string;
  velocity: string;
  source: string;
  summary: string;
  reason: string;
  /** 직전 집계 순위. null이면 이번 집계에서 처음 진입(NEW). */
  previousRank?: number | null;
  /** 미니 스파크라인용 7포인트(0~100). */
  spark?: number[];
};

export type TimelineStep = {
  step: string;
  title: string;
  body: string;
};

export type WatchItem = {
  keyword: string;
  meta: string;
  score: string;
};

/** 렌더 중 시각 계산은 하이드레이션을 깨뜨리므로 갱신 시각은 고정 문자열로 둔다. */
export const lastUpdatedLabel = "3분 전 갱신";

/** 실시간 집계(기본). `trends`는 하위 호환을 위해 이 배열을 그대로 참조한다. */
export const realtimeTrends: TrendItem[] = [
  {
    rank: 1,
    keyword: "제로슈가 아이스티",
    category: "푸드",
    growth: "+182%",
    velocity: "9.1/10",
    source: "Instagram Reels, Facebook Groups",
    summary:
      "운동 루틴과 다이어트 브이로그에서 반복 노출되며 저장과 공유가 빠르게 늘어나는 중입니다.",
    reason: "짧은 레시피 영상과 체형관리 콘텐츠가 함께 묶이며 확산",
    previousRank: 2,
    spark: [22, 26, 24, 41, 58, 74, 100],
  },
  {
    rank: 2,
    keyword: "1박2일 근교여행",
    category: "여행",
    growth: "+149%",
    velocity: "8.5/10",
    source: "Facebook Travel Pages, Short-form Clips",
    summary:
      "주말 소비를 겨냥한 여행 추천 포스트가 검색과 댓글 반응을 동시에 끌고 있습니다.",
    reason: "휴가 시즌 전환과 함께 예약 전 탐색 수요가 증가",
    previousRank: 1,
    spark: [40, 52, 48, 61, 70, 82, 92],
  },
  {
    rank: 3,
    keyword: "여름 쿨톤 메이크업",
    category: "뷰티",
    growth: "+136%",
    velocity: "8.2/10",
    source: "Instagram Explore, Creator Posts",
    summary:
      "퍼스널 컬러 기반 짧은 튜토리얼이 저장 수와 재방문을 끌어올리고 있습니다.",
    reason: "인플루언서 비교 콘텐츠가 구매 직전 관심층을 자극",
    previousRank: 3,
    spark: [30, 38, 45, 44, 58, 66, 79],
  },
  {
    rank: 4,
    keyword: "생산성 데스크 셋업",
    category: "라이프",
    growth: "+121%",
    velocity: "7.8/10",
    source: "Facebook Video, Community Shares",
    summary:
      "재택근무와 공부 브이로그에서 반복 등장하며 구매 링크 클릭이 이어지고 있습니다.",
    reason: "정리 습관 콘텐츠와 가성비 기기 추천이 결합",
    previousRank: 6,
    spark: [26, 31, 39, 42, 55, 61, 73],
  },
  {
    rank: 5,
    keyword: "러닝 입문 챌린지",
    category: "피트니스",
    growth: "+113%",
    velocity: "7.6/10",
    source: "Instagram Stories, Challenge Feeds",
    summary:
      "초보자 러닝 인증 콘텐츠가 릴레이처럼 이어지며 태그 노출량이 늘어나는 흐름입니다.",
    reason: "공동 참여형 해시태그가 꾸준히 리치 확대",
    previousRank: 4,
    spark: [44, 49, 52, 50, 58, 63, 70],
  },
  {
    rank: 6,
    keyword: "AI 일정관리 템플릿",
    category: "테크",
    growth: "+108%",
    velocity: "7.4/10",
    source: "Creator Pages, Productivity Communities",
    summary:
      "업무 자동화 관련 추천 게시물이 세이브와 북마크를 빠르게 만들고 있습니다.",
    reason: "생산성 툴 관심층과 AI 관심층이 겹치며 점프",
    previousRank: 5,
    spark: [35, 40, 44, 51, 55, 62, 68],
  },
  {
    rank: 7,
    keyword: "린넨 셋업 코디",
    category: "패션",
    growth: "+104%",
    velocity: "7.3/10",
    source: "Instagram Reels, Fashion Creators",
    summary:
      "무더위 출근룩 대안으로 린넨 소재 셋업 착장이 반복 추천되고 있습니다.",
    reason: "체감 더위 상승과 함께 시원한 소재 검색이 동반 증가",
    previousRank: 9,
    spark: [28, 33, 37, 46, 52, 59, 66],
  },
  {
    rank: 8,
    keyword: "두바이 초콜릿",
    category: "푸드",
    growth: "+312%",
    velocity: "9.4/10",
    source: "Short-form Clips, Convenience Store Reviews",
    summary:
      "먹방 클립이 연쇄 확산되며 편의점 재고 인증 게시물까지 함께 늘고 있습니다.",
    reason: "품절 인증과 리뷰가 맞물리며 단기 폭발적 확산",
    previousRank: null,
    spark: [4, 8, 14, 27, 48, 76, 100],
  },
  {
    rank: 9,
    keyword: "물광 선크림",
    category: "뷰티",
    growth: "+96%",
    velocity: "7.1/10",
    source: "Instagram Explore, Beauty Communities",
    summary:
      "자외선 지수 상승과 함께 제형 비교 후기 게시물이 저장 수를 끌어올리고 있습니다.",
    reason: "여름 시즌 진입으로 기초 제품 교체 수요가 확대",
    previousRank: 7,
    spark: [42, 46, 44, 51, 55, 58, 64],
  },
  {
    rank: 10,
    keyword: "캠핑 감성 조명",
    category: "라이프",
    growth: "+92%",
    velocity: "6.9/10",
    source: "Facebook Groups, Outdoor Communities",
    summary:
      "차박·캠핑 셋업 사진에서 조명 제품 문의 댓글이 꾸준히 늘어나는 중입니다.",
    reason: "여름 성수기 캠핑 준비 콘텐츠와 장비 추천이 결합",
    previousRank: 12,
    spark: [30, 34, 38, 43, 47, 54, 60],
  },
  {
    rank: 11,
    keyword: "필라테스 소도구",
    category: "피트니스",
    growth: "+88%",
    velocity: "6.8/10",
    source: "Instagram Reels, Fitness Creators",
    summary:
      "홈 필라테스 루틴 영상에서 링·밴드 사용법 문의가 반복 등장하고 있습니다.",
    reason: "센터 대신 홈트로 전환하는 수요가 장비 검색으로 연결",
    previousRank: 10,
    spark: [38, 41, 45, 44, 49, 53, 58],
  },
  {
    rank: 12,
    keyword: "제주 오름 트레킹",
    category: "여행",
    growth: "+84%",
    velocity: "6.6/10",
    source: "Facebook Travel Pages, Blog Shares",
    summary:
      "휴가 코스 추천 게시물에서 오름 중심 일정이 반복적으로 공유되고 있습니다.",
    reason: "저비용 여행 코스 수요가 국내 자연 콘텐츠로 이동",
    previousRank: 15,
    spark: [24, 28, 33, 39, 44, 50, 57],
  },
  {
    rank: 13,
    keyword: "저속노화 식단",
    category: "푸드",
    growth: "+167%",
    velocity: "8.7/10",
    source: "Health Communities, Creator Posts",
    summary:
      "혈당 관리와 식단 구성 콘텐츠가 중장년층까지 확산되며 저장이 급증했습니다.",
    reason: "건강 관리 키워드가 대중 콘텐츠로 넘어오며 신규 진입",
    previousRank: null,
    spark: [6, 12, 20, 34, 52, 68, 88],
  },
  {
    rank: 14,
    keyword: "노이즈캔슬링 이어폰",
    category: "테크",
    growth: "+79%",
    velocity: "6.4/10",
    source: "Tech Communities, Review Clips",
    summary:
      "가격대별 비교 리뷰가 재확산되며 구매 직전 탐색 반응이 이어지고 있습니다.",
    reason: "신제품 출시 루머와 기존 모델 할인 정보가 동시 유통",
    previousRank: 11,
    spark: [46, 48, 45, 47, 50, 52, 56],
  },
  {
    rank: 15,
    keyword: "스몰 웨딩 준비",
    category: "라이프",
    growth: "+74%",
    velocity: "6.2/10",
    source: "Facebook Groups, Community Shares",
    summary:
      "예산 공개형 후기 게시물이 댓글 질문을 많이 만들어내고 있습니다.",
    reason: "고물가 흐름에서 합리적 예식 수요가 지속 유입",
    previousRank: 14,
    spark: [40, 42, 41, 44, 46, 49, 53],
  },
  {
    rank: 16,
    keyword: "홈트 30일 루틴",
    category: "피트니스",
    growth: "+71%",
    velocity: "6.1/10",
    source: "Instagram Stories, Challenge Feeds",
    summary:
      "월초 챌린지 인증 콘텐츠가 반복되며 참여 태그가 늘어나는 흐름입니다.",
    reason: "휴가 시즌 대비 단기 목표 설정 수요가 증가",
    previousRank: 18,
    spark: [26, 30, 35, 38, 43, 47, 52],
  },
  {
    rank: 17,
    keyword: "여름 원피스 코디",
    category: "패션",
    growth: "+68%",
    velocity: "5.9/10",
    source: "Instagram Explore, Fashion Creators",
    summary:
      "체형별 추천 콘텐츠가 저장 수를 유지하며 꾸준한 관심을 받고 있습니다.",
    reason: "시즌 상품 교체기와 맞물려 탐색량이 유지",
    previousRank: 13,
    spark: [50, 52, 49, 47, 46, 45, 44],
  },
  {
    rank: 18,
    keyword: "편의점 신상 디저트",
    category: "푸드",
    growth: "+64%",
    velocity: "5.8/10",
    source: "Short-form Clips, Convenience Store Reviews",
    summary:
      "신상 리뷰 클립이 주 단위로 갱신되며 반복 소비 패턴을 만들고 있습니다.",
    reason: "주간 신상 출시 주기가 콘텐츠 소비 주기와 일치",
    previousRank: 20,
    spark: [32, 36, 34, 38, 41, 44, 48],
  },
  {
    rank: 19,
    keyword: "미니멀 카드지갑",
    category: "패션",
    growth: "+58%",
    velocity: "5.5/10",
    source: "Creator Pages, Community Shares",
    summary:
      "가벼운 외출 아이템 추천 게시물에서 반복적으로 언급되고 있습니다.",
    reason: "여름철 간소화 소비 흐름과 선물 수요가 겹침",
    previousRank: 16,
    spark: [44, 43, 41, 40, 39, 38, 37],
  },
  {
    rank: 20,
    keyword: "국내 호캉스 특가",
    category: "여행",
    growth: "+52%",
    velocity: "5.2/10",
    source: "Facebook Travel Pages, Deal Communities",
    summary:
      "특가 알림 게시물이 공유되며 예약 전 비교 탐색이 이어지고 있습니다.",
    reason: "성수기 직전 프로모션 정보가 커뮤니티로 빠르게 전파",
    previousRank: 17,
    spark: [48, 46, 44, 42, 41, 39, 36],
  },
];

/** 기존 import 호환용 별칭 — 실시간 집계와 동일한 데이터. */
export const trends: TrendItem[] = realtimeTrends;

const dailyOrder: { keyword: string; previousRank: number | null }[] = [
  { keyword: "두바이 초콜릿", previousRank: 3 },
  { keyword: "저속노화 식단", previousRank: 5 },
  { keyword: "제로슈가 아이스티", previousRank: 1 },
  { keyword: "여름 쿨톤 메이크업", previousRank: 2 },
  { keyword: "1박2일 근교여행", previousRank: 4 },
  { keyword: "린넨 셋업 코디", previousRank: 9 },
  { keyword: "생산성 데스크 셋업", previousRank: 6 },
  { keyword: "물광 선크림", previousRank: 7 },
  { keyword: "AI 일정관리 템플릿", previousRank: 8 },
  { keyword: "러닝 입문 챌린지", previousRank: 10 },
  { keyword: "캠핑 감성 조명", previousRank: 14 },
  { keyword: "제주 오름 트레킹", previousRank: null },
  { keyword: "필라테스 소도구", previousRank: 11 },
  { keyword: "편의점 신상 디저트", previousRank: 17 },
  { keyword: "노이즈캔슬링 이어폰", previousRank: 12 },
  { keyword: "홈트 30일 루틴", previousRank: 19 },
  { keyword: "스몰 웨딩 준비", previousRank: 13 },
  { keyword: "여름 원피스 코디", previousRank: 15 },
  { keyword: "국내 호캉스 특가", previousRank: 16 },
  { keyword: "미니멀 카드지갑", previousRank: 18 },
];

const realtimeByKeyword = new Map(realtimeTrends.map((item) => [item.keyword, item]));

/** 24시간 누적 집계 — 순서와 등락이 실시간과 다르다. */
export const dailyTrends: TrendItem[] = dailyOrder.flatMap((entry, index) => {
  const base = realtimeByKeyword.get(entry.keyword);
  if (!base) return [];
  return [{ ...base, rank: index + 1, previousRank: entry.previousRank }];
});

export const timelineSteps: TimelineStep[] = [
  {
    step: "01",
    title: "짧은 영상에서 먼저 반응이 시작됨",
    body: "반복 재생되는 릴스, 숏클립, 카드뉴스에서 저장 비율이 먼저 튀기 시작합니다.",
  },
  {
    step: "02",
    title: "커뮤니티와 그룹에서 실사용 후기가 붙음",
    body: "SNS 내부 그룹과 댓글에서 실제 후기, 비교, 추천 포인트가 붙으며 검색 의도가 강해집니다.",
  },
  {
    step: "03",
    title: "검색어와 구매 탐색으로 확장됨",
    body: "관심이 행동으로 바뀌는 시점에 TrendDrop이 키워드 상승과 확산 속도를 함께 보여줍니다.",
  },
];

export const watchItems: WatchItem[] = [
  { keyword: "비건 디저트", meta: "푸드 · 댓글 반응 증가", score: "68/100" },
  { keyword: "여름 출근룩", meta: "패션 · 저장률 상승", score: "64/100" },
  { keyword: "혼자 떠나는 부산", meta: "여행 · 공유수 증가", score: "62/100" },
  { keyword: "AI 공부 플래너", meta: "테크 · 북마크 증가", score: "59/100" },
];

export const categories = ["전체", ...new Set(trends.map((trend) => trend.category))];
