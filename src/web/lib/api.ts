import { getToken } from "./auth-storage";
import type {
  BatchAnswer,
  LeaderboardRow,
  Me,
  Prediction,
  PredictionBatch,
  Question,
} from "./types";

// The bearer token source. Dev mode reads the `dev:<name>` string from
// localStorage (the default below). Privy mode overrides this with the SDK's
// async getAccessToken() — see PrivyAuthProvider — since real Privy tokens are
// short-lived (~1h) and must be fetched fresh right before each request.
type TokenProvider = () => Promise<string | null>;
let getAuthToken: TokenProvider = async () => getToken();

export function setAuthTokenProvider(provider: TokenProvider): void {
  getAuthToken = provider;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await getAuthToken();
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(`/api${path}`, { ...init, headers });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      (body && typeof body === "object" && "error" in body && String(body.error)) ||
      `request failed: ${res.status}`;
    throw new Error(message);
  }
  return body as T;
}

export function fetchQuestions(): Promise<Question[]> {
  return request("/questions");
}

export function submitPredictionBatch(
  answers: BatchAnswer[],
): Promise<PredictionBatch[]> {
  return request("/predictions/batch", {
    method: "POST",
    body: JSON.stringify({ answers }),
  });
}

export function fetchMyPredictions(): Promise<
  (Prediction & { question: Partial<Question> & { fixtureId: string }; correct: boolean | null })[]
> {
  return request("/predictions");
}

export function fetchMe(): Promise<Me> {
  return request("/me");
}

export function updateDisplayName(displayName: string): Promise<Me> {
  return request("/me", {
    method: "PATCH",
    body: JSON.stringify({ displayName }),
  });
}

export function deleteAccount(): Promise<void> {
  return request("/me", { method: "DELETE" });
}

export function saveWalletAddress(address: string): Promise<{ walletAddress: string }> {
  return request("/wallet", {
    method: "POST",
    body: JSON.stringify({ address }),
  });
}

export function revokeDelegation(): Promise<{ delegationRevokedAt: string | null }> {
  return request("/wallet/delegation/revoke", { method: "POST" });
}

export function fetchLeaderboard(kind?: "human" | "agent"): Promise<LeaderboardRow[]> {
  return request(kind ? `/leaderboard?kind=${kind}` : "/leaderboard");
}

export function logout(): Promise<void> {
  return request("/logout", { method: "POST" });
}
