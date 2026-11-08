import type { Metadata } from "next";
import Link from "next/link";

import "./privacy.css";

export const metadata: Metadata = {
  title: "개인정보 처리방침",
  description: "TrendDrop이 수집하는 개인정보, 쿠키(광고 쿠키 포함), 보관 기간을 안내합니다.",
};

export default function PrivacyPage() {
  return (
    <div className="page-shell">
      <main className="privacy" aria-labelledby="privacy-title">
        <header className="privacy-head">
          <p className="section-kicker">PRIVACY</p>
          <h1 id="privacy-title">개인정보 처리방침</h1>
          <p className="privacy-lead">
            TrendDrop은 서비스 제공에 꼭 필요한 정보만 수집하며, 아래 내용을 투명하게 알려드립니다.
          </p>
        </header>

        <section className="privacy-section">
          <h2>1. 수집하는 항목</h2>
          <ul>
            <li>
              <strong>로그인 시</strong> — 소셜 로그인 제공자가 전달하는 이메일 주소와 이름
            </li>
            <li>
              <strong>서비스 이용 중</strong> — 직접 저장하거나 선택한 관심 키워드
            </li>
          </ul>
          <p>로그인하지 않고 둘러보는 경우에는 위 정보를 수집하지 않습니다.</p>
        </section>

        <section className="privacy-section">
          <h2>2. 수집 목적</h2>
          <ul>
            <li>로그인 상태 유지와 계정 식별</li>
            <li>관심 키워드를 기기에 관계없이 이어서 볼 수 있도록 저장</li>
          </ul>
        </section>

        <section className="privacy-section">
          <h2>3. 쿠키 사용</h2>
          <ul>
            <li>
              <strong>세션 쿠키</strong> — 로그인 상태를 유지하기 위해 사용하며, 로그아웃하거나 만료되면
              더 이상 쓰이지 않습니다.
            </li>
            <li>
              <strong>Google 광고 쿠키</strong> — 광고가 게재되는 경우, Google 및 제3자 광고 공급업체가
              쿠키를 사용해 이용자의 이전 방문 기록을 바탕으로 광고를 표시할 수 있습니다. 광고 쿠키 덕분에
              Google과 파트너는 이 사이트와 다른 사이트 방문 기록에 근거해 광고를 제공합니다.
            </li>
          </ul>
          <p>
            맞춤 광고는{" "}
            <a href="https://adssettings.google.com" target="_blank" rel="noopener noreferrer">
              Google 광고 설정
            </a>
            에서 언제든지 해제할 수 있으며, 브라우저 설정에서 쿠키를 차단하거나 삭제할 수도 있습니다.
          </p>
        </section>

        <section className="privacy-section">
          <h2>4. 보관 기간</h2>
          <ul>
            <li>이메일·이름·관심 키워드는 회원 탈퇴 또는 삭제 요청 시까지 보관한 뒤 지체 없이 파기합니다.</li>
            <li>세션 쿠키는 로그아웃하거나 유효 기간이 끝나면 만료됩니다.</li>
          </ul>
        </section>

        <section className="privacy-section">
          <h2>5. 문의처</h2>
          <p>
            개인정보 열람·정정·삭제 요청과 문의는 아래로 연락해 주세요.
          </p>
          <p className="privacy-todo">문의: (팀 이메일 기입 필요)</p>
        </section>

        <Link href="/" className="privacy-back">
          ← 홈으로
        </Link>
      </main>
    </div>
  );
}
