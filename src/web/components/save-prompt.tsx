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
          <DialogDescription>
            Your pick: {capitalizeOutcome(outcome)}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onDismiss}>
            Keep browsing
          </Button>
          <Button onClick={onSignIn}>Sign in to save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
