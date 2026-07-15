import { describe, expect, it } from "vitest";
import {
  fixtureEventTransition,
  isSettlingOverdue,
  timeDrivenTransition,
} from "./scheduler";

const KICKOFF = new Date("2026-07-19T15:00:00.000Z");
const OPENS_AT = new Date(KICKOFF.getTime() - 6 * 60 * 60 * 1000); // kickoff - 6h
const LOCKS_AT = new Date(KICKOFF.getTime() - 30 * 60 * 1000); // kickoff - 30m

describe("timeDrivenTransition", () => {
  it("stays scheduled just before opens_at (kickoff-6h)", () => {
    const justBefore = new Date(OPENS_AT.getTime() - 1);
    expect(timeDrivenTransition("scheduled", OPENS_AT, LOCKS_AT, justBefore)).toBeNull();
  });

  it("opens at exactly opens_at (kickoff-6h)", () => {
    expect(timeDrivenTransition("scheduled", OPENS_AT, LOCKS_AT, OPENS_AT)).toBe("open");
  });

  it("stays open just before locks_at (kickoff-30m)", () => {
    const justBefore = new Date(LOCKS_AT.getTime() - 1);
    expect(timeDrivenTransition("open", OPENS_AT, LOCKS_AT, justBefore)).toBeNull();
  });

  it("locks at exactly locks_at (kickoff-30m)", () => {
    expect(timeDrivenTransition("open", OPENS_AT, LOCKS_AT, LOCKS_AT)).toBe("locked");
  });

  it("has no time-driven transition at kickoff itself — that's fixture-bus driven", () => {
    expect(timeDrivenTransition("locked", OPENS_AT, LOCKS_AT, KICKOFF)).toBeNull();
  });

  it("does nothing for statuses with no time-driven transition (locked, live, settling, settled, void)", () => {
    for (const status of ["locked", "live", "settling", "settled", "void"] as const) {
      expect(timeDrivenTransition(status, OPENS_AT, LOCKS_AT, new Date("2100-01-01"))).toBeNull();
    }
  });
});

describe("fixtureEventTransition", () => {
  it("moves locked -> live exactly when the fixture goes live (at kickoff)", () => {
    expect(fixtureEventTransition("locked", "live")).toBe("live");
  });

  it("moves live -> settling on a terminal (finished) fixture state", () => {
    expect(fixtureEventTransition("live", "finished")).toBe("settling");
  });

  it.each(["postponed", "cancelled", "abandoned"] as const)(
    "moves any pre-terminal status -> void on %s",
    (gameState) => {
      for (const from of ["scheduled", "open", "locked", "live"] as const) {
        expect(fixtureEventTransition(from, gameState)).toBe("void");
      }
    },
  );

  it("never voids a question that's already settling, settled, or void", () => {
    for (const from of ["settling", "settled", "void"] as const) {
      for (const gameState of ["postponed", "cancelled", "abandoned"] as const) {
        expect(fixtureEventTransition(from, gameState)).toBeNull();
      }
    }
  });

  it("does not move to live from anything other than locked", () => {
    for (const from of ["scheduled", "open", "live", "settling", "settled", "void"] as const) {
      expect(fixtureEventTransition(from, "live")).toBeNull();
    }
  });

  it("does not move to settling from anything other than live", () => {
    for (const from of ["scheduled", "open", "locked", "settling", "settled", "void"] as const) {
      expect(fixtureEventTransition(from, "finished")).toBeNull();
    }
  });

  it("a 'scheduled' fixture game state never drives a transition", () => {
    for (const from of ["scheduled", "open", "locked", "live", "settling", "settled", "void"] as const) {
      expect(fixtureEventTransition(from, "scheduled")).toBeNull();
    }
  });
});

describe("isSettlingOverdue", () => {
  const settlingAt = new Date("2026-07-19T17:00:00.000Z");

  it("is not overdue with no settling_at at all", () => {
    expect(isSettlingOverdue(null, new Date("2100-01-01"))).toBe(false);
  });

  it("is not overdue just before the 30-minute deadline", () => {
    const justBefore = new Date(settlingAt.getTime() + 30 * 60 * 1000 - 1);
    expect(isSettlingOverdue(settlingAt, justBefore)).toBe(false);
  });

  it("is overdue at exactly the 30-minute deadline", () => {
    const exactly = new Date(settlingAt.getTime() + 30 * 60 * 1000);
    expect(isSettlingOverdue(settlingAt, exactly)).toBe(true);
  });

  it("stays overdue well past the deadline", () => {
    const wayLater = new Date(settlingAt.getTime() + 60 * 60 * 1000);
    expect(isSettlingOverdue(settlingAt, wayLater)).toBe(true);
  });
});
