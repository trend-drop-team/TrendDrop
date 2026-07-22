"use client";

import { useState } from "react";

export default function CollectionControls() {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  async function collect() {
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/collect/pipeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ geo: "KR", limit: 10 }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail ?? payload.error ?? "수집에 실패했습니다.");
      setMessage(`${payload.selected}개 키워드 수집 완료`);
      window.location.reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "수집에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="collection-controls">
      <button className="primary-button" type="button" onClick={collect} disabled={loading}>
        {loading ? "수집 중..." : "최신 트렌드 수집"}
      </button>
      <a className="secondary-button link-button" href="/collection-log">
        수집 기록 보기
      </a>
      {message && <span className="collection-message">{message}</span>}
    </div>
  );
}
