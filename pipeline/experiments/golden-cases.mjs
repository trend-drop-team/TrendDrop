/**
 * [실험] 이슈 추출 정답 세트 — 프롬프트를 고칠 때마다 이걸로 먼저 채점한다(호출 1회).
 * 전체 창을 다시 뽑으면 Flash 무료 한도(20 RPD)를 금방 쓰기 때문.
 *
 * 각 사례는 실제로 틀렸거나(2026-10-14 실험) 꼭 맞혀야 하는 줄이다.
 *   expect.names  키워드가 정확히 이 목록 (순서 무관)
 *   expect.empty  키워드가 없어야 함
 *   expect.has    이 문자열을 포함한 키워드가 하나 이상 (표기가 여럿 가능할 때)
 *   expect.not    이 이름들은 나오면 안 됨
 *   expect.notHas 이 문자열을 포함한 키워드는 나오면 안 됨
 *   expect.category 키워드 카테고리가 모두 이것
 *   expect.group  같은 group끼리는 키워드가 정확히 같아야 함 (같은 사건이 한 이름으로 모이는지)
 */
const yt = (videoId, title) => ({ site: "youtube", kind: "title", text: title, meta: { videoId } });
export const VIDEOS = [
  yt("devils", "데블스 플랜: 데드 어게인 | 공식 티저 예고편 | 넷플릭스"),
  yt("park", "[슬픈 열대] 메인 예고편 | 박훈정 감독 신작"),
];

const row = (site, text, meta = null, kind = "title") => ({ site, kind, text, meta });
const g = (text, ...news) => row("gtrends", text, { newsTitles: news });
const comment = (videoId, text) => row("youtube", text, { videoId }, "comment");

export const CASES = [
  // ── 주인공 판별 ───────────────────────────────────────────
  { row: row("theqoo", `국민의힘 "李, 인천 칼부림 때 '부캉이' 구경" 맹비난`), expect: { names: ["이재명"] } },
  { row: row("dcbest", "[이갤] 미국 사형 집행 생중계 논란…트럼프도 제동?", { gallery: "이갤" }), expect: { not: ["도널드 트럼프", "트럼프"] } },
  { row: row("dcbest", "[잡갤] 트럼프 보란 듯…北, 美타격권 지도 공개하며 다탄두 ICBM 과시", { gallery: "잡갤" }), expect: { has: "북한", not: ["도널드 트럼프", "트럼프"] } },
  { row: comment("devils", `제목을 "더 지니어스5" 라고 해도 믿음`), expect: { not: ["더 지니어스", "더 지니어스5"] } },
  { row: comment("park", "마녀 깔이다 하고 봤는데 마녀 감독이네 ㅋㅋ"), expect: { not: ["마녀"] } },
  { row: row("dcbest", "[더갤] JTBC) 화장품 대표, 허리띠 풀고 매장 직원들 폭행", { gallery: "더갤" }), expect: { not: ["JTBC"] } },
  { row: row("theqoo", "A2O LITE 'NEON' 멜론 탑백 10위 (🔺10)"), expect: { names: ["A2O LITE"], category: "인물" } },
  { row: yt("nct", "NCT WISH 엔시티 위시 'I SPY' MV"), expect: { names: ["NCT WISH"], category: "인물" } },
  // 차트 성적의 주인공은 그룹. 이수만은 수식어(제작자)
  { row: row("theqoo", "이수만 신인 걸그룹 'A2O LITE' 데뷔곡 멜론 탑백 20위+핫백 3위"), expect: { has: "A2O LITE", not: ["NEON"] } },

  // ── 구글 검색어: 검색어 대상만, 줄이지 않기 ─────────────────
  { row: g("차정원", "하정우·차정원 12월 결혼 발표"), expect: { names: ["차정원"] } },
  { row: g("황인범", "대한축구협회 \"이강인 향한 비난 도 넘었다\"", "황인범, 대표팀 불화설 반박"), expect: { names: ["황인범"] } },
  { row: g("sk 아이젠", "SK 아이젠, 신규 서비스 출시"), expect: { has: "아이젠" } },
  { row: g("gta6 pc", "GTA 6 PC 버전 출시일 공개"), expect: { normHas: "gta6" } },
  { row: g("apple", "애플, 폴더블 아이폰 개발 박차"), expect: { normHas: "apple" } },
  { row: g("ssg", "SSG 랜더스 팬 페스티벌 개최"), expect: { has: "SSG" } },
  { row: g("gs25", "GS25, 블루 아카이브 콜라보 상품 누적 2300만개 돌파"), expect: { names: ["GS25"] } },
  // 검색어를 뉴스 속 다른 대상으로 바꾸면 안 됨 (2026-10-14: tving → 이준혁, 비셀 고베 대 전북 → KBO)
  { row: g("tving", "이준혁 주연 드라마 티빙 공개"), expect: { notHas: "이준혁", normHas: "tving" } },
  { row: g("비셀 고베 대 전북", "전북, 비셀 고베 원정 승리"), expect: { not: ["KBO"] } },
  { row: g("심정지", "탁구대회 중 선수 심정지"), expect: { empty: true } },

  // 직함만 있는 현직자 → 이름 (2026-10-14 "대한민국 대통령"이 top10 5위)
  { row: row("dcbest", "[정갤] 대통령 \"정부가 성공할 거라 믿는다\"", { gallery: "정갤" }), expect: { names: ["이재명"] } },
  { row: row("theqoo", "국무총리, 내일 국회 출석해 답변"), expect: { not: ["국무총리"] } },

  // ── 키워드 없음 ──────────────────────────────────────────
  { row: g("코레일 채용", "코레일, 하반기 신입사원 채용 공고"), expect: { empty: true } },
  { row: g("동아일보 오늘의 운세"), expect: { empty: true } },
  { row: g("건강", "가을철 건강 관리법"), expect: { empty: true } },
  { row: row("dcbest", "[싱갤] 38살 노처녀의 고민..난자냉동을 해야 될까?", { gallery: "싱갤" }), expect: { empty: true } },
  { row: comment("devils", "ㅋㅋㅋ 진짜 웃기네"), expect: { empty: true } },
  { row: comment("devils", "《데블스 플랜: 데드 어게인》, 11월 10일 오직 넷플릭스에서 시청하세요"), expect: { empty: true } },

  // ── 꼭 맞혀야 하는 것 ─────────────────────────────────────
  { row: row("dcbest", "[주갤] 하닉 신고가 찍었다", { gallery: "주갤" }), expect: { names: ["SK하이닉스"] } },
  { row: comment("devils", "갓동민이 다 때려잡고 기강 좀 세워줘라."), expect: { names: ["장동민"] } },
  { row: row("theqoo", "주말 개최되는 nol 페스티벌 대기줄 근황"), expect: { has: "페스티벌" } },
  { row: row("dcbest", "[청갤] 찾아달라” 호소했지만 제주서 4살 딸 숨진 채 발견", { gallery: "청갤" }), expect: { not: ["제주", "제주도"] } },
  { row: row("dcbest", "[군갤] 속보] 울산 온산읍 제조업체 큰불...대응 1단계 발령", { gallery: "군갤" }), expect: { not: ["울산"] } },
  { row: comment("park", "드디어 티저가 나왔네요!!! 분위기 끝내주는 '슬픈열대' 11월이 기다려집니다."), expect: { has: "슬픈" } },

  // ── 익명 사건: 구별되는 이름 (예시와 다른 문장으로 — 외워서 맞히는지 확인) ──
  { row: row("dcbest", "[속보] 만취 운전자, 새벽 대전 도심서 역주행하다 버스와 충돌", { gallery: "속보" }), expect: { not: ["대전"] } },
  { row: row("theqoo", "\"아침밥 안 차려줘서\"…옷걸이 부러지도록 아내 폭행한 70대 남편"), expect: { not: ["아동 학대 사건"] } },
  { row: row("dcbest", "[해갤] 필리핀 여행 간 한국인 일가족 리조트서 실종", { gallery: "해갤" }), expect: { not: ["필리핀"] } },

  // ── 사건 속 인물(제압한 시민, 피해자)을 이름으로 뽑지 않기 ──
  // 같은 사건이 다른 표현으로 갈리는 건 issue-v14부터 검수 단계의 합치기가 맡는다
  { row: row("dcbest", "[사갤] 광주 터미널 방화범 맨손으로 붙잡은 대학생 인터뷰", { gallery: "사갤" }), expect: { notHas: "대학생" } },
  { row: row("theqoo", "광주 터미널 방화로 다친 70대 할머니 끝내 숨져"), expect: { notHas: "할머니" } },
  { row: row("dcbest", "[잡갤] 광주 터미널 방화 피의자 구속영장 신청", { gallery: "잡갤" }), expect: { not: ["광주"] } },
];

/**
 * 이름 없는 사연·묘사는 비워 두고, 적힌 사건 표현은 그대로 (issue-v14부터 "이미 쓰는 이름" 목록 없음).
 * 2026-10-14: 주부 사채 사망 기사에 "한국 중학생" / "남편 명의 도용 빚보증 사건"이 붙었다.
 */
export const LITERAL_CASES = [
  // 사건 속 사람 이야기여도 적힌 "지역+사건" 표현은 뽑는다 (예시와 다른 사건으로)
  { row: row("dcbest", "[잡갤] 대구 방화에 다친 10대 아들 아직 깨어나지 못해", { gallery: "잡갤" }), expect: { has: "대구", notHas: "아들" } },
  { row: row("dcbest", "[해갤] 대구방화범 맨손으로 잡은 대구시민 인터뷰", { gallery: "해갤" }), expect: { has: "대구", notHas: "시민" } },
  { row: row("dcbest", "[잡갤] 시민 3명이 방화범 붙잡아..영상 공개", { gallery: "잡갤" }), expect: { notHas: "시민" } }, // "방화" 같은 일반어는 검수가 뺀다
  { row: row("dcbest", "[속보] “제 고통, 딸에겐 안 가도록” 4천만 빌려 이자만 5천만원 갚은 주부, 스스로 생 마감", { gallery: "속보" }),
    expect: { empty: true } },
  { row: row("theqoo", "부산 서면 흉기난동 용의자 검거"), expect: { has: "부산" } },
  { row: row("dcbest", "[미갤] 한국 중딩이 300년 수학난제 Ai로 풀음ㅋㅋ", { gallery: "미갤" }), expect: { notHas: "중학생" } },
  { row: row("dcbest", "[잡갤] 인천 칼부림 범인 신상 공개", { gallery: "잡갤" }), expect: { has: "인천 칼부림" } },
  { row: row("theqoo", "에이투오 라이트 음방 1위 후보"), expect: { nonEmpty: true } }, // A2O LITE든 에이투오 라이트든 — 합치기가 묶는다
];
