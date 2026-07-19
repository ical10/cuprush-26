import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProfileScreen } from "./profile-screen";
import { AuthProvider } from "../auth/auth-context";
import { clearToken } from "../lib/auth-storage";

const { fetchMe } = vi.hoisted(() => ({
  fetchMe: vi.fn(),
}));

vi.mock("../lib/api", () => ({
  fetchMe,
  updateDisplayName: vi.fn(),
  revokeDelegation: vi.fn(),
  deleteAccount: vi.fn(),
}));

function renderScreen(onSignIn = vi.fn()) {
  clearToken(); // unauthenticated: fetchMe never fires
  render(
    <AuthProvider>
      <ProfileScreen onSignIn={onSignIn} />
    </AuthProvider>,
  );
  return { onSignIn };
}

describe("ProfileScreen", () => {
  beforeEach(() => {
    fetchMe.mockReset();
  });

  it("renders a sign-in button when signed out", () => {
    renderScreen();
    expect(screen.getByText("Sign in to view your profile.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
  });

  it("calls onSignIn when the sign-in button is clicked", async () => {
    const { onSignIn } = renderScreen();
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(onSignIn).toHaveBeenCalledTimes(1);
  });
});
