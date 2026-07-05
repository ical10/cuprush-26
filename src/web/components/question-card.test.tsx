import { fireEvent, render, screen } from "@testing-library/react";
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

  const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

  // framer-motion recognizes a drag (sets its internal `startEvent`) inside
  // its own rAF-batched frame scheduler, not synchronously on pointermove —
  // a frame must actually tick between the move and the pointerup, or the
  // release is treated as a plain click with no drag ever having started.
  async function drag(card: HTMLElement, dx: number) {
    const opts = { pointerId: 1, isPrimary: true, pointerType: "mouse" as const };
    fireEvent.pointerDown(card, { ...opts, clientX: 0, clientY: 0, buttons: 1 });
    fireEvent.pointerMove(window, { ...opts, clientX: dx, clientY: 0, buttons: 1 });
    await nextFrame();
    fireEvent.pointerUp(window, { ...opts, clientX: dx, clientY: 0, buttons: 0 });
    // onDragEnd is invoked via frame.postRender, a separate queue from the
    // frame.update used for drag recognition — needs its own tick to flush.
    await nextFrame();
  }

  it("commits an outcome from a drag past the threshold, not just the button fallback", async () => {
    const onAnswer = vi.fn();
    render(<QuestionCard question={question} onAnswer={onAnswer} />);
    await drag(screen.getByTestId("question-card"), 150);
    expect(onAnswer).toHaveBeenCalledWith("Yes");
  });

  it("does not commit a small, slow drag under the threshold", async () => {
    const onAnswer = vi.fn();
    render(<QuestionCard question={question} onAnswer={onAnswer} />);
    const opts = { pointerId: 1, isPrimary: true, pointerType: "mouse" as const };
    const card = screen.getByTestId("question-card");

    // Velocity is distance/elapsed-time, so a genuinely slow drag needs real
    // wall-clock time between move and release, not just animation-frame
    // ticks (those don't imply elapsed time on their own in jsdom).
    fireEvent.pointerDown(card, { ...opts, clientX: 0, clientY: 0, buttons: 1 });
    fireEvent.pointerMove(window, { ...opts, clientX: 20, clientY: 0, buttons: 1 });
    await nextFrame();
    await new Promise((resolve) => setTimeout(resolve, 300));
    fireEvent.pointerMove(window, { ...opts, clientX: 20, clientY: 0, buttons: 1 });
    await nextFrame();
    fireEvent.pointerUp(window, { ...opts, clientX: 20, clientY: 0, buttons: 0 });
    await nextFrame();

    expect(onAnswer).not.toHaveBeenCalled();
  });
});
