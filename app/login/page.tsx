import LoginPanel from "./login-panel";

export const metadata = {
  title: "로그인 | TrendDrop",
  description: "TrendDrop에 로그인하고 관심 트렌드를 저장하세요.",
};

export default function LoginPage() {
  return (
    <div className="page-shell login-page-shell">
      <main className="login-page" aria-labelledby="login-title">
        <div className="login-brand-mark" aria-hidden="true">TD</div>
        <p className="section-kicker">TREND ACCOUNT</p>
        <h1 id="login-title">TrendDrop에 로그인</h1>
        <p className="login-description">로그인하면 관심 키워드를 어디서든 이어서 볼 수 있습니다.</p>
        <LoginPanel />
        <p className="login-legal">계속하면 TrendDrop의 서비스 이용약관과 개인정보 처리방침에 동의하게 됩니다.</p>
      </main>
    </div>
  );
}
