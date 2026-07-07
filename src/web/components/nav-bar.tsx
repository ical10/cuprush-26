import type { ReactNode } from "react";
import type { Screen } from "../lib/routes";

// Brand toolkit icon language (brand/cuprush-26-toolkit.png): 2px rounded
// line icons — live pulse, whistle, flag, forward, shield — each shown in a
// chamfered chip. Drawn inline so the whistle and pulse match the toolkit
// exactly instead of approximating with stock icons.
function NavGlyph({ children }: { children: ReactNode }) {
  return (
    <svg
      width={20}
      height={20}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

const DeckIcon = (
  <NavGlyph>
    <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
    <path d="M12 6.8a5.2 5.2 0 0 1 5.2 5.2" />
    <path d="M12 17.2a5.2 5.2 0 0 1-5.2-5.2" />
    <path d="M12 3a9 9 0 0 1 9 9" />
    <path d="M12 21a9 9 0 0 1-9-9" />
  </NavGlyph>
);

const LiveIcon = (
  <NavGlyph>
    <circle cx="9.5" cy="14.5" r="4.5" />
    <path d="M9.5 10H21v3l-7.1 1.9" />
  </NavGlyph>
);

const ResultIcon = (
  <NavGlyph>
    <path d="M5 21V4" />
    <path d="M5 4h14l-3 3.5L19 11H5" />
  </NavGlyph>
);

const RankIcon = (
  <NavGlyph>
    <path d="m6 5 7 7-7 7" />
    <path d="m13 5 7 7-7 7" />
  </NavGlyph>
);

const ProfileIcon = (
  <NavGlyph>
    <path d="M12 3l8 3.2V11c0 4.8-3.2 8.1-8 10-4.8-1.9-8-5.2-8-10V6.2z" />
  </NavGlyph>
);

const ITEMS: { screen: Screen; label: string; icon: ReactNode }[] = [
  { screen: "deck", label: "Deck", icon: DeckIcon },
  { screen: "live", label: "Live", icon: LiveIcon },
  { screen: "result", label: "Result", icon: ResultIcon },
  { screen: "leaderboard", label: "Rank", icon: RankIcon },
  { screen: "profile", label: "Profile", icon: ProfileIcon },
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
          <span className="nav-icon-frame">
            <span className="nav-icon-frame-inner">{item.icon}</span>
          </span>
          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  );
}
