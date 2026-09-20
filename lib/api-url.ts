/** Browser API base URL. Empty means same-origin Next.js API routes for local compatibility. */
export function apiUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ?? "";
  return `${base}${path}`;
}
