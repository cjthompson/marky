import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { Diagnostic } from "@/lib/workspace";

interface Props {
  count: number;
  /** Actual diagnostic list to render in the dropdown rows. */
  diagnostics: Diagnostic[];
  /** Fired when the user picks a diagnostic. App decides how to navigate. */
  onSelect: (diag: Diagnostic) => void;
}

/**
 * Toolbar badge that opens a shadcn dropdown listing every lint diagnostic
 * for the active tab. Clicking an entry hands the diagnostic up to `App.tsx`,
 * which routes to either the rendered block or the source line depending on
 * the current view.
 *
 * - `count === 0`: ghost-style "No problems" chip, dropdown lists a disabled
 *   "Nothing to report" row.
 * - `count > 0`: destructive variant with the count, dropdown lists one row
 *   per diagnostic with rule id, line number, and message.
 */
export function ProblemsMenu({ count, diagnostics, onSelect }: Props) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant={count > 0 ? "destructive" : "ghost"}
          size="sm"
          className={cn(
            "h-7 gap-1 px-2 text-xs",
            count === 0 && "text-muted-foreground",
          )}
          aria-label={count > 0 ? `${count} problems` : "No problems"}
        >
          <AlertTriangle className="h-3.5 w-3.5" />
          {count > 0 ? `${count} ${count === 1 ? "problem" : "problems"}` : "No problems"}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-72">
        <DropdownMenuLabel>
          {diagnostics.length === 0
            ? "No problems"
            : `${diagnostics.length} ${diagnostics.length === 1 ? "problem" : "problems"}`}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {diagnostics.length === 0 ? (
          <DropdownMenuItem disabled>Nothing to report.</DropdownMenuItem>
        ) : (
          diagnostics.map((d, idx) => (
            <DropdownMenuItem
              key={`${d.rule}:${d.line}:${d.column}:${idx}`}
              onSelect={() => onSelect(d)}
              className="flex flex-col items-start gap-0.5 py-1.5"
            >
              <span className="flex items-center gap-2 text-xs">
                <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                  {d.rule}
                </span>
                <span className="text-muted-foreground">line {d.line}</span>
                {d.severity === "error" && (
                  <span className="text-destructive">error</span>
                )}
              </span>
              <span className="text-xs">{d.message}</span>
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
