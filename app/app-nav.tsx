"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { COMMAND_OPEN_EVENT } from "./command-palette";
import ThemeToggle from "./theme-toggle";

type NavItem = {
  href: string;
  label: string;
  icon: ReactNode;
};

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

  return (
    <>
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
        </div>
      </header>

      <nav className="app-tabbar" aria-label="주요 메뉴">
        {NAV_ITEMS.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`app-tab${active ? " is-active" : ""}`}
              aria-current={active ? "page" : undefined}
            >
              <span className="app-tab-icon">{item.icon}</span>
              <span className="app-tab-label">{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}
