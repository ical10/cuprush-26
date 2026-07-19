import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProfileScreen } from "./profile-screen";
import { AuthProvider } from "../auth/auth-context";
import { clearToken, setToken } from "../lib/auth-storage";
import type { Me } from "../lib/types";

const { fetchMe, updateDisplayName, revokeDelegation, deleteAccount } =
  vi.hoisted(() => ({
    fetchMe: vi.fn(),
    updateDisplayName: vi.fn(),
    revokeDelegation: vi.fn(),
    deleteAccount: vi.fn(),
  }));

vi.mock("../lib/api", () => ({
  fetchMe,
  updateDisplayName,
  revokeDelegation,
  deleteAccount,
}));

const WALLET = "4Nd1mYQFuLVMYq3VLC7hRqHqXHbTbSHFF3P2FLjSnZbF";

function profile(overrides: Partial<Me> = {}): Me {
  return {
    displayName: "Husni",
    points: 10,
    currentStreak: 1,
    bestStreak: 3,
    walletAddress: WALLET,
    ...overrides,
  };
}

function renderSignedOut(onSignIn = vi.fn()) {
  clearToken(); // unauthenticated: fetchMe never fires
  render(
    <AuthProvider>
      <ProfileScreen onSignIn={onSignIn} />
    </AuthProvider>,
  );
  return { onSignIn };
}

function renderSignedIn() {
  setToken("dev:tester");
  render(
    <AuthProvider>
      <ProfileScreen onSignIn={vi.fn()} />
    </AuthProvider>,
  );
}

describe("ProfileScreen", () => {
  beforeEach(() => {
    fetchMe.mockReset();
    updateDisplayName.mockReset();
    revokeDelegation.mockReset();
    deleteAccount.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    clearToken();
  });

  it("renders a sign-in button when signed out", () => {
    renderSignedOut();
    expect(screen.getByText("Sign in to view your profile.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
  });

  it("calls onSignIn when the sign-in button is clicked", async () => {
    const { onSignIn } = renderSignedOut();
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(onSignIn).toHaveBeenCalledTimes(1);
  });

  it("shows the profile once fetchMe resolves", async () => {
    fetchMe.mockResolvedValue(profile());
    renderSignedIn();

    expect(await screen.findByText(WALLET)).toBeInTheDocument();
    const input = screen.getByLabelText("Display name");
    expect(input).toHaveValue("Husni");
    expect(input).toHaveAttribute("maxLength", "32");
  });

  describe("load failure", () => {
    it("shows an error state with Retry and Sign out instead of loading forever", async () => {
      fetchMe.mockRejectedValue(new Error("boom"));
      renderSignedIn();

      expect(
        await screen.findByText("Couldn't load your profile."),
      ).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
      expect(screen.queryByText("Loading profile…")).not.toBeInTheDocument();
    });

    it("Retry re-fetches and shows the profile", async () => {
      fetchMe
        .mockRejectedValueOnce(new Error("boom"))
        .mockResolvedValueOnce(profile());
      renderSignedIn();

      await userEvent.click(await screen.findByRole("button", { name: "Retry" }));

      expect(await screen.findByText(WALLET)).toBeInTheDocument();
      expect(fetchMe).toHaveBeenCalledTimes(2);
    });

    it("Sign out from the error state escapes to the sign-in gate", async () => {
      fetchMe.mockRejectedValue(new Error("boom"));
      renderSignedIn();

      await userEvent.click(
        await screen.findByRole("button", { name: "Sign out" }),
      );

      expect(
        screen.getByText("Sign in to view your profile."),
      ).toBeInTheDocument();
    });
  });

  describe("revoke delegation", () => {
    it("requires confirmation before revoking", async () => {
      fetchMe.mockResolvedValue(profile());
      revokeDelegation.mockResolvedValue({
        delegationRevokedAt: new Date().toISOString(),
      });
      renderSignedIn();

      await userEvent.click(
        await screen.findByRole("button", { name: "Revoke delegation" }),
      );
      expect(revokeDelegation).not.toHaveBeenCalled();
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Revoking permanently stops the server from saving your picks",
      );
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Your existing points remain.",
      );

      await userEvent.click(
        screen.getByRole("button", { name: "Revoke permanently" }),
      );
      expect(revokeDelegation).toHaveBeenCalledTimes(1);
      expect(await screen.findByText("Delegation revoked.")).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Revoke permanently" }),
      ).not.toBeInTheDocument();
    });

    it("Cancel closes the confirmation without revoking", async () => {
      fetchMe.mockResolvedValue(profile());
      renderSignedIn();

      await userEvent.click(
        await screen.findByRole("button", { name: "Revoke delegation" }),
      );
      await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

      expect(revokeDelegation).not.toHaveBeenCalled();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Revoke delegation" }),
      ).toBeInTheDocument();
    });
  });

  describe("missing wallet", () => {
    it("re-fetches once after 4 seconds and shows the wallet when it appears", async () => {
      vi.useFakeTimers();
      fetchMe
        .mockResolvedValueOnce(profile({ walletAddress: null }))
        .mockResolvedValue(profile());
      renderSignedIn();
      await act(async () => {});

      expect(
        screen.getByText(
          "No wallet yet. It may still be setting up — refresh in a moment, or sign out and back in.",
        ),
      ).toBeInTheDocument();
      expect(fetchMe).toHaveBeenCalledTimes(1);

      await act(async () => {
        vi.advanceTimersByTime(4_000);
      });
      expect(fetchMe).toHaveBeenCalledTimes(2);
      expect(screen.getByText(WALLET)).toBeInTheDocument();

      await act(async () => {
        vi.advanceTimersByTime(20_000);
      });
      expect(fetchMe).toHaveBeenCalledTimes(2);
    });

    it("does not schedule a retry when the wallet is already set", async () => {
      vi.useFakeTimers();
      fetchMe.mockResolvedValue(profile());
      renderSignedIn();
      await act(async () => {});

      await act(async () => {
        vi.advanceTimersByTime(20_000);
      });
      expect(fetchMe).toHaveBeenCalledTimes(1);
    });
  });

  describe("save name", () => {
    it("shows the server's error message and re-enables Save", async () => {
      fetchMe.mockResolvedValue(profile());
      updateDisplayName.mockRejectedValue(
        new Error("displayName must be 1-32 characters"),
      );
      renderSignedIn();

      await screen.findByText(WALLET);
      await userEvent.click(screen.getByRole("button", { name: "Save name" }));

      expect(
        await screen.findByText("displayName must be 1-32 characters"),
      ).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Save name" })).toBeEnabled();
    });

    it("disables the Save button while the request is in flight", async () => {
      fetchMe.mockResolvedValue(profile());
      let resolveSave!: (me: Me) => void;
      updateDisplayName.mockReturnValue(
        new Promise<Me>((resolve) => {
          resolveSave = resolve;
        }),
      );
      renderSignedIn();

      await screen.findByText(WALLET);
      const save = screen.getByRole("button", { name: "Save name" });
      await userEvent.click(save);
      expect(save).toBeDisabled();

      await act(async () => {
        resolveSave(profile({ displayName: "New Name" }));
      });
      expect(save).toBeEnabled();
      expect(await screen.findByText("Name saved.")).toBeInTheDocument();
    });
  });

  describe("delete account", () => {
    async function confirmDelete() {
      await userEvent.click(
        await screen.findByRole("button", { name: "Delete account" }),
      );
      await userEvent.click(
        screen.getByRole("button", { name: "Delete my account" }),
      );
    }

    it("logs out when the delete failed but the account is verifiably gone", async () => {
      fetchMe.mockResolvedValue(profile());
      deleteAccount.mockRejectedValue(new Error("network"));
      renderSignedIn();
      await screen.findByText(WALLET);

      // The verification re-fetch provisions a blank account: the old
      // profile no longer exists, so the delete actually succeeded.
      fetchMe.mockResolvedValueOnce(
        profile({
          displayName: null,
          points: 0,
          currentStreak: 0,
          bestStreak: 0,
          walletAddress: null,
        }),
      );
      await confirmDelete();

      expect(
        await screen.findByText("Sign in to view your profile."),
      ).toBeInTheDocument();
    });

    it("logs out when the verification re-fetch itself fails", async () => {
      fetchMe.mockResolvedValue(profile());
      deleteAccount.mockRejectedValue(new Error("network"));
      renderSignedIn();
      await screen.findByText(WALLET);

      fetchMe.mockRejectedValueOnce(new Error("401"));
      await confirmDelete();

      expect(
        await screen.findByText("Sign in to view your profile."),
      ).toBeInTheDocument();
    });

    it("shows the failure message only when the profile still exists", async () => {
      fetchMe.mockResolvedValue(profile());
      deleteAccount.mockRejectedValue(new Error("500"));
      renderSignedIn();
      await screen.findByText(WALLET);

      await confirmDelete();

      expect(
        await screen.findByText("Couldn't delete your account. Try again."),
      ).toBeInTheDocument();
      expect(
        screen.queryByText("Sign in to view your profile."),
      ).not.toBeInTheDocument();
    });
  });
});
