import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Go } from "./use-go";

/**
 * Go: one press checks everything and, when it all holds, creates the project and starts its
 * setup. Green from the design system's "done" status colour; the label takes the theme's dark
 * text colour on it in both themes (7:1 or more), since white on that green falls short of AA.
 */
export function GoButton({
  busy,
  disabled,
  type = "button",
  onClick,
}: {
  busy: Go["busy"];
  disabled?: boolean;
  type?: "button" | "submit";
  onClick?: () => void;
}) {
  return (
    <Button
      type={type}
      onClick={onClick}
      disabled={disabled || busy !== null}
      aria-busy={busy !== null}
      data-testid="secure-foundation-go"
      className="min-w-20 bg-status-done font-semibold text-foreground hover:bg-status-done/85 dark:text-background"
    >
      {busy && <Loader2 className="animate-spin" />}
      {busy === "checking" ? "Checking…" : busy === "creating" ? "Creating…" : "Go"}
    </Button>
  );
}
