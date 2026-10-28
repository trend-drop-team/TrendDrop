"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

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
  { href: "/docs", label: "문서", icon: DocsIcon },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function AppNav() {
  const pathname = usePathname() ?? "/";
  const [user, setUser] = useState<{ name?: string | null; email: string } | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);

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
    setProfileOpen(false);
    window.location.assign("/login");
  }

  const [open, setOpen] = useState(false);
  const menuId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);

  // 열릴 때 현재(없으면 첫) 항목으로 포커스를 옮긴다.
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const target =
      panel?.querySelector<HTMLElement>("[aria-current='page']") ??
      panel?.querySelector<HTMLElement>("a");
    target?.focus();
  }, [open]);

  // 열려 있는 동안만 Esc / 바깥 클릭 / 포커스 이탈 / ⌘K 팔레트 열림에 반응한다.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onFocusIn = (event: FocusEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onPalette = () => setOpen(false);
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("focusin", onFocusIn);
    window.addEventListener(COMMAND_OPEN_EVENT, onPalette);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("focusin", onFocusIn);
      window.removeEventListener(COMMAND_OPEN_EVENT, onPalette);
    };
  }, [open]);

  return (
    <header className="app-header">
      <div className="app-header-inner">
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
            ⌕
          </span>
          <span className="header-search-text">검색</span>
          <kbd className="header-search-kbd" aria-hidden="true">
            ⌘K
          </kbd>
        </button>

        <ThemeToggle />
          {user ? (
            <div className="header-profile-wrap">
              <button type="button" className="header-profile" aria-label="프로필 메뉴 열기" aria-expanded={profileOpen} onClick={() => { setOpen(false); setProfileOpen((v) => !v); }}>
                <span className="header-avatar" aria-hidden="true">
                <AvatarFallback />
                <span className="header-avatar-letter">{avatarLabel(user.name || user.email)}</span>
                </span>
              </button>
              {profileOpen && (
                <div className="profile-popover" role="dialog" aria-label="프로필 메뉴">
                  <strong>{user.name || "TrendDrop 사용자"}</strong>
                  <span className="profile-email">{user.email.includes("@users.trenddrop.local") ? "카카오 계정" : user.email}</span>
                  <button type="button" className="profile-logout" onClick={logout}>로그아웃</button>
                </div>
              )}
            </div>
          ) : <Link href="/login" className="header-login-link">로그인</Link>}

        <div className="app-menu" ref={wrapRef}>
          <button
            ref={buttonRef}
            type="button"
            className="app-menu-button"
            aria-label={open ? "메뉴 닫기" : "메뉴 열기"}
            aria-expanded={open}
            aria-controls={menuId}
            onClick={() => { setProfileOpen(false); setOpen((v) => !v); }}
          >
            <span className={`app-menu-bars${open ? " is-open" : ""}`} aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
          </button>

          <nav id={menuId} ref={panelRef} className="app-menu-panel" aria-label="주요 메뉴" hidden={!open}>
            {NAV_ITEMS.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`app-menu-item${active ? " is-active" : ""}`}
                  aria-current={active ? "page" : undefined}
                  onClick={() => setOpen(false)}
                >
                  <span className="app-menu-icon">{item.icon}</span>
                  <span className="app-menu-label">{item.label}</span>
                </Link>
              );
            })}
          </nav>
        </div>
      </div>
    </header>
  );
}
