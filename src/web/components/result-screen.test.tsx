import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ResultScreen } from "./result-screen";
import type { Me, Prediction, Question } from "../lib/types";

const { fetchMe, fetchMyPredictions } = vi.hoisted(() => ({
  fetchMe: vi.fn(),
  fetchMyPredictions: vi.fn(),
}));

vi.mock("../lib/api", () => ({ fetchMe, fetchMyPredictions }));

const SETTLEMENT_SIG = "5SettleSigExample1111111111111111111111111111";
const MEMO_SIG = "4MemoSigExample22222222222222222222222222222";

const me: Me = {
  displayName: "Husni",
  points: 3,
  currentStreak: 1,
  bestStreak: 2,
  walletAddress: null,
};

type MyPrediction = Prediction & { question: Question; correct: boolean | null };

function settledPrediction(
  overrides: Partial<MyPrediction> = {},
  question: Partial<Question> = {},
): MyPrediction {
  const id = crypto.randomUUID();
  return {
    id,
    questionId: `q-${id}`,
    outcome: "yes",
    chainStatus: "confirmed",
    signature: null,
    submittedAt: null,
    confirmedAt: null,
    correct: true,
    ...overrides,
    question: {
      id: `q-${id}`,
      template: "winner",
      status: "settled",
      result: "yes",
      opensAt: "2026-06-01T00:00:00Z",
      locksAt: "2026-06-01T12:00:00Z",
      settledAt: "2026-06-01T15:00:00Z",
      settlementSignature: null,
      question: "Argentina to win?",
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
        homeTeam: "Argentina",
        awayTeam: "France",
        startsAt: "2026-06-01T13:00:00Z",
        gameState: "finished",
        stats: {},
      },
      ...question,
    },
  };
}

describe("ResultScreen explorer links", () => {
  beforeEach(() => {
    fetchMe.mockReset().mockResolvedValue(me);
    fetchMyPredictions.mockReset();
  });

  it("links settled cards to the settlement tx on Solana Explorer (devnet)", async () => {
    fetchMyPredictions.mockResolvedValue([
      settledPrediction(
        { signature: MEMO_SIG },
        { settlementSignature: SETTLEMENT_SIG },
      ),
    ]);
    render(<ResultScreen />);

    const link = await screen.findByRole("link", { name: /View on Solana Explorer/ });
    expect(link).toHaveAttribute(
      "href",
      `https://explorer.solana.com/tx/${SETTLEMENT_SIG}?cluster=devnet`,
    );
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toContain("noopener");

    const memo = screen.getByRole("link", { name: /Batch memo/ });
    expect(memo).toHaveAttribute(
      "href",
      `https://explorer.solana.com/tx/${MEMO_SIG}?cluster=devnet`,
    );
  });

  it("links older list cards to their settlement tx too", async () => {
    fetchMyPredictions.mockResolvedValue([
      settledPrediction({}, { settledAt: "2026-06-02T15:00:00Z" }),
      settledPrediction({}, { settlementSignature: SETTLEMENT_SIG }),
    ]);
    render(<ResultScreen />);

    const links = await screen.findAllByRole("link", { name: /View on Solana Explorer/ });
    expect(links).toHaveLength(1);
  });

  it("renders no explorer link for void or signature-less cards", async () => {
    fetchMyPredictions.mockResolvedValue([
      settledPrediction(
        { signature: MEMO_SIG, correct: null },
        { status: "void", result: null, settledAt: null, settlementSignature: SETTLEMENT_SIG },
      ),
      settledPrediction({}, { settlementSignature: null }),
    ]);
    render(<ResultScreen />);

    await screen.findAllByText("Argentina to win?");
    expect(screen.queryByRole("link", { name: /Solana Explorer|Batch memo/ })).toBeNull();
  });
});
