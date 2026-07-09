import { useEffect, useRef, useState } from "react";
import { AuthProvider, authMode } from "./auth/auth-context";
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

function useHashScreen(): [Screen, (screen: Screen) => void] {
  const [screen, setScreen] = useState<Screen>(() =>
    screenFromHash(typeof location !== "undefined" ? location.hash : ""),
  );

  useEffect(() => {
    const onHashChange = () => setScreen(screenFromHash(location.hash));
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  function navigate(next: Screen) {
    location.hash = hashForScreen(next);
    setScreen(next);
  }

  return [screen, navigate];
}

function AppShell() {
  const [screen, navigate] = useHashScreen();
  const afterAuth = useRef<(() => void) | null>(null);

  function goToAuth(after: () => void) {
    afterAuth.current = after;
    navigate("auth");
  }

  function handleAuthDone() {
    const callback = afterAuth.current;
    afterAuth.current = null;
    navigate("deck");
    callback?.();
  }

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
        {screen === "deck" && <CardDeck onNavigateAuth={goToAuth} />}
        {screen === "live" && <LiveScreen />}
        {screen === "result" && <ResultScreen />}
        {screen === "leaderboard" && <LeaderboardScreen />}
        {screen === "profile" && <ProfileScreen />}
        {screen === "auth" && <AuthScreen onDone={handleAuthDone} />}
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
