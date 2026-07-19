import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LeaderboardScreen } from "./leaderboard-screen";
import { AuthProvider } from "../auth/auth-context";
import { clearToken } from "../lib/auth-storage";
import type { LeaderboardRow } from "../lib/types";

const { fetchLeaderboard, fetchMe } = vi.hoisted(() => ({
  fetchLeaderboard: vi.fn(),
  fetchMe: vi.fn(),
}));

vi.mock("../lib/api", () => ({ fetchLeaderboard, fetchMe }));

function row(overrides: Partial<LeaderboardRow> = {}): LeaderboardRow {
  return {
    displayName: "Fan One",
    points: 10,
    currentStreak: 1,
    bestStreak: 1,
    kind: "human",
    cohortName: null,
    ...overrides,
  };
}

function renderScreen() {
  clearToken(); // unauthenticated: fetchMe never fires
  return render(
    <AuthProvider>
      <LeaderboardScreen />
    </AuthProvider>,
  );
}

describe("LeaderboardScreen", () => {
  beforeEach(() => {
    fetchLeaderboard.mockReset();
    fetchMe.mockReset();
    fetchLeaderboard.mockResolvedValue([]);
  });

  it("renders an AI badge for agent rows and no badge for human rows", async () => {
    fetchLeaderboard.mockResolvedValue([
      row({ displayName: "Fan One", kind: "human" }),
      row({ displayName: "Form Hawk", kind: "agent", cohortName: "Hermes Cohort" }),
    ]);
    renderScreen();

    await waitFor(() => expect(screen.getByText("Form Hawk")).toBeInTheDocument());

    const agentRow = screen.getByText("Form Hawk").closest("tr")!;
    expect(agentRow.querySelector(".kind-badge-ai")).not.toBeNull();
    expect(agentRow).toHaveTextContent("AI");

    const humanRow = screen.getByText("Fan One").closest("tr")!;
    expect(humanRow.querySelector(".kind-badge-ai")).toBeNull();
  });

  it("shows the AI badge in the Overall view — never presents an agent as human", async () => {
    fetchLeaderboard.mockResolvedValue([
      row({ displayName: "Form Hawk", kind: "agent", cohortName: "Hermes Cohort" }),
    ]);
    renderScreen();

    await waitFor(() => expect(screen.getByText("Form Hawk")).toBeInTheDocument());
    expect(fetchLeaderboard).toHaveBeenCalledWith(undefined);
    expect(screen.getByText("Form Hawk").closest("tr")!.querySelector(".kind-badge-ai")).not
      .toBeNull();
  });

  it("defaults to the Overall tab selected", async () => {
    renderScreen();
    await waitFor(() => expect(fetchLeaderboard).toHaveBeenCalled());
    expect(screen.getByRole("tab", { name: "Overall" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("switches to Humans and calls the API with kind=human", async () => {
    renderScreen();
    await waitFor(() => expect(fetchLeaderboard).toHaveBeenCalledWith(undefined));

    await userEvent.click(screen.getByRole("tab", { name: "Humans" }));

    await waitFor(() => expect(fetchLeaderboard).toHaveBeenCalledWith("human"));
    expect(screen.getByRole("tab", { name: "Humans" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tab", { name: "Overall" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
  });

  it("switches to AI and calls the API with kind=agent", async () => {
    renderScreen();
    await waitFor(() => expect(fetchLeaderboard).toHaveBeenCalledWith(undefined));

    await userEvent.click(screen.getByRole("tab", { name: "AI" }));

    await waitFor(() => expect(fetchLeaderboard).toHaveBeenCalledWith("agent"));
    expect(screen.getByRole("tab", { name: "AI" })).toHaveAttribute("aria-selected", "true");
  });

  it("drops a stale response that lands after a newer filter's response", async () => {
    let resolveOverall!: (rows: LeaderboardRow[]) => void;
    fetchLeaderboard.mockImplementationOnce(
      () =>
        new Promise<LeaderboardRow[]>((resolve) => {
          resolveOverall = resolve;
        }),
    );
    fetchLeaderboard.mockResolvedValueOnce([row({ displayName: "Fast Human" })]);
    renderScreen();

    await userEvent.click(screen.getByRole("tab", { name: "Humans" }));
    await waitFor(() => expect(screen.getByText("Fast Human")).toBeInTheDocument());

    // The slow Overall response lands last — it must not replace the rows.
    resolveOverall([row({ displayName: "Slow Overall" })]);
    await waitFor(() => expect(screen.getByText("Fast Human")).toBeInTheDocument());
    expect(screen.queryByText("Slow Overall")).not.toBeInTheDocument();
  });

  it("shows a retry action on fetch failure instead of the empty state, and retries", async () => {
    fetchLeaderboard.mockRejectedValueOnce(new Error("network down"));
    fetchLeaderboard.mockResolvedValueOnce([row({ displayName: "After Retry" })]);
    renderScreen();

    await waitFor(() =>
      expect(screen.getByText("Couldn't load the leaderboard.")).toBeInTheDocument(),
    );
    expect(screen.queryByText(/No fans on the board yet/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.getByText("After Retry")).toBeInTheDocument());
    expect(screen.queryByText("Couldn't load the leaderboard.")).not.toBeInTheDocument();
  });
});
