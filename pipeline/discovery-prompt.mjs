import { createHash } from "node:crypto";

export { SCHEMA, formatLine, buildUserMessage } from "./issue-prompt.mjs";
export const PROMPT_VERSION = "discovery-v1";
export function extractionCacheVersion(models) {
  return `${PROMPT_VERSION}:${createHash("sha256").update(JSON.stringify(models)).digest("hex").slice(0, 8)}`;
}
export const SYSTEM = `한국의 새로운 문화 트렌드를 발견하기 위한 원문 분석이다. 실시간 인기를 추측하지 말고 주어진 각 줄에 실제로 적힌 표현만 분석한다.
출력은 모든 id에 대해 {id, timeliness, keywords:[{name,surface,category,issue}]}다.
timeliness는 now(공개·출시·발표), buzz(소비·반응·패러디·따라하기), evergreen(상시 정보·옛 이야기) 중 하나다.
category는 인물 / 작품·콘텐츠 / 기업·주식 / 사건·사고 / 재난·속보 / 정치·사회 / 스포츠 / 유행어·밈 중 하나다.
주인공 이름을 찾는 작업이 아니다. 사람들이 소비하거나 따라 하고 공유하는 구체적인 표현·콘텐츠·상품·장소의 이름을 찾는다.
우선순위는 밈 문구·유행 표현·별명, 캐릭터·작품·노래·챌린지, 구체적인 음식·상품·장소·스타일이다.
창작자와 작품명이 함께 나오면 작품명을 뽑는다. 정치인·기업·게임·팀 이름으로 서로 다른 화제를 합치지 않는다.
일상적인 정치 발언·주가·경기 결과·팬덤 응원·생일 축하·티켓 자리 문의·광고 문장·감탄·이름 없는 사연은 keywords:[]다.
낯선 표현도 작품·캐릭터·패러디·따라 그리기의 대상이라는 근거가 있으면 보존한다. 모르겠다고 유명한 이름으로 바꾸지 않는다.
X 트렌드는 낯선 합성 표현을 보존하되, 보통명사나 일반 문장이라는 근거만 있으면 비운다. 모른다는 이유만으로 밈이라고 분류하지 않는다.
이름은 원문에 적힌 말 그대로 쓴다. 해시태그 기호·띄어쓰기·대소문자만 정리할 수 있다. surface는 원문 표현을 그대로 복사한다.
캐릭터·작품·노래·게임 내 구체적인 콘텐츠는 작품·콘텐츠다. 작품 공개·순위 소식이라고 재난·속보로 분류하지 않는다.
반복 사용되는 별명·표현은 유행어·밈이다. 음식·상품·브랜드는 기업·주식 분류를 사용할 수 있다.
한 줄에 최대 2개. 서로 다른 실제 대상만 뽑는다. 배경으로 나온 인물·회사·플랫폼 이름은 제외한다.
issue는 원문에 있는 구체적인 상황을 짧게 적고 없으면 null이다. 원문에 없는 유행 이유나 사실을 만들지 않는다.`;
