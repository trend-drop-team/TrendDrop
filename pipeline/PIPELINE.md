# 데이터 수집 파이프라인 (pipeline/)

커뮤니티·유튜브·구글트렌드에서 매시간 원문을 긁어와, **"지금 많이 언급되는 키워드" top10**을 만들어 Postgres에 쌓는다. 원래는 "평소 대비 갑자기 늘어난 단어"를 뽑는 급상승(rising) 방식이었으나 **인기(popular) 방식으로 전환**했다. 예전 폴더 이름 `trend-rising/`이 그때의 잔재였고, 이번에 `pipeline/`으로 정리했다.

**2026-10-14 키워드 뽑는 방식을 바꿨다.** 예전엔 글을 단어로 쪼개(`tokenize.mjs`) 세고 LLM이 단어를 판정했는데(`verdict.mjs`), 이름이 쪼개졌다(`A2O`/`LITE`, `데블스`/`플랜`/`데드`). 지금은 **LLM이 글 한 줄마다 적힌 이름을 뽑고(추출), 코드가 점수를 매기고, LLM이 상위 후보를 한 번 더 검수(같은 뜻 합치기·일반어 빼기)**한다 — 2·4장. 출력은 **키워드만**이다(요약 등은 저장하지 않는다).

**스키마는 `db/schema.ts`가 소유한다.** 이 파이프라인은 테이블을 스스로 만들지 않고(`store.mjs`가 DDL을 안 함), 이미 존재하는 스키마에 데이터만 넣는다. DB는 **Neon**(클라우드 Postgres)이고, 스키마 반영은 **drizzle-kit**이 한다 — 구성과 절차는 8장.

---

## 0. 전체 흐름

**수집과 랭킹은 이제 서로 다른 주기로 따로 돈다.** GitHub Actions 워크플로가 각각 하나씩이다.
**두 워크플로의 시계는 GitHub 밖(cron-job.org)에 있다** — 이유는 8-3.

```
collect.yml — 매시 :05  (cron-job.org → workflow_dispatch)
    │
    └─▶ collect.mjs ─────────────────────────────────────────
          collection_runs 1행 생성 (pipeline='collect')
          5개 소스 병렬 스크래핑
          raw_signals에 N행 INSERT (run_id = 방금 만든 run)
          collection_runs 그 행 UPDATE (status/raw_signal_count)

rank.yml — 매시 :20  (cron-job.org → workflow_dispatch)
    │
    └─▶ rank-popular.mjs --save ─────────────────────────────
          최근 6시간 raw_signals 읽기 (SELECT만)
          issues.mjs:
            1. 추출  text_extractions에 없는 글만 LLM(Lite)에 50줄씩 → 글마다 적힌 이름
                     코드가 "정말 글에 적힌 이름인가" 검증 → text_extractions에 저장
            2. 표기  대소문자·띄어쓰기만 다른 이름을 하나로 (코드, LLM 아님)
               점수  popular.mjs: 소스별 가중치 × 참여도 보정 × 시의성 → 후보 60개
            3. 검수  후보 60개를 LLM에 3번 동시에 → 과반이 같은 판단만 적용
                     (같은 뜻 합치기 → keyword_aliases에 저장 / 일반어 빼기)
            4. 다시 점수 → top10
          store.mjs:
            collection_runs 1행 생성 (pipeline='popular')
            keywords UPSERT (신규 term만 승격)
            trend_snapshots에 top10 INSERT (run_id = 방금 만든 run, keyword_id로 연결)
            collection_runs 그 행 UPDATE (status/keyword_count/api_call_log)
```

**둘을 나눈 이유.** LLM(Gemini) 호출은 `rank`(→`issues.mjs`)에만 있고 `collect`은 LLM을 쓰지 않는다. 그런데 **`collect`을 늦추면 되돌릴 수 없다** — 버킷이 1시간 단위라 거른 시간대의 글은 이미 사라져 복구가 안 되고, 체류시간 신호(1장)가 절반 해상도로 뭉개진다. 반대로 `rank`는 원문만 있으면 언제든 다시 계산된다. 

`rank`는 예전에 비용 때문에 2시간 주기였다. 2026-10-14 Gemini 무료 등급 + 추출 캐시로 바꾸면서 매시간으로 당겼다(서비스 목표가 "한 시간에 한 번 지금 제일 인기 있는 검색어"). 호출량은 4장 "모델과 무료 한도".

**시각을 :05와 :20으로 어긋나게 뒀다.** 같은 시각이면 `rank`가 `collect`이 아직 쓰는 중인 버킷을 읽어 반쪽짜리 집계가 나온다.

**수집과 랭킹이 분리된 게 핵심이다.** 원문이 DB에 남아 있으므로 점수 공식을 바꿔도 다시 계산할 수 있다. LLM 추출 결과도 같은 이유로 글 단위 캐시(`text_extractions`)에 저장한다 — 비싼 건 한 번, 싼 건 언제든.

그래서 **`collection_runs`에 이 파이프라인이 남기는 run은 두 종류**다 — `pipeline` 컬럼으로 구분되고, 서로 다른 하위 테이블을 소유한다:

| pipeline 값 | 만드는 곳                                 | 빈도         | 소유하는 것                      |
| ----------- | ----------------------------------------- | ------------ | -------------------------------- |
| `collect`   | `collect.mjs`                             | 매시간 1건   | 그 실행에서 저장된 `raw_signals` |
| `popular`   | `rank-popular.mjs`                        | 랭킹마다 1건 | 그 실행의 `trend_snapshots`      |

### 키워드 하나가 top10에 오르기까지 (2026-10-14 실제 예)

```
① 수집 (collect, 매시 :05)        raw_signals에 글 원문이 쌓인다
   theqoo  "인천 칼부림난동 50대 남자 범죄 이력"
   dcbest  "[잡갤] 인천 흉기난동에 20대 딸 아직 의식 못 찾아"
   instiz  "인천 칼부림 ㄷㄷ 시민들 대단하다"
   theqoo  "4천만 빌려 이자만 5천만원 갚은 주부, 스스로 생 마감"

② 추출 (LLM Lite, 글마다)          적힌 이름만. 없으면 비움
   → 인천 칼부림 / 인천 흉기난동 / 인천 칼부림 / (없음 — 적힌 고유한 이름이 없음)

③ 코드 검증                        이름이 정말 원문에 적혀 있나? (지어낸 이름은 버림)

④ 표기 통일 (코드)                 "기아타이거즈" / "기아 타이거즈" 같은 띄어쓰기·대소문자 차이를 합침

⑤ 점수                             글마다 소스 가중치(더쿠·디시·인스티즈 4점, 구글 20점…) × 시의성,
                                   여러 소스에 나오면 ×1.6 → 이름별 합계, 상위 60개

⑥ 검수 (LLM, 3번 물어 과반)        "인천 칼부림" = "인천 흉기난동" → 합침 (이름 사전에 저장)
                                   "달리기", "우선주" → 일반어라 뺌

⑦ 다시 점수 → top10                인천 흉기난동 (글 12개, 소스 3곳) 77점 → 3위
```

---

## 1. 수집 — `collect.mjs`

5개 소스를 `Promise.all`로 동시에 긁는다. 한 소스가 실패해도 나머지는 그대로 저장된다.

| 소스      | 대상                                                | 방식          | 저장 단위(unit) |
| --------- | --------------------------------------------------- | ------------- | --------------- |
| `dcbest`  | 디시인사이드 실시간 베스트                          | HTML 스크래핑 | title           |
| `theqoo`  | 더쿠 핫게시판                                       | HTML 스크래핑 | title           |
| `instiz`  | 인스티즈 실시간 인기                                | HTML 스크래핑 | title           |
| `youtube` | 인기 급상승 영상 20개 + 상위 8개 영상의 댓글 15개씩 | 공식 Data API | title + comment |
| `gtrends` | 구글 트렌드 한국 급등검색어 20개                    | 공식 RSS      | title           |

> **네이트판은 2026-08-03에 제외했다.** 사연·신변잡기 위주라 트렌드 키워드가 거의 안 나왔다.

### 디시 뉴스 갤러리 제외 (2026-10-20)

디시 실베 글의 25%가 뉴스 전재 갤러리 글이라 구글 급상승과 내용이 겹친다. 최근 2주 글 10개 이상인 갤러리 중 제목에 언론 표기("JTBC)", "[단독]", "속보)")나 기사식 말줄임("…")이 붙은 비율로 골랐다:

| 갤러리 | 언론 표기 | 말줄임 |
| ------ | --------: | -----: |
| 더갤   | 61%       | 33%    |
| 중갤   | 37%       | 42%    |
| 잡갤   | 16%       | 53%    |
| 새갤   | 31%       | 44%    |
| 국갤   | 40%       | 40%    |
| 군갤   | 27%       | 27%    |

해갤(7%/44%)은 스포츠 기사라 경계선이지만 남긴다. 목록은 `sources/dcbest-galleries.mjs`의 `EXCLUDED_GALLERIES` 한 곳에 있다(의존성 없는 상수 파일 — store.mjs가 스크래퍼를 import하지 않게). **수집 단계(`parse`)에서 건너뛰고, 랭킹 로더(`store.mjs` `loadRecentItems`)에서도 거른다.** raw_signals는 지우지 않으므로 수집 제외 전에 쌓인 과거 글은 순위에서만 빠지고, 목록을 바꾸면 되돌릴 수 있다.

### 이 단계에서 DB에 쓰는 것

```
collection_runs  1행  (pipeline='collect', geo='KR', bucket_at=이번 정시)
raw_signals      N행  (run_id = 위 run, source_id/source/text/text_hash/video_id/meta/bucket_at/captured_at)
sources          최초 1회만 5행 시드 (dcbest/theqoo/instiz/youtube/gtrends)
```

수집한 행은 **1시간 버킷**(정시로 내림)으로 묶인다. `UNIQUE(source_id, text_hash, bucket_at)`이라 같은 시간대·같은 소스의 같은 글은 무시되지만, **디시 실베에 3시간 머문 글은 3개 버킷에 3번 저장**된다 — 체류시간이 자연스럽게 점수에 반영되는 구조.

`meta`(jsonb)에 소스별 부가정보가 들어간다:

- `youtube|title` → `videoId`, `publishedAt`, `viewCount`, `likeCount`, `commentCount`
- `youtube|comment` → `videoId`, `likeCount`
- `gtrends|title` → `rank`, `approxTraffic`("1000+" 형태), `newsTitles`
- `dcbest|title` → `gallery`(출처 갤러리명)

실제 예:

```
collection_runs  id=57  pipeline='collect'  bucket_at='21:00'  raw_signal_count=199
raw_signals      id=5650  run_id=57  source_id=5(gtrends)  source='title'  text='lg그룹'  bucket_at='21:00'
```

---

## 2. 키워드 추출 — `issues.mjs` · `issue-prompt.mjs`

글 한 줄을 LLM에 보여주고 **그 줄에 적힌 대상의 이름**을 뽑는다. 이름을 새로 짓지 않고, 적힌 이름이 없으면 비운다(창 안 글의 절반쯤이 빈다 — 댓글 감탄, 잡담, 이름 없는 사연).

```
[3] 구글검색어 | 관련뉴스: 전직 삼성 투수 안지만, 사기 혐의 실형 | 안지만      → 안지만
[7] 더쿠 | A2O LITE 'NEON' 멜론 탑백 10위                                  → A2O LITE
[9] 디시 주갤 | 하닉 신고가 찍었다                                          → SK하이닉스 (줄임말 펼치기)
[12] 더쿠 | 4천만 빌려 이자만 5천만원 갚은 주부, 스스로 생 마감               → (없음)
```

**받는 것** (`responseSchema`로 형식 강제): 줄마다 `{ id, timeliness, keywords: [{ name, surface, category, issue }] }`

| 필드 | 내용 |
| ---- | ---- |
| `name` | 키워드 이름. 줄임말·한자 약칭(`李`→이재명)·직함(현직자 표 `OFFICE_HOLDERS`)·대소문자만 고쳐 쓸 수 있다 |
| `surface` | 근거가 된 원문 표현 그대로 — 코드 검증용 |
| `category` | 인물/작품·콘텐츠/기업·주식/사건·사고/재난·속보/정치·사회/스포츠/유행어·밈 (그룹·팀은 인물) |
| `issue` | 그 대상에게 무슨 일이 있는지 15자 안팎. **검수 판단 근거로만 쓰고 저장하지 않는다** |
| `timeliness` | `now`(지금 일어난 일)/`buzz`(화제 콘텐츠·반응)/`evergreen`(언제 올라와도 될 글) → 점수 배율 1.0/0.7/0.3 |

**코드 검증 (`isWritten`)** — 모델이 이름을 지어내거나 다른 대상으로 바꾸면 버린다. 실제로 있었던 일: 주부 사망 기사 → `남편 명의 도용 빚보증 사건`, 검색어 `tving` → `이준혁`, `비셀 고베 대 전북` → `KBO`.
- 구글 검색어: 이름과 검색어가 (대소문자·공백 무시) 한쪽이 다른 쪽을 포함해야 한다
- 그 밖: `surface`가 원문에 있어야 하고, 이름이 원문에 그대로 있거나 / `surface`를 포함하거나 / `surface`가 3글자 이하 줄임말(펼친 이름은 두 단어 이하, 사건·사고로 끝나지 않음)이거나 / 한글↔영문 표기 차이이거나 / `surface`에 직함이 있고 이름이 그 현직자(`이 대통령` → 이재명)여야 한다
- 카테고리 이름 자체(`사건·사고`)와 직함만 있는 이름(`국무총리`)도 버린다. `대통령`은 현직자 이름으로 바꾼다

**캐시** — 결과는 `text_extractions`에 `text_hash` 단위로 저장한다. 글의 뜻은 안 바뀌고, 창(6시간)이 1시간씩 밀리면 새 글은 매시간 ~35~70개뿐이라 **추출 호출은 매시간 1~2회**다. `PROMPT_VERSION`을 올리면 그 버전으로 뽑은 결과만 유효해서 창 안 글(~330개)을 다음 실행이 새로 뽑는다(7회).

**프롬프트를 고칠 때** — 먼저 정답 세트로 채점한다(호출 1회, DB 미사용):

```bash
node --env-file=.env.local pipeline/experiments/golden-test.mjs          # 추출 (47문항)
node --env-file=.env.local pipeline/experiments/review-test.mjs          # 검수 (37문항, 과반 투표)
node --env-file=.env.local pipeline/experiments/golden-test.mjs gemini-3.7-flash   # 모델 지정
```

Lite는 같은 입력에도 실행마다 답이 조금씩 달라서 정답 세트를 한 번 돌리면 0~2문항이 틀린다(틀리는 문항이 매번 다름). 3번쯤 돌려 보고 판단한다.

**프롬프트 버전 기록 (2026-10-14)**

| 버전 | 고친 것 | 계기 |
|---|---|---|
| v1~v8 | 매체 제외, 주인공 고르기, 비교·배경 이름 제외, 구글 검색어는 검색어 대상만 | 실험 단계 (`JTBC`, `李` → 국민의힘, `차정원` → 하정우 등) |
| v9~v13 | 사건 속 인물 이름 금지, 빈말 요약 금지, 그룹=인물, 현직 직함 → 이름 | 첫 운영 실행들 (`인천 흉기난동 제압 시민`, `대한민국 대통령`) |
| **v14** | **적힌 이름만 뽑고 없으면 비움. "이미 쓰는 이름" 목록 제거. `surface` + 코드 검증** | 이름을 지어내다 엉뚱한 글끼리 합쳐짐 (`한국 중학생`, `KBO`) |
| v15 | 사건 속 사람 이야기여도 적힌 "지역+사건" 표현은 뽑음 | v14가 `인천 흉기난동에 20대 딸…`을 비움 |

---

## 3. 랭킹 계산 — `popular.mjs`

메모리에서만 계산되는 단계(DB에 안 씀). 입력: `raw_signals` 행들 + 2장 추출 결과(`termsOf`). 출력: `ranked[]` 배열(term·score·velocity 등).

### 창(window)

기본 **최근 6시간**. **버킷 개수가 아니라 시계 기준**이다 — 수집이 빠진 시간대가 있어도 과거로 더 뻗지 않고 표본만 줄어든다. 기준점은 `now()`가 아니라 `max(bucket_at)`.

### 점수 공식

```
score = Σ (소스별 가중치 × 참여도 보정 × 시의성 배율 × 카테고리 계수)  ×  교차 소스 보너스
```

**소스별 기본 가중치**:

| source\|unit                                        | 가중치 |
| --------------------------------------------------- | -----: |
| `gtrends\|title`                                    |      8 |
| `youtube\|title`                                    |      6 |
| `dcbest\|title` / `theqoo\|title` / `instiz\|title` |      4 |
| `youtube\|comment`                                  |    1.5 |

**참여도 보정** — `meta`가 있을 때만 곱해지고 없으면 ×1:

| 대상               | 공식                             | 범위      |
| ------------------ | -------------------------------- | --------- |
| `gtrends`          | 검색량 기준(500+를 ×1.0)         | ×0.7~×1.8 |
| `youtube\|title`   | 시간당 조회수 + 좋아요           | ×1~×3.5   |
| `youtube\|comment` | 댓글 좋아요 × 그 영상의 확산속도 | ×1~×7     |
| 커뮤니티 3곳       | 조회수·추천수 미수집             | 항상 ×1   |

**유튜브를 절반으로 낮춘 이유 (2026-10-14)** — 옛 방식에선 상위 20 점수의 71%가 유튜브였다(급상승 영상 20개가 몇 시간씩 머묾). 구글을 30~40으로 올려 보기도 했는데 커뮤니티 언급 없는 검색어가 상위를 채워서 구글은 20 그대로 두고 교차 보너스를 키웠다.

**항목당 1회 모델로 바꾸고 구글을 8로 내린 이유 (2026-10-20)** — 그 전엔 매시간 재수집된 같은 글·영상·검색어를 매번 세서, 몇 시간씩 목록에 머무는 구글·유튜브가 머문 만큼 쌓였다(유튜브만 영상당 1회라 반대로 전부 탈락). 최근 24시간 7개 시간대를 캐시된 추출 결과로 재계산한 top10 점수의 소스 비중:

| 모델                                   | 구글 | 디시 | 더쿠 | 유튜브 |
| -------------------------------------- | ---: | ---: | ---: | -----: |
| 시간대마다 다시 셈, 유튜브만 영상당 1회 | 71%  | 23%  | 6%   | 0%     |
| 시간대마다 다시 셈, 유튜브도 시간대별   | 17%  | 7%   | 1%   | 75%    |
| 항목당 1회, 구글 20                     | 90%  | 7%   | 2%   | 1%     |
| **항목당 1회, 구글 8 (현재)**           | 58%  | 26%  | 10%  | 5%     |
| 항목당 1회, 구글 6 · 유튜브 4           | 44%  | 33%  | 18%  | 3%     |

가중치를 어떻게 바꿔도 카테고리 분포(인물·기업·스포츠가 2/3)는 거의 안 움직였다 — 소스 내용 자체가 뉴스라서. 유튜브는 이 모델에서 영상 하나가 언급 1회라 최소 언급 2회에 걸려 작다(다음 과제).

**디시 뉴스 갤러리를 뺀 뒤 (2026-10-20)** — 뉴스 갤러리를 빼고 최근 24시간 7개 시간대를 재계산하면 top10 점수 비중이 구글 58→69%, 디시 26→11%, 더쿠 10→12%, 유튜브 5%로 바뀌고, 빠진 이재명·역삼동 화재 자리를 구글 검색어 단독 항목이 채운다. 카테고리(인물·기업·스포츠)는 그대로라 카테고리 계수와 같이 가야 한다.

**시의성 배율** — 추출이 고른 `timeliness`: now ×1.0 / buzz ×0.7 / evergreen ×0.3. AI는 단계만 고르고 숫자는 코드(`issues.mjs` `TIMELINESS_MULT`)에 있다. "요즘 뜨는지"를 직접 묻지 않는 건 모델이 실시간 인기를 모르기 때문이다.

**카테고리 계수** (2026-10-20, B안) — 서비스 목적(유행어·장소·화제의 콘텐츠)에 맞게 키워드의 카테고리로 기울인다. 숫자는 코드(`issues.mjs` `CATEGORY_MULT`)에 있고, 글이 아니라 키워드 단위로 곱하고, 같은 이름에 글마다 다른 카테고리가 붙었으면 창 안에서 가장 많이 붙은 **대표 카테고리** 하나로 곱한다(Lite가 두쫀쿠를 유행어·밈 / 기업·주식으로 갈라 붙이는 일이 있어서, 글마다 곱하면 추출 흔들림이 순위에 들어간다).

| 카테고리 | 계수 |
| --- | ---: |
| 유행어·밈 | 2.0 |
| 작품·콘텐츠 | 1.5 |
| 사건·사고 / 재난·속보 | 1.0 |
| 인물 | 0.8 |
| 기업·주식 / 스포츠 | 0.6 |
| 정치·사회 | 0.5 |

최근 24시간 7개 시간대 top10 누적 카테고리 수: 전부 ×1은 인물 25·기업 21·스포츠 12·작품 3·사건 3 → B안은 인물 29·작품 20·기업 9·사건 8·스포츠 2. 더 강한 안(유행어 3 / 작품 2 / 인물 0.6 / 기업 0.4 / 스포츠 0.4 / 정치 0.3)은 하위권 점수가 5~7점으로 떨어져 구글 검색어 단독(글 1개) 항목이 채워서 보류했다. 인물에는 정치인뿐 아니라 아이돌·방송인·판다가 다 들어가서 약하게(0.8)만 깎는다. 유행어·밈은 추출이 하루 3건이라 지금은 효과가 없다(재료 부족). 카테고리는 `text_extractions`에 이미 있어 숫자만 바꾸면 API 재호출 없이 반영된다.

**교차 소스 보너스** — 2개 이상 소스에 등장하면 ×1.6("여러 곳에서 동시에 말하는 것"이 위로). **최소 언급 필터** — 2회 이상 언급 또는 gtrends 등장.

### `velocity` — 참여도 보정의 평균 (0.5~10)

키워드 누적 시 이 보정값(`boost`)을 term별로 같이 쌓아서 평균낸다:

```js
entry.boostSum += boost;
entry.boostCount += 1;
// ...
velocity: clamp(entry.boostSum / entry.boostCount, 0.5, 10);
```

커뮤니티만 언급되면 보정이 없어 1점대, 조회수·좋아요·검색량이 높으면 3~5점대 이상으로 나온다. 이 값이 나중에 `trend_snapshots.velocity`로 저장된다.

### 표기 통일 — `casingFixes` (점수 매기기 전, LLM 아님)

창 안의 이름을 소문자·공백 제거 기준으로 묶어서, 표기만 다른 것을 하나로 모은다. 결과는 이름 사전(`keyword_aliases`)에 들어간다.

- 어느 표기로 모을지: ① 대문자가 섞인 표기 ② 더 많이 나온 표기 ③ 띄어 쓴 표기 순
  (`기아타이거즈` / `기아 타이거즈` → 기아 타이거즈, `nct wish` / `NCT WISH` → NCT WISH)
- 고른 표기가 전부 소문자 영문이면(구글 검색어가 친 그대로 들어온 경우) 다듬는다:
  - 숫자가 섞였거나 한 단어 4글자 이하 → 약어로 보고 대문자 (`gs25` → GS25, `asml` → ASML, `kbo` → KBO)
  - 그 밖 → 단어 첫 글자만 대문자, `vs`·`of` 같은 짧은 말은 그대로 (`pakistan vs sri lanka` → Pakistan vs Sri Lanka)

프롬프트로도 공식 표기를 요구하지만 Lite가 가끔 놓쳐서 코드로 한 번 더 맞춘다.

### 후보 풀 — 왜 60개인가

최종은 top10이지만 **후보 60개**를 검수에 올린다. 같은 대상이 글마다 다른 말로 적혀 있으면(`인천 칼부림` / `인천 흉기난동`) 각각은 점수가 낮아 25위 밖일 수 있어서, 넓게 올려 합칠 기회를 준다.

### 중복 제거

세 겹이다.

- **글 단위** — 같은 글(`site|kind|video_id|text_hash`)이 창 안 여러 시간대에 있으면 가장 최신 행 하나만 센다(조회수·검색량 meta가 가장 새것이라서). 소스를 키에 넣는 이유: `text_hash`는 글자만으로 만든 해시라 구글 검색어 "X"와 디시 제목 "X"가 같은 값이다.
- **행 안** — 같은 행 안 같은 키워드는 1회(`new Set(termsOf(row))`).
- **영상 단위** — 유튜브는 같은 영상의 제목·댓글이 같은 키워드를 내도 1회. 댓글 15개가 같은 단어를 반복해 부풀리는 걸 막는다.

최신 행을 남기므로 `recentMentions`는 "지난 1시간에도 아직 목록에 있는 항목 수"가 된다(`risingScore`에만 쓰이고 순위에는 안 쓴다).

---

## 4. 검수와 모델 — `issues.mjs` · `gemini.mjs`

### 검수 — 같은 뜻 합치기 · 일반어 빼기

3장 후보 60개를 LLM에 보여준다. 후보마다 카테고리, 점수, 그 이름으로 묶인 글들의 이슈(최대 4개), 대표 원문이 붙는다.

- **merge** — 같은 대상을 다르게 적은 것끼리 묶는다(`인천 칼부림` / `인천 흉기난동`, `tving` / `티빙`, `Apple` / `애플`). 관계만 있는 다른 대상(사람과 소속 그룹, 회사와 상품)은 안 묶는다. **묶은 결과는 `keyword_aliases`에 쌓여** 다음 실행부터 바로 적용된다.
- **drop** — 일반어·범주어(`달리기`, `우선주`, `가을야구`), 서로 무관한 사건이 섞인 국가·지역 이름(`중국` 아래 마약 제조·무비자 입국·희토류가 섞임). 사람·그룹·기업은 이슈가 여러 개여도 안 뺀다. **drop은 저장하지 않는다**(맥락 의존이라 매시간 새로 판단).
- 적용 뒤 이름을 합쳐 **점수를 다시 매기고** top10을 뽑는다.

**3번 동시에 묻고 과반만 적용한다** (`REVIEW_VOTES`). Lite는 같은 입력에도 실행마다 판단이 흔들렸다(같은 창에서 제거 0건 / 3건, 한 번만 물으면 멀쩡한 `용산공원`·`안지만`을 가끔 뺌). 3번 중 2번 이상 같은 판단만 적용하면 우연한 실수는 걸러진다. 대신 경계선 단어(`패밀리 카` 같은 일반명사 검색어)는 실행마다 빠졌다 남았다 한다.

### 모델과 무료 한도

Google AI Studio `trenddrop` 프로젝트, **무료 등급**. SDK 없이 `fetch`로 `generateContent`를 부른다(`gemini.mjs`, 의존성 추가 없음).

| 모델 | 무료 한도 (AI Studio 실측) | 쓰는 곳 |
| ---- | -------------------------- | ------- |
| `gemini-3.8-flash` / `3.7-flash` / `3.6-flash` | 각 5 RPM · **20 RPD** | 검수 (앞에서부터 시도) |
| `gemini-3.5-flash-lite` / `3.1-flash-lite` | 각 15 RPM · **500 RPD** | 추출, 검수 예비 |

- **매시간 호출량**: 추출 1~2회 + 검수 3회 → 하루 ~100회. Flash 한도(각 20)는 오후쯤 다 써서 검수도 Lite로 넘어간다. Lite 500회 안이다.
- 모델 바꾸기: `EXTRACT_MODELS` / `REVIEW_MODELS` 환경변수(쉼표 구분, 앞에서부터 시도).
- 앞 모델이 503(과부하)·429(한도 초과)·타임아웃(3분)이면 다음 모델로. 400/401/403(키 문제)은 바꿔도 같으므로 바로 실패 처리.
- RPD 초기화 시각은 태평양 자정으로 알려져 있는데, 2026-10-14엔 KST 20시가 넘어서도 Flash가 429였다 — 정확한 시각은 미확인.
- 어느 모델이 답했는지는 popular run의 `collection_runs.api_call_log`(`{promptVersion, extract:{models…}, review:{model…}, fallbackReason}`)에 남는다.
- 무료 등급은 입력이 Google 제품 개선에 쓰이고 사람이 검토할 수 있다. 공개 게시글 제목만 보내므로 무방하다.

### 실패 처리

매시간 크론이라 LLM 장애로 그 시각 순위가 통째로 날아가면 안 된다.

| 상황 | 동작 | run status | Actions |
| ---- | ---- | ---------- | ------- |
| 앞 모델 실패(503·429·타임아웃) | 다음 모델로 | `success` | ✅ + `::warning::` |
| 추출 배치가 모든 모델에서 실패 | 남은 글은 이번 순위에서 키워드 없음 취급(저장 안 해서 다음 실행이 다시 뽑음) → top10 저장 | `partial` | ❌ 실패 |
| 검수가 모든 모델에서 실패 | 검수 없이 top10 저장 | `partial` | ❌ 실패 |
| 키 오류(400·401·403) / `GEMINI_API_KEY` 없음 | 순위를 낼 수 없어 저장하지 않음 | — | ❌ 실패 |
| `--no-review` 플래그 | 검수를 안 함(비교용) | `success` | ✅ |

**순위는 먼저 저장한 뒤 마지막에 실패 종료(exit 1)한다.** 앱 데이터는 끊기지 않고, Actions가 빨간 X가 되어 GitHub 실패 메일이 온다. 사유는 `collection_runs.error_message`와 Actions 요약의 `::error::`에 남는다. 앱 쪽(`server/repositories/`)은 run을 `status`로 거르지 않으므로 `partial`이어도 그대로 보인다.

> **왜 이렇게 바꿨나 (2026-10-14).** Claude API 키가 2026-09-02에 만료됐는데, 예전 코드는 API 오류를 삼키고 `status='success'`로 기록한 뒤 정상 종료했다. 새 단어(`애플`·`NEON`·`이미` 등)가 판정 없이 순위에 올라가는 상태가 **6주간** 이어졌지만 Actions는 매번 초록색이라 아무도 몰랐다.

---

## 5. 저장 — `store.mjs`

`issues.mjs`가 최종 top10(`ranked[]`)을 넘기면, `store.mjs`가 아래 순서로 커밋한다. **스키마는 `db/schema.ts` 소유** — 이 파일은 `CREATE TABLE`을 하지 않고, 스키마가 없으면 `assertSchema()`가 즉시 멈춘다.

```
startRun({ pipeline: 'popular', ... })  → collection_runs 1행
upsertKeyword(term)  각 term마다  → keywords UPSERT (이미 있으면 그대로 둠)
saveTrendSnapshots() → trend_snapshots에 top10 INSERT
finishRun()  → collection_runs UPDATE (keyword_count 등)
```

### `sources` — 소스 마스터 (5행 고정)

| 컬럼                            | 내용                                                                                                                       |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `id`/`name`/`kind`/`created_at` | `dcbest`/`theqoo`/`instiz`/`youtube`/`gtrends`. `kind`엔 DB UNIQUE가 없어(unified 스키마 설계 허점) 시드는 `name`으로 우회 |

### `raw_signals` — 수집 원문

| 컬럼                                                           | 내용                                          |
| -------------------------------------------------------------- | --------------------------------------------- |
| `run_id`                                                       | → `collection_runs.id` (`pipeline='collect'`) |
| `source_id`/`source`                                           | 어느 사이트 / 신호 종류(title·comment)        |
| `text`/`text_hash`/`video_id`/`meta`/`bucket_at`/`captured_at` | 1장 참고                                      |

`UNIQUE(source_id, text_hash, bucket_at)`.

### `collection_runs` — 파이프라인 실행 로그 (공유 테이블)

| 컬럼                                            | 내용                                                              |
| ----------------------------------------------- | ----------------------------------------------------------------- |
| `pipeline`                                      | `collect` / `popular`                                             |
| `geo`                                           | 항상 `KR`                                                         |
| `status`                                        | `success`/`partial`/`error`                                       |
| `raw_signal_count`                              | collect: 저장한 원문 수 / popular: 창에서 읽은 원문 수            |
| `keyword_count`                                 | popular run에서만 — top-N 개수                                    |
| `api_call_log`                                  | collect: 소스별 `{source, items, error}` / popular: 프롬프트 버전·추출·검수 모델 |
| `bucket_at`/`window_hours`/`buckets`/`filtered` | 기준 시각 / 창 길이 / 창에 실제 있던 버킷 수 / 검수 적용 여부 |

### `keywords` — 키워드 엔티티

| 컬럼            | 내용                                                                   |
| --------------- | ---------------------------------------------------------------------- |
| `term`/`slug`   | 키워드 이름(이름 사전 반영) / 한글 슬러그                              |
| `source_id`     | 최초 발견 시 가중치 최상위 소스                                        |
| `first_seen_at` | 최초 발견 시각(이후 안 바뀜 — 이미 있으면 `upsertKeyword`가 그대로 둠) |
| `category_id`   | 추출이 붙인 카테고리(창 안 최다)→`categories`. 신규 승격 시 채우고, 기존 행은 비어 있을 때만 채움 |

### `trend_snapshots` — 실행별 top10

| 컬럼                                    | 내용                                                                                                                                     |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `keyword_id`/`run_id`                   | → `keywords.id` / → `collection_runs.id`(popular run)                                                                                    |
| `rank`/`score`/`mentions`/`captured_at` | 랭킹 결과 그대로                                                                                                                         |
| `growth_rate`                           | **계산값**(LLM 아님). 직전 popular run 대비 `score` 변화율 — `"+23%"`/`"NEW"`(직전 점수 0)/`"N회 언급"`(직전 run에 없던 신규 진입)       |
| `velocity`                              | **계산값**. 3장에서 계산한 참여도 보정 평균을 `"X.X/10"`으로 포맷                                                                        |
| `reasons`                               | `[{source, weight, text?, sample?}]`. 최상위 가중치 소스에만 `text`/`sample`(원문 예문, 같은 값) 부착. `text`는 API가 요구하는 필수 필드 |
| `source_label`                          | **계산값**. `reasons[].source`를 `", "`로 join                                                                                           |
| `summary`/`external_ref`/`source_url`   | **항상 NULL**. `summary`는 일부러 안 채운다 — 이 서비스는 키워드만 모은다(2026-10-14 결정). 나머지는 TODO |

실제 예 (2026-08-12 21:00 popular run):

```
term='NCT' rank=1 score=58 growth_rate='+0%' velocity='3.5/10' source_label='youtube'
reasons=[{"source":"youtube","weight":43,"text":"NCT 127 엔시티 127 'Piñata' Track Video","sample":"..."},
         {"source":"theqoo","weight":4}]
```

### `text_extractions` — 글 단위 추출 캐시

| 컬럼 | 내용 |
| ---- | ---- |
| `text_hash`(PK) | `raw_signals.text_hash`와 같은 sha1 |
| `prompt_version` | 뽑은 프롬프트 버전. 현재 버전과 다르면 없는 것으로 보고 다시 뽑아 덮어쓴다 |
| `model`/`timeliness`/`keywords`/`extracted_at` | 2장 참고. `keywords` = `[{name, category, issue}]`, 키워드 없는 글은 `[]`(그것도 결과라 저장) |

### `keyword_aliases` — 이름 사전

| 컬럼 | 내용 |
| ---- | ---- |
| `alias`(PK)/`canonical` | 검수가 같은 대상으로 묶은 이름 (예: `인천 칼부림` → `인천 흉기난동`). A→B 뒤 B→C가 오면 A도 C로 당긴다 |
| `model`/`created_at` | 묶은 모델·시각. 잘못 묶였으면 그 행을 지우면 된다 |

`categories`는 8행이다 — 2026-10-14 `유행어·밈`(slug `meme`)을 추가했다. 예전 `keyword_verdicts`(단어 판정 캐시)는 같은 날 DB에서 지웠다(`drizzle/0003`).

---

## 6. 실행 방법

```bash
# 정기 실행은 GitHub Actions가 한다 (8장) — 아래는 전부 수동용

npm run collect     # 5소스 수집 → raw_signals
npm run rank        # 최근 6시간 랭킹 계산 → trend_snapshots (--save 포함)

# 수동 확인 (DB에 안 씀 — LLM은 부른다)
node --env-file=.env.local pipeline/rank-popular.mjs
node --env-file=.env.local pipeline/rank-popular.mjs --no-review   # 검수 없이
REVIEW_DEBUG=1 node --env-file=.env.local pipeline/rank-popular.mjs # 검수 입력·원응답 출력

# 파라미터 (TOP_N 기본 10, HOURS 기본 6)
HOURS=12 TOP_N=30 node --env-file=.env.local pipeline/rank-popular.mjs

# 프롬프트 정답 세트 (2장)
node --env-file=.env.local pipeline/experiments/golden-test.mjs
node --env-file=.env.local pipeline/experiments/review-test.mjs
```

**과거 시간대 재계산** — `backfill-issues.mjs`. 최근 N시간의 정시마다 새 방식으로 top10을 다시 만든다(오래된 시간대부터, `growth_rate`가 직전 run과 비교하므로).

```bash
HOURS_BACK=48 node --env-file=.env.local pipeline/backfill-issues.mjs                         # 출력만
HOURS_BACK=48 node --env-file=.env.local pipeline/backfill-issues.mjs --save                  # 새 run 추가
HOURS_BACK=48 node --env-file=.env.local pipeline/backfill-issues.mjs --save --replace-all    # + 그 밖의 popular run 전부 삭제
```

창 안 글을 먼저 한꺼번에 추출하고(48시간이면 고유 글 ~1,800개 → Lite ~35회), 시간대마다 검수 3회 → 48시간에 Lite ~180회. 추출이 한도로 끊기면 과거 기록은 건드리지 않고 멈춘다(뽑은 건 저장돼 다시 돌리면 이어서). `--replace-all`은 이번에 만든 run 외의 popular run·`trend_snapshots`를 지우고, 어떤 순위·즐겨찾기·근거 콘텐츠도 가리키지 않는 `keywords` 행을 정리한다.

> **2026-10-14 실행 기록** — 옛 단어 방식의 순위 기록(8월~)을 전부 지우고 최근 48시간만 새 방식으로 다시 만들었다. 더 긴 과거가 필요하면 `HOURS_BACK`을 늘려 다시 돌리면 된다(원문 `raw_signals`는 그대로 있다). 무료 한도(Lite 하루 500회) 때문에 하루에 3일치 정도가 한계다.

> `npm run collect` / `npm run rank`은 `--env-file=.env.local`이 붙어 있다. 러너에는 `.env.local`이 없으므로(gitignore) 워크플로는 `node pipeline/*.mjs`를 직접 부르고 Secrets를 `env:`로 주입한다.

### 스케줄 — launchd(구) → GitHub Actions(현재)

**예전:** `~/Library/LaunchAgents/com.trendrising.hourly.plist`가 매시 정각에 `run-hourly.sh`를 실행했다. 맥이 꺼지거나 잠들면 그 시간이 통째로 비었고 소급도 안 됐다. 마지막 실행 로그는 2026-08-04다.

`run-hourly.sh`는 절대 경로(`/Users/yang/...`)·nvm 경로·로컬 pg 기동 로직이 박혀 있어 러너에서 못 썼다. 실제로 필요한 건 `node pipeline/collect.mjs` 한 줄뿐이었으므로 **2026-08-16에 스크립트를 삭제했다.** launchd 작업도 언로드된 상태다(`launchctl list`에 없음). 남아 있는 plist 파일(`com.trendrising.hourly.plist`, `com.trendcollector.sources.plist`)은 레포 밖이라 손대지 않았다 — 지우려면 직접 지워야 한다.

---

## 7. 파일 목록

| 파일                   | 역할                                    | API 호출 |
| ---------------------- | --------------------------------------- | -------- |
| `collect.mjs`          | 5소스 병렬 수집 → `raw_signals`         | YouTube  |
| `sources/*.mjs`        | 소스별 스크래퍼                         |          |
| `issues.mjs`           | 추출·코드 검증·검수·재집계 (2·4장)      | ✅       |
| `issue-prompt.mjs`     | 추출·검수 프롬프트, `PROMPT_VERSION`    |          |
| `gemini.mjs`           | Gemini 호출·모델 순서·예비 전환         | ✅       |
| `popular.mjs`          | 점수 로직(가중치·보정·velocity)         | ❌       |
| `rank-popular.mjs`     | 최신 창 계산·저장 (진입점)              | 간접     |
| `backfill-issues.mjs`  | 과거 시간대 재계산 (6장)                | 간접     |
| `store.mjs`            | Postgres 저장 계층(DDL 없음)            | ❌       |
| `experiments/`         | 정답 세트(`golden-*`, `review-test`)    | ✅       |

2026-10-14 삭제: `tokenize.mjs`, `verdict.mjs`, `warm-verdicts.mjs`, `backfill-popular.mjs`, `backfill-categories.mjs` (옛 단어 방식). `backfill-popular.mjs` 자리는 `backfill-issues.mjs`가 잇는다.

---

## 8. 인프라 — Neon · 마이그레이션 · Actions

### 8-1. DB는 Neon이다

```
프로젝트    Neon / aws-us-east-1 (N. Virginia)
엔드포인트  ep-red-pine-av0rffus
서버        PostgreSQL 18.4
DB / 계정   neondb / neondb_owner
```

**왜 Neon인가.** 이 파이프라인은 매시간 몇 분 일하고 나머지는 논다(90%+ 유휴). Neon은 유휴가 5분 이어지면 컴퓨트를 정지시키고(scale-to-zero) 그동안 과금하지 않는다 — 워크로드 모양이 맞는다. 콜드 스타트는 실측 2.5초인데 배치 작업엔 무의미하다. 다만 **나중에 API/UI를 붙이면 첫 방문자가 그만큼 기다린다.**

**왜 버지니아인가.** Neon에 도쿄·서울 리전이 없다(아시아는 싱가포르·시드니뿐). 최종 실행 위치가 GitHub Actions 러너(대부분 US)라 거기 붙는 게 맞다. `store.mjs`가 행 단위 INSERT를 루프로 돌려서 왕복 지연이 행 수만큼 곱해지는데, 러너 기준으로 버지니아가 압도적으로 가깝다.

**연결 문자열이 두 개다.** 호스트에 `-pooler`가 붙었는지로 구분한다.

|                             | 경로            | 쓰는 곳                      |
| --------------------------- | --------------- | ---------------------------- |
| **direct** (`-pooler` 없음) | Postgres에 바로 | **파이프라인**, `db:migrate` |
| **pooled** (`-pooler` 있음) | PgBouncer 경유  | `app/api/**` (재작성 예정)   |

pooled는 접속을 돌려막아 동시 접속 상한이 높지만 **트랜잭션이 끝나면 세션 상태가 날아간다.** `store.mjs`의 `prepare: false`가 정확히 이걸 위한 설정이다. 파이프라인은 매시간 프로세스 하나뿐이라 direct로 충분하고, DDL은 세션이 유지되는 direct가 안전하다.

로컬 `.env.local`에는 `DATABASE_URL`(direct)과 `DATABASE_URL_POOLED`가 있다. **후자는 현재 어떤 코드도 읽지 않는다** — API 재작성 때 쓰려고 적어둔 메모다.

> ⚠️ **무료 플랜 스토리지가 0.5GB다.** `raw_signals`는 계속 쌓인다 — 버킷당 195행 · 행당 ~305 bytes → **연 170만 행 / 약 1GB**. 즉 **6개월쯤 뒤에 한도에 닿는다.** 넘으면 데이터가 지워지는 게 아니라 **INSERT/UPDATE/DELETE가 실패한다** — Actions는 초록불인데 데이터만 안 늘어나는, 알아채기 어려운 형태로 멈춘다. 원문은 재계산의 근거라 함부로 못 지운다(그게 이 설계의 핵심). 정리 정책이 필요하다. 컴퓨트(100 CU-hour/월)는 월 ~30으로 여유롭다.

### 8-2. 스키마 마이그레이션

**`db/schema.ts`가 유일한 소유자다.** 파이프라인은 drizzle을 런타임에 쓰지 않는다 — `pipeline/**`에 import가 0건이고 `store.mjs`는 `postgres` 패키지로 생 SQL을 쓴다. drizzle의 역할은 **테이블을 만드는 것**뿐이다.

```
db/schema.ts       ─ drizzle-kit ─▶  테이블 생성/변경   (스키마 바뀔 때마다)
pipeline/store.mjs ─ 생 SQL ──────▶  데이터 적재        (매시간)
app/api/** (예정)  ─ drizzle-orm ─▶  데이터 조회        (타입 안전 쿼리)
```

**바꾸는 절차:**

```bash
# 1) db/schema.ts 수정
npm run db:generate   # 2) → drizzle/0001_xxx.sql 생성. DB 연결 불필요
                      # 3) 생성된 .sql을 눈으로 확인 ★ 건너뛰지 말 것
npm run db:migrate    # 4) → 안 돌린 것만 DB에 적용 + __drizzle_migrations에 기록
                      # 5) 커밋 (db/schema.ts + drizzle/ 통째로)
```

**`drizzle/` 안의 세 가지가 각각 다르다:**

| 파일                      | DB에 감? | 역할                                  |
| ------------------------- | -------- | ------------------------------------- |
| `0000_*.sql`              | **감**   | 실행할 명령 — "무엇을 할지"           |
| `meta/0000_snapshot.json` | 안 감    | 비교 기준 — "하고 나면 어떤 모습인지" |
| `meta/_journal.json`      | 안 감    | 순서 목차                             |

`generate`는 **실제 DB가 아니라 스냅샷 파일과** `schema.ts`를 대조해 diff를 뜬다. 그래서 DB 연결 없이 돌아가고, 그래서 **`drizzle/`은 `meta/`까지 통째로 커밋해야 한다** — 스냅샷이 없으면 이미 있는 테이블을 처음부터 다시 만드는 SQL을 뽑아낸다.

적용 여부는 파일이 아니라 DB의 **`public.__drizzle_migrations`** 에만 있다. 파일 이름이 아니라 `.sql` **내용의 SHA256**을 저장한다(기본은 별도 `drizzle` 스키마인데, Neon 콘솔 Tables가 스키마를 하나씩만 보여줘서 `public`으로 옮겼다 — `drizzle.config.mjs`의 `migrations` 항목).

**세 가지 주의:**

- **`npm run db:push`는 쓰지 않는다.** 파일도 이력도 남기지 않고 DB를 즉시 바꾼다. 실 DB가 생긴 이상 되돌릴 근거가 없다. (게다가 DB에 스키마 밖 테이블 `trend_surge_episodes`가 있어서, push·generate가 "이름 바꾼 거냐"는 대화형 질문에서 멈춘다. 추가와 삭제를 한 번에 하면 generate도 같은 질문을 한다 — 2026-10-14엔 둘로 나눠 0002·0003을 만들었다)
- **이미 적용된 `.sql`은 수정하지 않는다.** 해시가 어긋난다. 고칠 게 있으면 새 마이그레이션을 만든다.
- **Neon 콘솔 SQL Editor로 `ALTER TABLE`을 치지 않는다.** 스냅샷과 현실이 어긋나 다음 `generate`가 엉뚱한 SQL을 뽑는다. 조회(`SELECT`)는 괜찮다.

> **데이터 값을 옮기는 건 drizzle이 추론하지 못한다.** 구조 변경(컬럼 추가·삭제·인덱스)만 자동이다. 컬럼 이름을 바꾸면 종종 "옛 컬럼 DROP + 새 컬럼 ADD"로 뽑는데 그러면 데이터가 날아간다 — 생성된 `.sql`을 `ALTER TABLE ... RENAME COLUMN`으로 직접 고쳐 쓰면 된다. 그냥 SQL 파일이라 손대도 된다.

### 8-3. GitHub Actions

```
.github/workflows/collect.yml   매시간 :05      ← cron-job.org가 호출
.github/workflows/rank.yml      매시간 :20      ← cron-job.org가 호출
```

**시계는 GitHub 밖에 있다.** 두 워크플로 모두 트리거가 `workflow_dispatch` 하나뿐이고,
외부 스케줄러(cron-job.org)가 정해진 시각에 dispatch API를 호출해서 실행한다.
수집 자체는 예전과 똑같이 GitHub Actions 러너에서 돈다 — 방아쇠만 밖으로 나갔다.

```
cron-job.org ──POST dispatches API──> GitHub Actions ──> node pipeline/collect.mjs
```

**왜 GitHub `schedule:`을 버렸나 (2026-09-30 실측)**

| 워크플로 | 걸어둔 cron | 기대 | 실제 | 이행률 |
| -------- | ------------- | --------- | -------------- | ------ |
| collect  | `5 * * * *`   | 24회/일 | **5.75회/일** | 24% |
| rank     | `20 */2 * * *`| 12회/일 | **5.31회/일** | 44% |

주기를 2배 다르게 써놨는데 실제 실행 횟수는 둘 다 하루 5회대로 같았다 —
**cron 식을 뭐라고 쓰든 이 레포엔 하루 5~6번만 떨어진다.** 35일간 실패 0회,
실행시간 중앙값 0.7분, 큐 대기 0분이라 우리 쪽 문제가 아니다. GitHub의 `schedule`은
best-effort라 혼잡하면 지연되고 **밀린 회차는 소급 없이 버려진다**(정각 부근이 최대 혼잡).
실행 간격은 중앙값 4.1h, 최대 13.1h까지 벌어졌고, 그 결과 `raw_signals`의
1시간 버킷이 14일 기준 **76/336(23%)**만 찼다. collect은 거른 시간대를 복구할 수
없으므로(0장) 이건 비가역 손실이다.

`workflow_dispatch`는 사람이 "Run workflow" 버튼을 누른 것과 같은 취급이라
혼잡 큐에 서지 않고 즉시 실행된다.

**예비로 `schedule:`을 남기지 않았다.** 남기면 주 트리거가 죽어도 하루 5번은 계속 돌아서
"절반만 살아있는 상태"를 가린다. 이번 문제를 몇 주 동안 못 보고 지나친 원인이 정확히 그거다.
트리거가 하나뿐이면 고장 시 실행이 0이 되어 바로 드러난다.

**cron-job.org 설정** (작업 2개)

| 항목    | collect                                                                                     | rank                    |
| ------- | ------------------------------------------------------------------------------------------- | ----------------------- |
| URL     | `POST https://api.github.com/repos/trend-drop-team/TrendDrop/actions/workflows/collect.yml/dispatches` | 〃 `rank.yml/dispatches` |
| 주기    | 매시간 :05                                                                                  | 매시간 :20 (2026-10-14까지 2시간마다) |
| Body    | `{"ref":"master"}`                                                                          | 〃                      |

공통 헤더:

```
Authorization: Bearer <PAT>
Accept: application/vnd.github+json
Content-Type: application/json
```

성공 응답은 **204 No Content**(본문 없음)다. 실패 시 메일 알림을 반드시 켤 것 —
`schedule:` 예비선을 없앴으므로 이 알림이 유일한 감시 장치다.

**PAT은 fine-grained로 권한을 최소로 준다** — Repository access는 `trend-drop-team/TrendDrop`
하나만, Permissions는 **Actions: Read and write** 하나만. 유출돼도 할 수 있는 일이
"우리 워크플로를 실행/취소"뿐이다(push·Secrets 열람·타 레포 접근 전부 불가).

파일 안에 결정 근거를 주석으로 달아뒀다. 주기를 나눈 이유는 0장에 있다.

**Secrets 3개** (레포 Settings → Secrets and variables → Actions → New repository secret):

| Name                | 값                     |
| ------------------- | ---------------------- |
| `DATABASE_URL`      | Neon **direct** 문자열 |
| `YOUTUBE_API_KEY`   |                        |
| `GEMINI_API_KEY`    | `rank.yml`에만 주입됨. Google AI Studio `trenddrop` 프로젝트 키 (2026-10-14 `ANTHROPIC_API_KEY`에서 교체) |

`REGION_CODE=KR`은 민감값이 아니라 워크플로에 직접 적었다. **`collect.yml`에는 `GEMINI_API_KEY`를 일부러 주지 않는다** — 수집 경로에 LLM 호출이 섞여 들어오면 조용히 돌지 않고 바로 실패해서 드러난다.

**함정 넷:**

① **시간대는 안전하다.** `collect.mjs`의 `hourBucket()`이 `setMinutes(0,0,0)` 후 `toISOString()`인데, KST는 UTC+9 정시 오프셋이고 서머타임이 없어서 정시 내림 결과가 UTC에서든 KST에서든 같은 순간이다. 러너가 UTC라도 버킷은 안 틀어진다.

② **GitHub `schedule:`은 못 쓴다.** 밀리는 정도가 아니라 회차가 통째로 버려진다(위 실측표). 이 함정 때문에 트리거를 cron-job.org로 옮겼다. **여기에 cron을 다시 추가하지 말 것** — 되살리면 고장을 가리는 예비선이 된다.

③ **PAT 만료가 새로운 단일 실패점이다.** cron-job.org에 넣은 토큰이 만료되면 dispatch가 401로 떨어지고 파이프라인이 **완전히 멈춘다**(예비선이 없으므로 0회). 만료일을 달력에 적어둘 것. 멈추면 cron-job.org 실패 알림 메일이 온다.

④ **스크래핑 차단 위험.** dcbest·theqoo·instiz는 HTML 스크래핑이라 러너 IP 대역이 막힐 수 있다. **이관 직후 소스별 수집 건수를 반드시 대조할 것** — 기준값(로컬 실측, 2026-08-16 13:00 UTC 버킷):

```
dcbest 49 · theqoo 20 · instiz 10 · youtube 110 · gtrends 10 = 199건
```

총합은 시간대에 따라 흔들리지만 **특정 소스만 0건**인 건 다르다. 막히면 그 소스만 별도 경로(자체 서버/프록시)가 필요하다.

> **`workflow_dispatch`는 워크플로 파일이 기본 브랜치(master)에 있어야 동작한다.** UI의 "Run workflow" 버튼도, cron-job.org가 때리는 dispatch API도 마찬가지다. 머지 전에는 Actions 탭에 아무것도 보이지 않는 게 정상이고, **cron-job.org 설정은 머지 후에 해야 404가 안 난다.**
>
> 머지에는 팀 조율이 걸려 있다 — **머지하면 master에서 `next build`가 깨진다.** `app/api/**`의 import 9곳이 구 스키마를 가리킨 채 끊겨 있어서다(의도한 상태이고 API 재작성 때 해소된다). 파이프라인 워크플로 자체는 `node`만 돌리므로 build와 무관하게 정상 동작한다. `lib/pipeline-v-he/**` 삭제도 songhaeunsong 브랜치가 살아 있어 공지가 필요하다.

> **`npm ci`가 아니라 `npm ci --omit=dev`를 쓴다.** 파이프라인은 devDependencies(drizzle-kit·typescript·eslint)를 쓰지 않는다. `pipeline/**`의 외부 import는 `postgres` 하나뿐이고(지연 import, dependencies에 있음) Gemini는 Node 내장 `fetch`로 부른다. `@anthropic-ai/sdk`는 2026-10-14 이후 파이프라인에서 쓰지 않는다.

**YouTube 할당량은 여유롭다.** `youtube.mjs`가 비싼 `search.list`(100 units)를 쓰지 않고 `videos?chart=mostPopular`(1) + 영상당 `commentThreads`(1)만 쓴다 → 실행당 약 21 units, 매시간 돌려도 하루 ~500 units로 무료 한도 10,000의 5%다.

---

## TODO

**카테고리(`keywords.category_id`)** — ✅ 2026-09-02 해결, 2026-10-14 이슈 추출 카테고리로 이어받음(8종, `유행어·밈` 추가). UI 탭 구성은 `/api/categories`가 이 테이블을 그대로 읽으므로 자동 반영된다.

**`trend_contents`(상세페이지 "근거 콘텐츠" 카드)** — 지금 아예 안 씀. 필요한 필드: `url`/`thumbnail_url`/`metric_label`/`excerpt`.

- 유튜브: `video_id`·`viewCount`·`likeCount`가 이미 있어서 거의 매핑만 하면 됨(URL/썸네일은 표준 패턴으로 조합 가능)
- dcbest/theqoo/instiz: 스크래퍼가 제목만 긁고 게시글 URL을 안 잡음 — 스크래퍼 자체를 확장해야 하는 **진짜 별도 수집** 작업

**`keyword_relations`(연관 키워드 칩)** — 수집이 아니라 계산 문제. 같은 버킷·같은 원문에 같이 등장하는 키워드로 co-occurrence 점수를 내면 됨(외부 데이터 불필요).

**`trend_snapshots.summary`(AI 요약)** — 하지 않기로 했다(2026-10-14). 서비스는 키워드만 모은다.

**`trend_snapshots.external_ref`/`source_url`** — 원문 URL을 안 모으고 있어 채울 데이터가 없음. `trend_contents` 작업과 연결됨.
