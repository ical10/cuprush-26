import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { capitalizeOutcome } from "../lib/outcome-labels";

type Props = {
  outcome: string;
  onSignIn(): void;
  onDismiss(): void;
};

/**
 * A real modal (shadcn Dialog: focus-trapped, ESC/overlay dismiss, portaled)
 * gating the deck to signed-in users once they try to save a pick. Guests
 * still browse and drag cards freely (PRD "no auth wall before first card")
 * — this only blocks the save itself.
 */
export function SavePrompt({ outcome, onSignIn, onDismiss }: Props) {
  return (
    <Dialog open onOpenChange={(open) => !open && onDismiss()}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Save your pick and start a streak.</DialogTitle>
          <DialogDescription className="text-base">
            Your pick: {capitalizeOutcome(outcome)}. Signing in creates a free
            account with an embedded wallet so your pick locks on Solana — no
            crypto knowledge needed.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="secondary" className="min-h-11" onClick={onDismiss}>
            Keep browsing
          </Button>
          <Button className="min-h-11" onClick={onSignIn}>
            Sign in to save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
