"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

// 클라이언트 라우팅(Link)은 document.referrer를 바꾸지 않는다.
// 그래서 "앱 안에서 다른 화면을 거쳐 왔는지"는 경로 변화를 직접 기록해서 판단한다.
const IN_APP_KEY = "td-in-app-nav";

let lastPath: string | null = null;

/** 이 탭에서 앱 안 이동이 한 번이라도 있었는지. 뒤로가기 버튼이 router.back()을 써도 되는지 판단할 때 쓴다. */
export function hasInAppHistory(): boolean {
  try {
    return sessionStorage.getItem(IN_APP_KEY) === "1";
  } catch {
    return false;
  }
}

/** layout에 한 번 두는 기록기. 화면에는 아무것도 그리지 않는다. */
export default function NavHistory() {
  const pathname = usePathname();

  useEffect(() => {
    try {
      if (lastPath === null) {
        // 전체 로드: 외부 링크·직접 입력으로 들어왔으면 이전 기록을 지운다(뒤로가기가 외부로 나가지 않게).
        const fromSameSite = !!document.referrer && new URL(document.referrer).origin === window.location.origin;
        if (!fromSameSite) sessionStorage.removeItem(IN_APP_KEY);
      } else if (lastPath !== pathname) {
        sessionStorage.setItem(IN_APP_KEY, "1");
      }
    } catch {
      // sessionStorage를 못 쓰면 뒤로가기는 홈으로 폴백한다.
    }
    lastPath = pathname;
  }, [pathname]);

  return null;
}
