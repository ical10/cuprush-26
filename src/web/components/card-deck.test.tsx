import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CardDeck } from "./card-deck";
import { AuthProvider } from "../auth/auth-context";
import { clearToken, setToken } from "../lib/auth-storage";
import type { Question } from "../lib/types";

const { fetchQuestions, submitPredictionBatch } = vi.hoisted(() => ({
  fetchQuestions: vi.fn(),
  submitPredictionBatch: vi.fn(),
}));

vi.mock("../lib/api", () => ({ fetchQuestions, submitPredictionBatch }));

function question(id: string): Question {
  return {
    id,
    template: "winner",
    status: "open",
    result: null,
    opensAt: new Date().toISOString(),
    locksAt: new Date().toISOString(),
    settledAt: null,
    question: `Q ${id}?`,
    outcomes: ["yes", "no"],
    rule: {
      statKey1: "home.full_time.goals",
      statKey2: "away.full_time.goals",
      period: "full_time",
      operator: "subtract",
      comparison: "greater_than",
      threshold: 0,
      benchmarkValue: null,
    },
    fixture: {
      id: "fx-1",
      homeTeam: "A",
      awayTeam: "B",
      startsAt: new Date().toISOString(),
      gameState: "scheduled",
      stats: {},
    },
  };
}

function renderDeck() {
  setToken("dev:tester"); // authenticated: skip the sign-in gate
  return render(
    <AuthProvider>
      <CardDeck onNavigateAuth={() => {}} />
    </AuthProvider>,
  );
}

describe("CardDeck batching", () => {
  beforeEach(() => {
    fetchQuestions.mockReset();
    submitPredictionBatch.mockReset();
    clearToken();
  });

  it("answers every card locally without any network call until submit", async () => {
    fetchQuestions.mockResolvedValue([question("q1"), question("q2")]);
    submitPredictionBatch.mockResolvedValue({ chainStatus: "confirmed" });
    const user = userEvent.setup();
    renderDeck();

    await screen.findByText("Q q1?");
    await user.click(screen.getByRole("button", { name: "Yes" }));
    await screen.findByText("Q q2?");
    await user.click(screen.getByRole("button", { name: "No" }));

    // Deck exhausted, still zero network submissions.
    const submit = await screen.findByRole("button", { name: "Lock my picks" });
    expect(submitPredictionBatch).not.toHaveBeenCalled();

    await user.click(submit);
    await waitFor(() => expect(submitPredictionBatch).toHaveBeenCalledTimes(1));
    expect(submitPredictionBatch).toHaveBeenCalledWith([
      { questionId: "q1", outcome: "yes" },
      { questionId: "q2", outcome: "no" },
    ]);
  });

  it("keeps answers and offers retry when the batch submit fails", async () => {
    fetchQuestions.mockResolvedValue([question("q1")]);
    submitPredictionBatch.mockRejectedValueOnce(new Error("rpc down"));
    const user = userEvent.setup();
    renderDeck();

    await screen.findByText("Q q1?");
    await user.click(screen.getByRole("button", { name: "Yes" }));
    await user.click(await screen.findByRole("button", { name: "Lock my picks" }));

    // Failure surfaces the reason and a retry, answers preserved.
    await screen.findByText(/rpc down/);
    submitPredictionBatch.mockResolvedValueOnce({ chainStatus: "confirmed" });
    await user.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(submitPredictionBatch).toHaveBeenCalledTimes(2));
    expect(submitPredictionBatch).toHaveBeenLastCalledWith([
      { questionId: "q1", outcome: "yes" },
    ]);
  });

  it("renders the action rail outside the draggable card, No left and Yes right", async () => {
    fetchQuestions.mockResolvedValue([question("q1")]);
    renderDeck();

    await screen.findByText("Q q1?");
    const rail = screen.getByRole("group", { name: "Answer this question" });
    const buttons = within(rail).getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual(["No", "Yes"]);

    // The rail never moves with the card: no button lives inside it.
    const card = screen.getByTestId("question-card");
    expect(card).not.toContainElement(buttons[0]!);
    expect(card).not.toContainElement(buttons[1]!);
    expect(within(card).queryByRole("button")).not.toBeInTheDocument();
  });

  it("disables the rail and the card while the sign-in gate is open", async () => {
    fetchQuestions.mockResolvedValue([question("q1")]);
    const user = userEvent.setup();
    // No token: answering opens the save prompt instead of recording.
    render(
      <AuthProvider>
        <CardDeck onNavigateAuth={() => {}} />
      </AuthProvider>,
    );

    await screen.findByText("Q q1?");
    await user.click(screen.getByRole("button", { name: "Yes" }));
    await screen.findByText(/Save your pick/);

    // The modal hides the page from the a11y tree, hence hidden: true.
    const rail = screen.getByRole("group", { name: "Answer this question", hidden: true });
    for (const button of within(rail).getAllByRole("button", { hidden: true })) {
      expect(button).toBeDisabled();
    }
  });
});
