import { authMode } from "../auth/auth-context";
import { DevAuth } from "../auth/dev-auth";
import { PrivyEmailLogin } from "../auth/privy-email-login";

export function AuthScreen({ onDone }: { onDone(): void }) {
  return (
    <div className="screen auth-screen">
      <h2 className="type-screen-title">Sign in</h2>
      {authMode() === "privy" ? (
        <PrivyEmailLogin onDone={onDone} />
      ) : (
        <DevAuth onDone={onDone} />
      )}
    </div>
  );
}
