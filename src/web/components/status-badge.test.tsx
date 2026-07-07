import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StatusBadge } from "./status-badge";
import type { BadgeStatus } from "./status-badge";

function stubMatchMedia(matches: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockReturnValue({
      matches,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("StatusBadge", () => {
  it.each([
    ["locking", "Locking"],
    ["locked", "Locked"],
    ["settling", "Settling"],
    ["push", "Push"],
    ["void", "Void"],
  ] as [BadgeStatus, string][])(
    "pairs the %s icon with its plain word, never color alone",
    (status, label) => {
      const { container } = render(<StatusBadge status={status} />);
      expect(screen.getByText(label)).toBeInTheDocument();
      const icon = container.querySelector("svg.badge-icon");
      expect(icon).not.toBeNull();
      expect(icon).toHaveAttribute("aria-hidden", "true");
    },
  );

  it("renders LIVE with the word and a pulsing dot", () => {
    stubMatchMedia(false);
    render(<StatusBadge status="live" />);
    expect(screen.getByText("Live")).toBeInTheDocument();
    expect(screen.getByTestId("badge-dot")).toHaveClass("badge-dot-pulse");
  });

  it("keeps the LIVE dot static under prefers-reduced-motion", () => {
    stubMatchMedia(true);
    render(<StatusBadge status="live" />);
    expect(screen.getByTestId("badge-dot")).not.toHaveClass("badge-dot-pulse");
  });
});
