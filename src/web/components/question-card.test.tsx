import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { QuestionCard } from "./question-card";
import type { Question } from "../lib/types";

const question: Question = {
  id: "q-1",
  template: "winner",
  status: "open",
  result: null,
  opensAt: new Date().toISOString(),
  locksAt: new Date().toISOString(),
  settledAt: null,
  question: "Will Argentina score more goals than Brazil?",
  outcomes: ["Yes", "No"],
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
    awayTeam: "Brazil",
    startsAt: new Date().toISOString(),
    gameState: "scheduled",
    stats: {},
  },
};

describe("QuestionCard", () => {
  it("renders the question text and both outcome labels as text, never colour alone", () => {
    render(<QuestionCard question={question} onAnswer={() => {}} />);
    expect(screen.getByText(question.question)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Yes" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "No" })).toBeInTheDocument();
  });

  it("answers via the button fallback without any drag gesture", async () => {
    const onAnswer = vi.fn();
    render(<QuestionCard question={question} onAnswer={onAnswer} />);
    await userEvent.click(screen.getByRole("button", { name: "Yes" }));
    expect(onAnswer).toHaveBeenCalledWith("Yes");
  });

  it("answers via keyboard activation (Enter) on the outcome button", async () => {
    const onAnswer = vi.fn();
    render(<QuestionCard question={question} onAnswer={onAnswer} />);
    const button = screen.getByRole("button", { name: "No" });
    button.focus();
    await userEvent.keyboard("{Enter}");
    expect(onAnswer).toHaveBeenCalledWith("No");
  });

  it("disables the outcome buttons while a save is in flight", () => {
    render(<QuestionCard question={question} onAnswer={() => {}} disabled />);
    expect(screen.getByRole("button", { name: "Yes" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "No" })).toBeDisabled();
  });
});
