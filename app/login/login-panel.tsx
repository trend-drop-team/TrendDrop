"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Provider = "kakao" | "google";

const apiUrl = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "");

function getAuthUrl(provider: Provider) {
  const configured = process.env[`NEXT_PUBLIC_${provider.toUpperCase()}_AUTH_URL`];
  return configured || (apiUrl ? `${apiUrl}/api/auth/${provider}` : undefined);
}

export default function LoginPanel() {
  const router = useRouter();
  const [busy, setBusy] = useState<Provider | null>(null);
  const [message, setMessage] = useState(() =>
    typeof window !== "undefined" && new URLSearchParams(window.location.search).has("error")
      ? "로그인에 실패했습니다. 잠시 후 다시 시도해 주세요."
      : ""
  );

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
        <span className="social-login-icon kakao-icon" aria-hidden="true">●</span>
        {busy === "kakao" ? "카카오 로그인 연결 중…" : "카카오로 로그인"}
      </button>
      <button type="button" className="social-login-button google-login-button" onClick={() => startLogin("google")} disabled={busy !== null}>
        <span className="social-login-icon google-icon" aria-hidden="true">G</span>
        {busy === "google" ? "Google 로그인 연결 중…" : "Google로 로그인"}
      </button>
      {message && <p className="login-error" role="alert">{message}</p>}
    </section>
  );
}
