import { useEffect, useRef, useState } from "react";
import { AuthProvider, authMode, useAuth } from "./auth/auth-context";
import { PrivyAuthProvider } from "./auth/privy-provider";
import { AuthScreen } from "./components/auth-screen";
import { CardDeck } from "./components/card-deck";
import { LeaderboardScreen } from "./components/leaderboard-screen";
import { LiveScreen } from "./components/live-screen";
import { NavBar } from "./components/nav-bar";
import { ProfileScreen } from "./components/profile-screen";
import { ResultScreen } from "./components/result-screen";
import { hashForScreen, screenFromHash } from "./lib/routes";
import type { Screen } from "./lib/routes";
import type { BatchAnswer } from "./lib/types";

type NavigateOptions = { replace?: boolean };

function useHashScreen(): [Screen, (screen: Screen, options?: NavigateOptions) => void] {
  const [screen, setScreen] = useState<Screen>(() =>
    screenFromHash(typeof location !== "undefined" ? location.hash : ""),
  );

  useEffect(() => {
    const onHashChange = () => setScreen(screenFromHash(location.hash));
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  function navigate(next: Screen, options?: NavigateOptions) {
    if (options?.replace) {
      // replaceState swaps the current history entry without firing
      // hashchange, so the screen state must be set explicitly below.
      history.replaceState(null, "", hashForScreen(next));
    } else {
      location.hash = hashForScreen(next);
    }
    setScreen(next);
  }

  return [screen, navigate];
}

function AppShell() {
  const [screen, navigate] = useHashScreen();
  const { isAuthenticated } = useAuth();
  // The guest's pending pick lives here, not in the deck: navigating to auth
  // unmounts CardDeck, so the answer has to survive on the shell and ride back
  // into the freshly mounted deck as a prop.
  const pendingAnswer = useRef<BatchAnswer | null>(null);
  // Where to send the user back to after auth. Defaults to "deck" (the
  // CardDeck guest-gate flow); set to "profile" when Profile's sign-in
  // button triggers the navigation instead.
  const authReturnTo = useRef<Screen>("deck");

  function goToAuth(pending: BatchAnswer) {
    pendingAnswer.current = pending;
    authReturnTo.current = "deck";
    navigate("auth");
  }

  function goToAuthFromProfile() {
    // A pending guest pick always replays into the deck after auth; deck wins
    // over profile so the user lands where their pick is applied instead of
    // having it silently replayed off-screen.
    authReturnTo.current = pendingAnswer.current ? "deck" : "profile";
    navigate("auth");
  }

  function handleAuthDone() {
    // Idempotent: the authenticated-guard effect below and the login form's
    // onDone can both fire — only the first navigation away from #/auth wins.
    if (screenFromHash(location.hash) !== "auth") return;
    const returnTo = authReturnTo.current;
    authReturnTo.current = "deck";
    // Replace the #/auth history entry so Back never returns to a stale
    // sign-in form for an already-authenticated user.
    navigate(returnTo, { replace: true });
  }

  // Belt-and-braces: deep links or leftover history entries can land an
  // already-authenticated user on #/auth — send them to the return target
  // instead of showing the sign-in form.
  useEffect(() => {
    if (screen === "auth" && isAuthenticated) handleAuthDone();
  });

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1 className="brand-lockup" aria-label="CupRush 26">
          <span aria-hidden="true">CUPRUSH</span>
          <span className="brand-lockup-tab" aria-hidden="true">
            {"// 26"}
          </span>
        </h1>
      </header>

      <main className="app-main">
        {screen === "deck" && (
          <CardDeck
            onNavigateAuth={goToAuth}
            initialAnswer={pendingAnswer.current}
            onInitialAnswerConsumed={() => {
              pendingAnswer.current = null;
            }}
          />
        )}
        {screen === "live" && <LiveScreen />}
        {screen === "result" && <ResultScreen />}
        {screen === "leaderboard" && <LeaderboardScreen />}
        {screen === "profile" && <ProfileScreen onSignIn={goToAuthFromProfile} />}
        {screen === "auth" && !isAuthenticated && <AuthScreen onDone={handleAuthDone} />}
      </main>

      <NavBar current={screen === "auth" ? "deck" : screen} onNavigate={navigate} />
    </div>
  );
}

export function App() {
  // Privy owns the session in privy mode; dev mode keeps the localStorage stub.
  const Provider = authMode() === "privy" ? PrivyAuthProvider : AuthProvider;
  return (
    <Provider>
      <AppShell />
    </Provider>
  );
}
