/**
 * [실험] 최종 검수 정답 세트 — REVIEW_SYSTEM을 고칠 때 먼저 이걸로 채점한다(호출 1회). DB 미사용.
 *
 * 실행:  node --env-file=.env.local pipeline/experiments/review-test.mjs [모델 ...]
 *   모델을 안 주면 gemini.mjs의 REVIEW_MODELS 순서대로 시도.
 *   env VOTES(기본 3) — 운영과 같은 과반 투표. VOTES=1이면 한 번 호출의 날것 결과.
 *
 * 후보는 2026-10-14 실제 실행에서 나온 것들. 운영에선 Flash 한도가 자주 막혀 Lite가 검수하는데,
 * Lite는 "이슈 요약이 붙어 있으면 남긴다"를 넓게 적용해 일반어(달리기)를 거의 빼지 않았다.
 */
import { REVIEW_MODELS } from "../gemini.mjs";
import { reviewPool } from "../issues.mjs";

const VOTES = Number(process.env.VOTES ?? 3) || 3;

// [이름, 카테고리, 이슈, 원문]
const POOL = [
  ["A2O LITE", "작품·콘텐츠", "'NEON' 공식 뮤직비디오 공개", "A2O LITE 'NEON' 멜론 탑백 10위 (🔺10)"],
  ["이재명", "인물", "아파트 거래 과세 대상 아님 발표 / 한미동맹 국익 발언 / 인천 칼부림 구경 논란", "[더갤] 이재명 \"한미동맹 중요하지만, 중요한건 국익\""],
  ["인천 흉기난동 사건", "사건·사고", "시민들의 범인 제압", "[해갤] 인천흉기난동범 제압한 인천시민 인터뷰"],
  ["달리기", "스포츠", "마라톤 중 20대 여성 사망", "달리기"],
  ["포켓몬스터", "작품·콘텐츠", "하트골드 강철타입 깨기", "포켓몬스터 하트골드 강철타입만으로 깨기"],
  ["인천 칼부림 사건", "사건·사고", "범인 범죄 이력 공개", "인천 칼부림난동 50대 남자 범죄 이력"],
  ["용산공원", "정치·사회", "개발 반대 국무회의록 존재 논란", "용산공원"],
  ["ASML", "기업·주식", "AI 실적 전망 분석 보도", "asml"],
  ["안지만", "인물", "지인 사기 혐의 징역 1년 8개월 선고", "안지만"],
  ["NCT WISH", "작품·콘텐츠", "'I SPY' 뮤직비디오 공개", "NCT WISH 엔시티 위시 'I SPY' MV"],
  ["심정지", "사건·사고", "탁구대회 중 선수 심정지", "심정지"],
  ["이수만", "인물", "신인 걸그룹 A2O LITE 제작", "이수만 신인 걸그룹 'A2O LITE' 데뷔곡 멜론 탑백 20위"],
  ["반도체", "기업·주식", "수출 호조", "[주갤] 반도체 다시 간다"],
  ["데블스 플랜: 데드 어게인", "작품·콘텐츠", "티저 예고편 공개", "데블스 플랜: 데드 어게인 | 공식 티저 예고편 | 넷플릭스"],
  ["Apple", "기업·주식", "폴더블 아이폰 개발", "apple"],
  ["애플", "기업·주식", "아이폰 신제품 발표", "[미갤] 애플 실적 발표 앞두고"],
  ["건설업", "기업·주식", null, "[잡갤] 건설업 요즘 어떠냐"],
  ["와일드카드 결정전", "스포츠", "1차전 라인업 발표", "[두갤] 와일드카드 결정전 1차전 라인업"],
  ["두산 베어스", "스포츠", "와일드카드 결정전 1차전", "[두갤] 오늘 선발 누구냐"],
  ["GS25", "기업·주식", "블루 아카이브 콜라보 누적 판매량", "gs25"],
  ["NEON", "작품·콘텐츠", "멜론 탑백 진입", "NEON 듣고 왔는데 중독성 미쳤다"],
  ["김세의", "인물", "김수현 관련 허위 주장 법적 대응", "김세의"],
  ["예고편", "작품·콘텐츠", null, "예고편 보고 소름"],
  ["전동킥보드 하천 추락 사고", "사건·사고", "무면허 중학생 킥보드에 60대 여성 추락", "킥보드"],
  ["새마을금고", "기업·주식", "금융권 해킹 확산", "[잡갤] sbs) 새마을금고•ok저축은행도...금융권 해킹 확산"],
  // 2026-10-14 run #1377 9위 — 디시 글 9개가 서로 다른 중국 이야기
  ["중국", "정치·사회", "교수 마약 제조 사건 / 관광객 무비자 입국 확대 / 희토류 수출 통제 / 짝퉁 명품 단속", "[중갤] 중국 교수가 마약 만들다 걸림"],
  ["에이투오 라이트", "인물", "음방 1위 후보", "에이투오 라이트 음방 1위 후보"],
  ["인천 칼부림", "사건·사고", "범인 신상 공개 / 50대 남자 범죄 이력", "[잡갤] 인천 칼부림 범인 신상 공개"],
  ["북한", "정치·사회", "다탄두 ICBM 과시 / 미 타격권 지도 공개", "[잡갤] 트럼프 보란 듯…北, 美타격권 지도 공개하며 다탄두 ICBM 과시"],
  ["미국", "정치·사회", "롤러코스터 공중 정지 사망 / 사형 집행 생중계 논란 / 셧다운 장기화", "[조갤] 공중에 멈춘 롤러코스터‥미국서 탑승객 숨져"],
];

const MUST_DROP = ["달리기", "심정지", "반도체", "건설업", "예고편", "중국", "미국"];
// [묶여야 하는 이름들] — into는 그 중 아무거나 허용
const MUST_MERGE = [["인천 흉기난동 사건", "인천 칼부림 사건"], ["인천 칼부림", "인천 흉기난동 사건"], ["Apple", "애플"], ["에이투오 라이트", "A2O LITE"]];
// 관계만 있는 별개 대상 — 묶이면 안 된다
const MUST_NOT_MERGE = [["이수만", "A2O LITE"], ["NEON", "A2O LITE"], ["와일드카드 결정전", "두산 베어스"]];

const pool = POOL.map(([term, , , sample], i) => ({ term, score: 200 - i * 6, sample }));
const meta = new Map(POOL.map(([n, category, issue]) => [n, { category, issues: issue ? issue.split(" / ") : [], texts: issue ? issue.split(" / ").length : 1 }]));
const info = (n) => meta.get(n);

async function run(models) {
  const t = Date.now();
  const { drop, merge, model, votes } = await reviewPool(pool, info, { votes: VOTES, models });
  const dropped = new Set(drop.keys());
  const groupOf = new Map();
  for (const [from, into] of merge) { groupOf.set(from, into); groupOf.set(into, into); }
  const same = (a, b) => groupOf.has(a) && groupOf.get(a) === groupOf.get(b);

  const fails = [];
  for (const n of MUST_DROP) if (!dropped.has(n)) fails.push(`안 뺌: ${n}`);
  const keep = POOL.map(([n]) => n).filter((n) => !MUST_DROP.includes(n));
  for (const n of keep) if (dropped.has(n)) fails.push(`잘못 뺌: ${n} (${drop.get(n)})`);
  for (const [a, b] of MUST_MERGE) if (!same(a, b)) fails.push(`안 묶음: ${a} / ${b}`);
  for (const [a, b] of MUST_NOT_MERGE) if (same(a, b)) fails.push(`잘못 묶음: ${a} / ${b}`);
  const total = MUST_DROP.length + keep.length + MUST_MERGE.length + MUST_NOT_MERGE.length;
  console.log(`\n${model} 응답 ${votes} (${((Date.now() - t) / 1000).toFixed(0)}초): ${total - fails.length}/${total} 통과`);
  for (const f of fails) console.log(`  ✗ ${f}`);
}

const args = process.argv.slice(2);
if (args.length === 0) await run(REVIEW_MODELS);
for (const m of args) {
  try {
    await run([m]);
  } catch (err) {
    console.log(`\n${m}: 호출 실패 — ${String(err.message).slice(0, 100)}`);
  }
}
