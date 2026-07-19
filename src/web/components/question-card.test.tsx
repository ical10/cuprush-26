import { act } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
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
  it("renders the fixture, the question, and both directional cue labels as text", () => {
    render(<QuestionCard question={question} onAnswer={() => true} />);
    expect(screen.getByText("Argentina vs Brazil")).toBeInTheDocument();
    expect(screen.getByText(question.question)).toBeInTheDocument();
    // Swipe cues mirror the rail: No on the left, Yes on the right.
    expect(screen.getByText(/No/)).toBeInTheDocument();
    expect(screen.getByText(/Yes/)).toBeInTheDocument();
  });

  it("contains no outcome buttons — those live in the deck's action rail", () => {
    render(<QuestionCard question={question} onAnswer={() => true} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  // framer-motion recognizes a drag (sets its internal `startEvent`) inside
  // its own rAF-batched frame scheduler, not synchronously on pointermove —
  // a frame must actually tick between the move and the pointerup, or the
  // release is treated as a plain click with no drag ever having started.
  // Wrapped in act() because the frame also flushes drag-driven React state
  // (the threshold reveal).
  const nextFrame = () =>
    act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));

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

  it("commits an outcome from a drag past the threshold", async () => {
    const onAnswer = vi.fn();
    render(<QuestionCard question={question} onAnswer={onAnswer} />);
    await drag(screen.getByTestId("question-card"), 150);
    expect(onAnswer).toHaveBeenCalledWith("Yes");
    expect(onAnswer).toHaveBeenCalledTimes(1);
  });

  it("commits the left outcome from a drag past the threshold to the left", async () => {
    const onAnswer = vi.fn();
    render(<QuestionCard question={question} onAnswer={onAnswer} />);
    await drag(screen.getByTestId("question-card"), -150);
    expect(onAnswer).toHaveBeenCalledWith("No");
  });

  it("ignores drags while disabled during a save", async () => {
    const onAnswer = vi.fn();
    render(<QuestionCard question={question} onAnswer={onAnswer} disabled />);
    await drag(screen.getByTestId("question-card"), 150);
    expect(onAnswer).not.toHaveBeenCalled();
  });

  // Regression: a guest's swipe reports the outcome but the deck doesn't
  // advance (sign-in gate). The card must stay visible and draggable
  // instead of playing an exit animation into permanent invisibility.
  it("stays visible and re-draggable after a drag onAnswer declines (guest sign-in gate)", async () => {
    const onAnswer = vi.fn().mockReturnValue(false);
    render(<QuestionCard question={question} onAnswer={onAnswer} />);
    const card = screen.getByTestId("question-card");
    await drag(card, 150);
    expect(onAnswer).toHaveBeenCalledWith("Yes");
    expect(card).toHaveStyle({ opacity: "1" });
    expect(card.getAttribute("style") ?? "").not.toContain("translateX(600px)");
  });

  it("reveals the would-be outcome only after the drag crosses the threshold", async () => {
    render(<QuestionCard question={question} onAnswer={() => true} />);
    const card = screen.getByTestId("question-card");
    const opts = { pointerId: 1, isPrimary: true, pointerType: "mouse" as const };

    fireEvent.pointerDown(card, { ...opts, clientX: 0, clientY: 0, buttons: 1 });
    fireEvent.pointerMove(window, { ...opts, clientX: 40, clientY: 0, buttons: 1 });
    await nextFrame();
    // Below the commit threshold: no label, no semantic colour.
    expect(screen.queryByTestId("card-reveal")).not.toBeInTheDocument();

    fireEvent.pointerMove(window, { ...opts, clientX: 150, clientY: 0, buttons: 1 });
    await nextFrame();
    expect(screen.getByTestId("card-reveal")).toHaveTextContent("Yes");

    fireEvent.pointerUp(window, { ...opts, clientX: 150, clientY: 0, buttons: 0 });
    await nextFrame();
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
