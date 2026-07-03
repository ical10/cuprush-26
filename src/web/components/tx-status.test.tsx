import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TxStatus } from "./tx-status";

describe("TxStatus", () => {
  it("renders the saving state", () => {
    render(<TxStatus state="saving" />);
    expect(screen.getByRole("status")).toHaveTextContent("Saving your pick…");
  });

  it("renders the locked confirmation copy", () => {
    render(<TxStatus state="locked" />);
    expect(screen.getByRole("status")).toHaveTextContent("Locked on Solana.");
  });

  it("renders a retry action on failure", async () => {
    const onRetry = vi.fn();
    render(<TxStatus state="failed" onRetry={onRetry} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Save failed.");
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalled();
  });
});
