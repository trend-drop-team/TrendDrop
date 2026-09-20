import { apiUrl } from "@/lib/api-url";

export async function fetchApi<T>(path: string): Promise<T> {
  const response = await fetch(apiUrl(path), { cache: "no-store" });

  if (!response.ok) {
    let message = `API request failed: ${response.status}`;
    try {
      const payload = (await response.json()) as { error?: string };
      if (payload.error) message = payload.error;
    } catch {
      // Keep the status-based message when the API response is not JSON.
    }
    const error = new Error(message);
    error.name = response.status === 404 ? "NotFoundError" : "ApiError";
    throw error;
  }

  return response.json() as Promise<T>;
}
