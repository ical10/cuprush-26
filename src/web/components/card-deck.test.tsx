import { act } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CardDeck } from "./card-deck";
import { AuthProvider } from "../auth/auth-context";
import { clearToken, setToken } from "../lib/auth-storage";
import type { Question } from "../lib/types";

const { fetchQuestions, fetchMyPredictions, submitPredictionBatch } = vi.hoisted(() => ({
  fetchQuestions: vi.fn(),
  fetchMyPredictions: vi.fn(),
  submitPredictionBatch: vi.fn(),
}));

vi.mock("../lib/api", () => ({ fetchQuestions, fetchMyPredictions, submitPredictionBatch }));

function question(id: string, overrides: Partial<Question> = {}): Question {
  return {
    id,
    template: "winner",
    status: "open",
    result: null,
    opensAt: new Date().toISOString(),
    // Open questions lock in the future; lock-handling tests override this.
    locksAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
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
    ...overrides,
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

// framer-motion recognizes drags and runs exit animations inside its own
// rAF-batched frame scheduler — frames must actually tick for a release to
// register or an exiting card to leave the DOM (see question-card.test.tsx).
const nextFrame = () =>
  act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));

async function swipe(card: HTMLElement, dx: number) {
  const opts = { pointerId: 1, isPrimary: true, pointerType: "mouse" as const };
  fireEvent.pointerDown(card, { ...opts, clientX: 0, clientY: 0, buttons: 1 });
  fireEvent.pointerMove(window, { ...opts, clientX: dx, clientY: 0, buttons: 1 });
  await nextFrame();
  fireEvent.pointerUp(window, { ...opts, clientX: dx, clientY: 0, buttons: 0 });
  await nextFrame();
}

// Ticks frames until the committed card's exit animation finishes and
// AnimatePresence removes it (bounded so a regression fails, not hangs).
async function exitToFinish(text: string) {
  for (let i = 0; i < 200 && screen.queryByText(text); i++) await nextFrame();
}

describe("CardDeck batching", () => {
  beforeEach(() => {
    fetchQuestions.mockReset();
    submitPredictionBatch.mockReset();
    fetchMyPredictions.mockReset();
    fetchMyPredictions.mockResolvedValue([]);
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

    // Picks are saved immediately; the on-chain lock is deferred to kickoff.
    expect(
      await screen.findByText("Saved. Locks on Solana before kickoff."),
    ).toBeInTheDocument();
  });

  it("hides questions the user already predicted (no reappearing after refresh)", async () => {
    fetchQuestions.mockResolvedValue([question("q1"), question("q2")]);
    // q1 was already locked in a prior session — it must not reappear.
    fetchMyPredictions.mockResolvedValue([{ questionId: "q1" }]);
    renderDeck();

    // Deck opens on q2, and q1 is nowhere in it.
    await screen.findByText("Q q2?");
    expect(screen.queryByText("Q q1?")).not.toBeInTheDocument();
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

  // Regression: the card component used to be reused across questions (no
  // key), so the next card inherited the previous swipe's drag offset and
  // in-flight exit animation — it slid in from wherever the last card left
  // (or kept tracking the cursor) instead of snapping to center.
  it("mounts the next card centered after a swipe instead of inheriting the drag offset", async () => {
    fetchQuestions.mockResolvedValue([question("q1"), question("q2")]);
    renderDeck();

    const firstCard = (await screen.findByText("Q q1?")).closest(
      "[data-testid=question-card]",
    ) as HTMLElement;
    await swipe(firstCard, 150);

    // A fresh instance per question: a new element with no leftover offset.
    const nextCard = (await screen.findByText("Q q2?")).closest(
      "[data-testid=question-card]",
    ) as HTMLElement;
    expect(nextCard).not.toBe(firstCard);
    expect(nextCard.getAttribute("style") ?? "").not.toMatch(/translateX\((?!0px\))/);

    // The swiped card flies out and leaves the DOM instead of morphing into q2.
    await exitToFinish("Q q1?");
    expect(screen.queryByText("Q q1?")).not.toBeInTheDocument();
  });

  it("hands the pending answer to the shell when a guest signs in to save", async () => {
    fetchQuestions.mockResolvedValue([question("q1"), question("q2")]);
    const onNavigateAuth = vi.fn();
    const user = userEvent.setup();
    // No token: the first answer opens the gate instead of recording.
    render(
      <AuthProvider>
        <CardDeck onNavigateAuth={onNavigateAuth} />
      </AuthProvider>,
    );

    await screen.findByText("Q q1?");
    await user.click(screen.getByRole("button", { name: "Yes" }));
    await user.click(await screen.findByRole("button", { name: "Sign in to save" }));

    // The pick rides out to the shell instead of a stale replay closure.
    expect(onNavigateAuth).toHaveBeenCalledWith({ questionId: "q1", outcome: "yes" });
  });

  it("replays the lifted answer once on remount, skipping that card without a network call", async () => {
    fetchQuestions.mockResolvedValue([question("q1"), question("q2")]);
    submitPredictionBatch.mockResolvedValue({ chainStatus: "confirmed" });
    const user = userEvent.setup();
    // The remounted deck is signed in (auth just completed).
    setToken("dev:tester");
    const onConsumed = vi.fn();

    const first = render(
      <AuthProvider>
        <CardDeck
          onNavigateAuth={() => {}}
          initialAnswer={{ questionId: "q1", outcome: "yes" }}
          onInitialAnswerConsumed={onConsumed}
        />
      </AuthProvider>,
    );

    // q1 is recorded silently and skipped: the deck opens on q2. The replayed
    // card plays its exit first, then leaves the DOM for good.
    await screen.findByText("Q q2?");
    await exitToFinish("Q q1?");
    expect(screen.queryByText("Q q1?")).not.toBeInTheDocument();
    expect(onConsumed).toHaveBeenCalledTimes(1);
    expect(submitPredictionBatch).not.toHaveBeenCalled();

    // The replayed pick sits in the same local batch as a normal swipe.
    await user.click(screen.getByRole("button", { name: "No" }));
    await user.click(await screen.findByRole("button", { name: "Lock my picks" }));
    await waitFor(() => expect(submitPredictionBatch).toHaveBeenCalledTimes(1));
    expect(submitPredictionBatch).toHaveBeenCalledWith([
      { questionId: "q1", outcome: "yes" },
      { questionId: "q2", outcome: "no" },
    ]);

    // A later remount without the prop (shell already cleared it) starts fresh.
    first.unmount();
    submitPredictionBatch.mockClear();
    render(
      <AuthProvider>
        <CardDeck onNavigateAuth={() => {}} />
      </AuthProvider>,
    );
    await screen.findByText("Q q1?");
    expect(submitPredictionBatch).not.toHaveBeenCalled();
  });

  it("recovers from a batch 409 by pruning locked answers and re-arming submit", async () => {
    fetchQuestions.mockResolvedValueOnce([question("q1"), question("q2")]);
    const user = userEvent.setup();
    renderDeck();

    await screen.findByText("Q q1?");
    await user.click(screen.getByRole("button", { name: "Yes" }));
    await screen.findByText("Q q2?");
    await user.click(screen.getByRole("button", { name: "No" }));

    // q1 locked server-side mid-session: the whole batch 409s, and the
    // refetch shows q1 gone from the open set while q2 is still open.
    submitPredictionBatch.mockRejectedValueOnce(
      new Error("predictions are locked for this batch"),
    );
    fetchQuestions.mockResolvedValueOnce([
      question("q1", { status: "locked", locksAt: new Date(Date.now() - 1000).toISOString() }),
      question("q2"),
    ]);
    await user.click(await screen.findByRole("button", { name: "Lock my picks" }));

    // The doomed pick is dropped with a plain explanation, not an error loop.
    await screen.findByText(
      "1 pick locked before it was saved and was removed. 1 pick is still open — lock it in now.",
    );

    // The re-armed submit sends only the surviving answer.
    submitPredictionBatch.mockResolvedValueOnce([{ chainStatus: "pending" }]);
    await user.click(screen.getByRole("button", { name: "Lock my picks" }));
    await waitFor(() => expect(submitPredictionBatch).toHaveBeenCalledTimes(2));
    expect(submitPredictionBatch).toHaveBeenLastCalledWith([
      { questionId: "q2", outcome: "no" },
    ]);
    await screen.findByText("Saved. Locks on Solana before kickoff.");
  });

  it("states honestly when every answer locked before it could be saved", async () => {
    fetchQuestions.mockResolvedValueOnce([question("q1")]);
    const user = userEvent.setup();
    renderDeck();

    await screen.findByText("Q q1?");
    await user.click(screen.getByRole("button", { name: "Yes" }));

    submitPredictionBatch.mockRejectedValueOnce(
      new Error("predictions are locked for this batch"),
    );
    fetchQuestions.mockResolvedValueOnce([
      question("q1", { status: "locked", locksAt: new Date(Date.now() - 1000).toISOString() }),
    ]);
    await user.click(await screen.findByRole("button", { name: "Lock my picks" }));

    await screen.findByText(
      "All picks locked before they were saved — new cards open closer to kickoff.",
    );
    // Nothing survives, so there is nothing to resubmit.
    expect(submitPredictionBatch).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Lock my picks" })).toBeDisabled();
  });

  it("pre-filters answers already past locksAt before the batch leaves the client", async () => {
    // q2's lock passes while the user answers — the server would 409 the batch.
    fetchQuestions.mockResolvedValue([
      question("q1"),
      question("q2", { locksAt: new Date(Date.now() - 1000).toISOString() }),
    ]);
    const user = userEvent.setup();
    renderDeck();

    await screen.findByText("Q q1?");
    await user.click(screen.getByRole("button", { name: "Yes" }));
    await screen.findByText("Q q2?");
    await user.click(screen.getByRole("button", { name: "No" }));
    await user.click(await screen.findByRole("button", { name: "Lock my picks" }));

    // The locked pick never reaches the network; the user is told plainly.
    await screen.findByText(
      "1 pick locked before it was saved and was removed. 1 pick is still open — lock it in now.",
    );
    expect(submitPredictionBatch).not.toHaveBeenCalled();

    submitPredictionBatch.mockResolvedValueOnce([{ chainStatus: "pending" }]);
    await user.click(screen.getByRole("button", { name: "Lock my picks" }));
    await waitFor(() => expect(submitPredictionBatch).toHaveBeenCalledTimes(1));
    expect(submitPredictionBatch).toHaveBeenCalledWith([{ questionId: "q1", outcome: "yes" }]);
  });

  it("softens the wallet-not-ready 400 into a retryable message", async () => {
    fetchQuestions.mockResolvedValue([question("q1")]);
    submitPredictionBatch.mockRejectedValueOnce(
      new Error("a wallet is required before saving predictions"),
    );
    const user = userEvent.setup();
    renderDeck();

    await screen.findByText("Q q1?");
    await user.click(screen.getByRole("button", { name: "Yes" }));
    await user.click(await screen.findByRole("button", { name: "Lock my picks" }));

    await screen.findByText(
      "Your wallet is still being set up — this usually takes a few seconds. Retry in a moment.",
    );
    // Retry stays available and genuinely likely to succeed.
    submitPredictionBatch.mockResolvedValueOnce([{ chainStatus: "pending" }]);
    await user.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(submitPredictionBatch).toHaveBeenCalledTimes(2));
  });

  it("softens the 429 rate limit into wait-and-retry copy", async () => {
    fetchQuestions.mockResolvedValue([question("q1")]);
    submitPredictionBatch.mockRejectedValueOnce(new Error("too many submissions, slow down"));
    const user = userEvent.setup();
    renderDeck();

    await screen.findByText("Q q1?");
    await user.click(screen.getByRole("button", { name: "Yes" }));
    await user.click(await screen.findByRole("button", { name: "Lock my picks" }));

    await screen.findByText("Too many attempts — wait a minute and retry.");
  });

  it("drops a mid-session locked card from the remaining deck on the 30s sweep", async () => {
    // q2's locksAt has passed but its status still says open (server lag):
    // the deck shows it until the sweep catches up.
    fetchQuestions.mockResolvedValue([
      question("q1"),
      question("q2", { locksAt: new Date(Date.now() - 1000).toISOString() }),
      question("q3"),
    ]);
    const intervalSpy = vi.spyOn(window, "setInterval");
    try {
      renderDeck();
      await screen.findByText("Q q1?");
      expect(screen.getByText("Card 1 of 3")).toBeInTheDocument();

      // Fire the 30s sweep without waiting 30s of wall clock.
      const sweep = intervalSpy.mock.calls.find(([, delay]) => delay === 30_000)?.[0] as
        | (() => void)
        | undefined;
      expect(sweep).toBeDefined();
      act(() => sweep!());

      // The current card is untouched; the locked upcoming card is gone.
      await screen.findByText("1 card locked at kickoff and was removed.");
      expect(screen.getByText("Card 1 of 2")).toBeInTheDocument();
      expect(screen.getByText("Q q1?")).toBeInTheDocument();
    } finally {
      intervalSpy.mockRestore();
    }
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
