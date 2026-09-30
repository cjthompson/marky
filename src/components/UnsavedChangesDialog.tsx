import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface Props {
  open: boolean;
  /** A short label for the operation that triggered the prompt, e.g. "Close tab". */
  action: string;
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}

/**
 * Save / Discard / Cancel prompt used everywhere the app would otherwise
 * silently drop unsaved edits: Edit → Read, Close Tab, Close Split, Reload
 * File, and the window close-requested event (Quit).
 */
export function UnsavedChangesDialog({ open, action, onSave, onDiscard, onCancel }: Props) {
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Unsaved changes</DialogTitle>
          <DialogDescription>
            This tab has unsaved changes. {action} will discard them unless you save first.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="outline" onClick={onDiscard}>
            Discard
          </Button>
          <Button onClick={onSave}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}