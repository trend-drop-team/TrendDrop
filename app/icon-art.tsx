import { ImageResponse } from "next/og";

import { C } from "@/app/card-art";

/**
 * 앱 아이콘(파비콘·홈 화면·apple-touch) 공통 그림. 헤더의 `TD` 브랜드마크와 같은 모양이다.
 *
 * 글자는 라틴 두 자뿐이라 한글 폰트를 받지 않는다. 마크를 캔버스의 약 60% 안에 두어
 * maskable(안전 영역) 아이콘으로도 잘리지 않는다.
 */
export function renderIcon(side: number) {
  const mark = Math.round(side * 0.6);
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: C.bg,
        }}
      >
        <div
          style={{
            width: mark,
            height: mark,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: Math.round(mark * 0.28),
            background: C.accent,
            color: "#06210f",
            fontSize: Math.round(mark * 0.5),
            fontWeight: 800,
            letterSpacing: -2,
          }}
        >
          TD
        </div>
      </div>
    ),
    { width: side, height: side },
  );
}
