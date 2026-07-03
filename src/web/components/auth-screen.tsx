import { authMode } from "../auth/auth-context";
import { DevAuth } from "../auth/dev-auth";
import { PrivyAuthStub } from "../auth/privy-auth-stub";

export function AuthScreen({ onDone }: { onDone(): void }) {
  return (
    <div className="screen auth-screen">
      <h2>Sign in</h2>
      {authMode() === "privy" ? (
        <PrivyAuthStub onDone={onDone} />
      ) : (
        <DevAuth onDone={onDone} />
      )}
    </div>
  );
}
