import type { Screen } from "../lib/routes";

const ITEMS: { screen: Screen; label: string }[] = [
  { screen: "deck", label: "Deck" },
  { screen: "live", label: "Live" },
  { screen: "result", label: "Result" },
  { screen: "leaderboard", label: "Leaderboard" },
  { screen: "profile", label: "Profile" },
];

export function NavBar({ current, onNavigate }: { current: Screen; onNavigate(s: Screen): void }) {
  return (
    <nav className="nav-bar" aria-label="Primary">
      {ITEMS.map((item) => (
        <button
          key={item.screen}
          type="button"
          className={
            item.screen === current ? "nav-item nav-item-active" : "nav-item"
          }
          aria-current={item.screen === current ? "page" : undefined}
          onClick={() => onNavigate(item.screen)}
        >
          {item.label}
        </button>
      ))}
    </nav>
  );
}
