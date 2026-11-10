"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { COMMAND_OPEN_EVENT } from "./command-palette";
import ThemeToggle from "./theme-toggle";

type NavItem = {
  href: string;
  label: string;
  icon: ReactNode;
};

function AvatarFallback() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="8" r="3.2" fill="currentColor" />
      <path d="M5.5 20c.7-3.7 2.9-5.5 6.5-5.5s5.8 1.8 6.5 5.5" fill="currentColor" />
    </svg>
  );
}

function avatarLabel(name: string) {
  return name.trim().slice(0, 1).toUpperCase();
}

const RankIcon = (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <rect x="3" y="12" width="4" height="8" rx="1" />
    <rect x="10" y="7" width="4" height="13" rx="1" />
    <rect x="17" y="3" width="4" height="17" rx="1" />
  </svg>
);

const TrendIcon = (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path
      d="M3 16.5 9 10l4 4 8-8"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path d="M15 6h6v6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const DocsIcon = (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path
      d="M6 3h8l4 4v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinejoin="round"
    />
    <path d="M9 12h6M9 16h6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

const ExploreIcon = (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <rect x="3" y="3" width="7" height="7" rx="1.5" fill="none" stroke="currentColor" strokeWidth="2" />
    <rect x="14" y="3" width="7" height="7" rx="1.5" fill="none" stroke="currentColor" strokeWidth="2" />
    <rect x="3" y="14" width="7" height="7" rx="1.5" fill="none" stroke="currentColor" strokeWidth="2" />
    <rect x="14" y="14" width="7" height="7" rx="1.5" fill="none" stroke="currentColor" strokeWidth="2" />
  </svg>
);

/** 실제 존재하는 라우트만 — 죽은 링크를 만들지 않는다. */
const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "랭킹", icon: RankIcon },
  { href: "/explore", label: "탐색", icon: ExploreIcon },
  { href: "/trend", label: "트렌드", icon: TrendIcon },
];

/** 문서는 관리자만 본다(#79) — showDocsNav가 false면 탭바에서 아예 뺀다. */
const DOCS_NAV_ITEM: NavItem = { href: "/docs", label: "문서", icon: DocsIcon };

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function AppNav({ showDocsNav }: { showDocsNav: boolean }) {
  const pathname = usePathname() ?? "/";
  const [user, setUser] = useState<{ name?: string | null; email: string } | null>(null);
  const [open, setOpen] = useState(false);
  const navItems = showDocsNav ? [...NAV_ITEMS, DOCS_NAV_ITEM] : NAV_ITEMS;

  useEffect(() => {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "");
    if (!apiUrl) return;
    fetch(`${apiUrl}/api/auth/me`, { credentials: "include" })
      .then((response) => response.ok ? response.json() as Promise<{ data?: { name?: string | null; email: string } }> : null)
      .then((payload) => { if (payload?.data) setUser(payload.data); })
      .catch(() => undefined);
  }, [pathname]);

  async function logout() {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "");
    if (apiUrl) await fetch(`${apiUrl}/api/auth/logout`, { method: "POST", credentials: "include" }).catch(() => undefined);
    setUser(null);
    setOpen(false);
    window.location.assign("/login");
  }

  const [frameBox, setFrameBox] = useState<CSSProperties>({});
  const menuId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);

  // 서랍은 body로 포털해 띄운다(앱 칼럼은 container query용 레이아웃 격리라 그 안의 fixed는 화면이 아니라
  // 칼럼 전체 높이를 기준으로 잡힌다). 데스크톱에선 앱 칼럼(.app-frame) 위치·폭에 맞춰 칼럼 안에서만 열린다.
  const measureFrame = useCallback(() => {
    const frame = document.querySelector<HTMLElement>(".app-frame");
    if (!frame) return setFrameBox({ left: 0, width: "100%" });
    const rect = frame.getBoundingClientRect();
    setFrameBox({ left: rect.left, width: rect.width });
  }, []);

  const openMenu = () => {
    measureFrame();
    setOpen(true);
  };
  const close = useCallback((returnFocus = false) => {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  }, []);

  // 열릴 때 현재(없으면 첫) 항목으로 포커스, 뒤 페이지 스크롤 잠금.
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const target =
      panel?.querySelector<HTMLElement>("[aria-current='page']") ?? panel?.querySelector<HTMLElement>("a, button");
    target?.focus();
    const root = document.documentElement;
    const prev = root.style.overflow;
    root.style.overflow = "hidden";
    return () => {
      root.style.overflow = prev;
    };
  }, [open]);

  // 열려 있는 동안만 Esc / 포커스 이탈 / ⌘K 팔레트 / 창 크기 변경에 반응한다.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close(true);
    };
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target as Node;
      if (!drawerRef.current?.contains(target) && !buttonRef.current?.contains(target)) close();
    };
    const onPalette = () => close();
    document.addEventListener("keydown", onKey);
    document.addEventListener("focusin", onFocusIn);
    window.addEventListener(COMMAND_OPEN_EVENT, onPalette);
    window.addEventListener("resize", measureFrame);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("focusin", onFocusIn);
      window.removeEventListener(COMMAND_OPEN_EVENT, onPalette);
      window.removeEventListener("resize", measureFrame);
    };
  }, [open, close, measureFrame]);

  // 다른 페이지로 이동하면 닫는다.
  useEffect(() => {
    // pathname이 바뀐 뒤 렌더에서 닫는다 — 링크 onClick에서도 닫지만 뒤로가기 등 다른 이동도 덮는다.
    const frame = requestAnimationFrame(() => setOpen(false));
    return () => cancelAnimationFrame(frame);
  }, [pathname]);

  const drawer = open
    ? createPortal(
        <div className="app-drawer" ref={drawerRef} style={frameBox}>
          <button type="button" className="app-drawer-scrim" aria-label="메뉴 닫기" tabIndex={-1} onClick={() => close(true)} />
          <nav id={menuId} ref={panelRef} className="app-drawer-panel" aria-label="주요 메뉴">
            <div className="app-drawer-head">
              <Link href="/" className="brand app-brand" onClick={() => close()}>
                <span className="brand-mark">TD</span>
                <span className="brand-name">TrendDrop</span>
              </Link>
              <button type="button" className="app-drawer-close" aria-label="메뉴 닫기" onClick={() => close(true)}>
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                </svg>
              </button>
            </div>

            {/* 계정 — 메뉴 맨 위. 로그인 전엔 이유가 붙은 로그인 버튼, 로그인 후엔 프로필과 로그아웃. */}
            {user ? (
              <div className="app-drawer-account">
                <span className="header-avatar" aria-hidden="true">
                  <AvatarFallback />
                  <span className="header-avatar-letter">{avatarLabel(user.name || user.email)}</span>
                </span>
                <span className="app-drawer-who">
                  <strong>{user.name || "TrendDrop 사용자"}</strong>
                  <span>{user.email.includes("@users.trenddrop.local") ? "카카오 계정" : user.email}</span>
                </span>
                <button type="button" className="app-drawer-logout" onClick={logout}>
                  로그아웃
                </button>
              </div>
            ) : (
              <div className="app-drawer-account is-guest">
                <p>로그인하면 관심 키워드를 어디서든 이어서 볼 수 있어요.</p>
                <Link href="/login" className="app-drawer-login" onClick={() => close()}>
                  로그인
                </Link>
              </div>
            )}

            <ul className="app-drawer-links">
              {navItems.map((item) => {
                const active = isActive(pathname, item.href);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={`app-menu-item${active ? " is-active" : ""}`}
                      aria-current={active ? "page" : undefined}
                      onClick={() => close()}
                    >
                      <span className="app-menu-icon">{item.icon}</span>
                      <span className="app-menu-label">{item.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>

            <div className="app-drawer-foot">
              <div className="app-drawer-setting">
                <span>화면 테마</span>
                <ThemeToggle />
              </div>
              <Link href="/privacy" className="app-drawer-fine" onClick={() => close()}>
                개인정보 처리방침
              </Link>
            </div>
          </nav>
        </div>,
        document.body,
      )
    : null;

  return (
    <header className="app-header">
      <div className="app-header-inner">
        {/* 햄버거는 왼쪽 위 — 계정·메뉴·테마가 전부 이 안에 있다. */}
        <button
          ref={buttonRef}
          type="button"
          className="app-menu-button"
          aria-label={open ? "메뉴 닫기" : "메뉴 열기"}
          aria-expanded={open}
          aria-controls={menuId}
          onClick={() => (open ? close() : openMenu())}
        >
          <span className={`app-menu-bars${open ? " is-open" : ""}`} aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
        </button>

        <Link href="/" className="brand app-brand">
          <span className="brand-mark">TD</span>
          <span className="app-brand-text">
            <span className="brand-name">TrendDrop</span>
            <span className="brand-sub">실시간 트렌드</span>
          </span>
        </Link>

        <button
          type="button"
          className="header-search"
          onClick={() => window.dispatchEvent(new Event(COMMAND_OPEN_EVENT))}
          aria-label="검색 열기"
          aria-keyshortcuts="Meta+K Control+K"
        >
          <span className="header-search-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" focusable="false">
              <circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" strokeWidth="2.2" />
              <path d="m15.5 15.5 5 5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
            </svg>
          </span>
          <span className="header-search-text">검색</span>
          <kbd className="header-search-kbd" aria-hidden="true">
            ⌘K
          </kbd>
        </button>
      </div>
      {drawer}
    </header>
  );
}
