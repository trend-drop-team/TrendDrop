/** API base URL shared by browser code and server-rendered pages. */
export function apiUrl(path: string): string {
  const configured = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "");
  const base = configured || (typeof window === "undefined" ? `http://localhost:${process.env.BACKEND_PORT ?? 4000}` : "");
  return `${base}${path}`;
}
