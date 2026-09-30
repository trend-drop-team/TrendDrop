const PREFIX = "td-stale-cache:";

export type StaleCacheItem = {
  primary: string;
  secondary?: string;
  trailing?: string;
};

export type StaleCacheSummary = {
  heading: string;
  items: StaleCacheItem[];
};

type StoredCache = StaleCacheSummary & { savedAt: number };

/** 화면이 정상적으로 그려졌을 때만 호출된다 — 항상 클라이언트(useEffect)에서만 쓴다. */
export function saveStaleCache(key: string, summary: StaleCacheSummary): void {
  try {
    const payload: StoredCache = { ...summary, savedAt: Date.now() };
    window.localStorage.setItem(PREFIX + key, JSON.stringify(payload));
  } catch {
    // 시크릿 모드 등으로 localStorage가 막혀 있어도 앱은 그대로 동작해야 한다.
  }
}

export function readStaleCache(key: string): StoredCache | null {
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    return JSON.parse(raw) as StoredCache;
  } catch {
    return null;
  }
}

export function formatRelativeMinutes(savedAt: number): string {
  const minutes = Math.max(0, Math.round((Date.now() - savedAt) / 60000));
  if (minutes < 1) return "방금 전";
  if (minutes < 60) return `${minutes}분 전`;
  return `${Math.round(minutes / 60)}시간 전`;
}
