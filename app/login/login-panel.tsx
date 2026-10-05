"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";

type Provider = "kakao" | "google";

const apiUrl = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "");

function getAuthUrl(provider: Provider) {
  const configured = process.env[`NEXT_PUBLIC_${provider.toUpperCase()}_AUTH_URL`];
  return configured || (apiUrl ? `${apiUrl}/api/auth/${provider}` : undefined);
}

const noopSubscribe = () => () => undefined;

/** 카카오 로그인 디자인 가이드의 말풍선 심볼 (#000000). */
function KakaoSymbol() {
  return (
    <svg className="social-login-icon" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
      <path
        fill="#000"
        d="M9 .6C4.03.6 0 3.71 0 7.55c0 2.39 1.56 4.5 3.93 5.75l-1 3.65c-.09.32.28.58.56.39l4.38-2.89c.37.04.75.06 1.13.06 4.97 0 9-3.11 9-6.96C18 3.71 13.97.6 9 .6"
      />
    </svg>
  );
}

/** Google 로그인 브랜딩 가이드의 4색 G 로고. */
function GoogleLogo() {
  return (
    <svg className="social-login-icon" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

export default function LoginPanel() {
  const router = useRouter();
  const [busy, setBusy] = useState<Provider | null>(null);
  const [message, setMessage] = useState("");
  // 서버 렌더에는 쿼리가 없으므로 false로 시작해야 하이드레이션이 어긋나지 않는다.
  const hasErrorParam = useSyncExternalStore(
    noopSubscribe,
    () => new URLSearchParams(window.location.search).has("error"),
    () => false
  );
  const notice = message || (hasErrorParam ? "로그인에 실패했습니다. 잠시 후 다시 시도해 주세요." : "");

  useEffect(() => {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "");
    if (!apiUrl) return;
    fetch(`${apiUrl}/api/auth/me`, { credentials: "include" })
      .then((response) => { if (response.ok) router.replace("/"); })
      .catch(() => undefined);
  }, [router]);

  function startLogin(provider: Provider) {
    const url = getAuthUrl(provider);
    if (!url) {
      setMessage("로그인 서버 주소가 설정되지 않았습니다. 관리자에게 문의해 주세요.");
      return;
    }

    setBusy(provider);
    const callback = `${window.location.origin}/login`;
    const separator = url.includes("?") ? "&" : "?";
    window.location.assign(`${url}${separator}redirect_uri=${encodeURIComponent(callback)}`);
  }

  return (
    <section className="login-card" aria-label="소셜 로그인">
      <button type="button" className="social-login-button kakao-login-button" onClick={() => startLogin("kakao")} disabled={busy !== null}>
        <KakaoSymbol />
        <span className="social-login-label">{busy === "kakao" ? "카카오 로그인 연결 중…" : "카카오 로그인"}</span>
      </button>
      <button type="button" className="social-login-button google-login-button" onClick={() => startLogin("google")} disabled={busy !== null}>
        <GoogleLogo />
        <span className="social-login-label">{busy === "google" ? "Google 로그인 연결 중…" : "Google 계정으로 로그인"}</span>
      </button>
      {notice && <p className="login-error" role="alert">{notice}</p>}
    </section>
  );
}
