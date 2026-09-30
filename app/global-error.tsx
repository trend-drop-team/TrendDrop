"use client";

/**
 * 최후의 에러 바운더리 — 루트 레이아웃(app/layout.tsx)에서 난 에러만 여기까지 온다.
 *
 * App Router 규약상 `app/error.tsx`는 **같은 세그먼트의 layout에서 난 에러를 잡지 못한다.**
 * 루트 레이아웃이 던지면 error.tsx를 건너뛰고 Next 기본 500 셸이 그대로 나간다.
 * 그래서 layout이 쓰는 데이터는 fetchApiOr로 던지지 않게 막아 뒀고, 이 파일은 그래도
 * 새는 경우(렌더 자체의 예외 등)를 받는 그물이다.
 *
 * 루트 레이아웃을 대체하는 자리라 <html>/<body>를 직접 들고 있어야 한다.
 * globals.css가 적용되지 않을 수 있으므로 최소한의 인라인 스타일만 쓴다.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="ko">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          background: "#0d0f14",
          color: "#e7e9ee",
          fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
          padding: "24px",
        }}
      >
        <main style={{ maxWidth: "420px", textAlign: "center" }}>
          <h1 style={{ fontSize: "1.25rem", margin: "0 0 12px" }}>
            화면을 여는 데 문제가 생겼습니다
          </h1>
          <p style={{ margin: "0 0 20px", lineHeight: 1.6, color: "#9aa1ae" }}>
            잠깐 뒤에 다시 시도하면 대부분 복구됩니다.
            {error.digest && (
              <>
                <br />
                오류 번호: {error.digest}
              </>
            )}
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              padding: "12px 20px",
              borderRadius: "999px",
              border: "none",
              background: "#ff6b2c",
              color: "#fff",
              fontSize: "0.95rem",
              cursor: "pointer",
            }}
          >
            다시 시도
          </button>
        </main>
      </body>
    </html>
  );
}
