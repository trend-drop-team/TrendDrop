import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Badge, Button, Card, Chip, GrowthBadge, SectionTitle, Stat } from "@/app/ui";

import "./ui-kit.css";

export const metadata: Metadata = { title: "UI 키트", robots: { index: false } };

/** UI 키트 미리보기(#123) — 개발 환경 전용. 운영에서는 404. 360px·다크/웜톤에서 깨지는지 여기서 본다. */
export default function UiKitPage() {
  if (process.env.NODE_ENV === "production") notFound();

  return (
    <div className="page-shell">
      <main className="app-main uikit">
        <SectionTitle eyebrow="개발 전용" title="TrendDrop UI 키트" sub="app/ui에서 가져다 쓴다. 색은 globals.css 토큰만 쓴다." />

        <Card>
          <SectionTitle title="Button" sub="높이 44px(sm 36px). 기본·주요·고스트." />
          <div className="uikit-row">
            <Button variant="primary">시작하기</Button>
            <Button>나중에</Button>
            <Button variant="ghost">다시 보지 않기</Button>
            <Button size="sm">작은 버튼</Button>
            <Button disabled>비활성</Button>
          </div>
        </Card>

        <Card>
          <SectionTitle title="Chip" sub="선택 상태는 aria-pressed. 가로 스크롤 줄에서도 줄바꿈하지 않는다." />
          <div className="uikit-row">
            <Chip selected>전체</Chip>
            <Chip>인물</Chip>
            <Chip>작품·콘텐츠</Chip>
            <Chip>기업·주식</Chip>
          </div>
        </Card>

        <Card>
          <SectionTitle title="Badge · GrowthBadge" sub="상승률은 부호에 맞춰 색과 화살표가 정해진다." />
          <div className="uikit-row">
            <Badge tone="new">NEW</Badge>
            <Badge tone="up">▲ 2</Badge>
            <Badge tone="down">▼ 3</Badge>
            <Badge>−</Badge>
            <GrowthBadge growth="+113%" />
            <GrowthBadge growth="-58%" />
            <GrowthBadge growth="+0%" />
            <GrowthBadge growth="1회 언급" />
          </div>
        </Card>

        <Card>
          <SectionTitle title="Stat" sub="숫자는 고정폭 숫자, 라벨은 자간 0." />
          <div className="uikit-stats">
            <Stat value="10" label="추적 키워드" />
            <Stat value="5" label="신규 진입" />
            <Stat value="+61%" label="최고 상승률" />
          </div>
        </Card>

        <Card flat>
          <SectionTitle eyebrow="왜 뜨나" title="Card flat · SectionTitle" sub="긴 한글 문장도 어절 단위로 줄바꿈되는지 확인하는 예시 문장입니다. 띄어쓰기없이아주길게이어지는문자열도화면밖으로넘치지않아야합니다." />
        </Card>
      </main>
    </div>
  );
}
