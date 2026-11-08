/**
 * TrendDrop UI 키트(#123). 새로 만들거나 손대는 화면부터 이걸로 바꾼다 — 한 번에 갈아엎지 않는다.
 * 스타일은 ./ui.css 한 파일, 색은 globals.css 토큰만. 미리보기는 /ui-kit(개발 환경 전용).
 */
import type { ButtonHTMLAttributes, ReactNode } from "react";

import "./ui.css";

function cx(...names: (string | false | null | undefined)[]): string {
  return names.filter(Boolean).join(" ");
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "primary" | "ghost";
  size?: "md" | "sm";
};

export function Button({ variant = "default", size = "md", className, type = "button", ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        "ui-btn",
        variant === "primary" && "ui-btn-primary",
        variant === "ghost" && "ui-btn-ghost",
        size === "sm" && "ui-btn-sm",
        className,
      )}
      {...rest}
    />
  );
}

type ChipProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-pressed"> & { selected?: boolean };

/** 선택형 칩(필터·관심 카테고리). 선택 상태는 aria-pressed로 — 색만으로 구분하지 않는다. */
export function Chip({ selected = false, className, type = "button", ...rest }: ChipProps) {
  return <button type={type} aria-pressed={selected} className={cx("ui-chip", className)} {...rest} />;
}

export function Card({ flat = false, className, children }: { flat?: boolean; className?: string; children: ReactNode }) {
  return <section className={cx("ui-card", flat && "ui-card-flat", className)}>{children}</section>;
}

type BadgeTone = "neutral" | "up" | "down" | "new";

export function Badge({ tone = "neutral", children }: { tone?: BadgeTone; children: ReactNode }) {
  return (
    <span
      className={cx(
        "ui-badge",
        tone === "up" && "ui-badge-up",
        tone === "down" && "ui-badge-down",
        tone === "new" && "ui-badge-new",
      )}
    >
      {children}
    </span>
  );
}

/**
 * 상승률 배지 — "+58%" / "-58%" 문자열을 받아 부호에 맞는 색·화살표로.
 * 홈·상세에서 하락률이 초록 ▲로 나오던 버그(부호를 지움)를 다시 만들지 않으려고 한 곳에 둔다.
 */
export function GrowthBadge({ growth }: { growth: string }) {
  const trimmed = growth.trim();
  const value = Number.parseFloat(trimmed.replace(/[^0-9.-]/g, ""));
  if (!Number.isFinite(value)) return <Badge>{trimmed || "-"}</Badge>;
  if (value === 0) return <Badge>0%</Badge>;
  const down = value < 0;
  return (
    <Badge tone={down ? "down" : "up"}>
      <span aria-hidden="true">{down ? "▼" : "▲"}</span>
      {down ? "−" : "+"}
      {Math.abs(value)}%<span className="sr-only">{down ? " 하락" : " 상승"}</span>
    </Badge>
  );
}

export function Stat({ value, label }: { value: ReactNode; label: string }) {
  return (
    <div className="ui-stat">
      <span className="ui-stat-value">{value}</span>
      <span className="ui-stat-label">{label}</span>
    </div>
  );
}

export function SectionTitle({ eyebrow, title, sub }: { eyebrow?: string; title: string; sub?: string }) {
  return (
    <header className="ui-section-title">
      {eyebrow && <p className="ui-section-eyebrow">{eyebrow}</p>}
      <h2 className="ui-section-heading">{title}</h2>
      {sub && <p className="ui-section-sub">{sub}</p>}
    </header>
  );
}
