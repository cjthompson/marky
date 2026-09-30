import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuCheckboxItem,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";
import { Search, Sun, Moon, Monitor, FileText, SplitSquareHorizontal, SplitSquareVertical, X, Settings, Minus, Plus, Pencil, Lock, Save, RotateCcw } from "lucide-react";
import { useTheme, type Theme } from "@/lib/theme";
import { usePreferences } from "@/lib/preferences";
import type { SplitDirection } from "@/lib/workspace";

interface Props {
  filePath?: string;
  onOpenFile: () => void;
  onSplit: (d: SplitDirection) => void;
  onCloseSplit: () => void;
  isSplit: boolean;
  onFind: () => void;
  mode: "read" | "edit";
  onToggleMode: () => void;
  dirty: boolean;
  onSave: () => void;
  onDiscard: () => void;
}

export function Toolbar({
  filePath,
  onOpenFile,
  onSplit,
  onCloseSplit,
  isSplit,
  onFind,
  mode,
  onToggleMode,
  dirty,
  onSave,
  onDiscard,
}: Props) {
  const { theme, setTheme } = useTheme();
  const { copyAsMarkdown, setCopyAsMarkdown, zoom, zoomIn, zoomOut, zoomReset } = usePreferences();
  const ThemeIcon = theme === "light" ? Sun : theme === "dark" ? Moon : Monitor;
  const ModeIcon = mode === "edit" ? Pencil : Lock;

  return (
    <header className="flex h-9 shrink-0 items-center justify-between border-b bg-card/40 px-3 print:hidden">
      <div className="flex items-center gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={mode === "edit" ? "default" : "ghost"}
              size="sm"
              className="h-7 gap-1.5 px-2 text-xs"
              onClick={onToggleMode}
              disabled={!filePath}
            >
              <ModeIcon className="h-3.5 w-3.5" />
              {mode === "edit" ? "Editing" : "Read only"}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{mode === "edit" ? "Switch to read mode (⌘E)" : "Switch to edit mode (⌘E)"}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 px-2 text-xs"
              onClick={onSave}
              disabled={!dirty}
            >
              <Save className="h-3.5 w-3.5" />
              Save
            </Button>
          </TooltipTrigger>
          <TooltipContent>Save (⌘S)</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 px-2 text-xs"
              onClick={onDiscard}
              disabled={!dirty}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Discard changes
            </Button>
          </TooltipTrigger>
          <TooltipContent>Discard unsaved changes and reload from disk</TooltipContent>
        </Tooltip>
        <div className="truncate text-xs text-muted-foreground">{filePath ?? "No file open"}</div>
      </div>
      <div className="flex items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button onClick={onFind} variant="ghost" size="icon" className="h-7 w-7">
              <Search className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Find in document (⌘F)</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button onClick={onOpenFile} variant="ghost" size="icon" className="h-7 w-7">
              <FileText className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Open file (⌘O)</TooltipContent>
        </Tooltip>
        {isSplit ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button onClick={onCloseSplit} variant="ghost" size="icon" className="h-7 w-7">
                <X className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Close split</TooltipContent>
          </Tooltip>
        ) : (
          <>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button onClick={() => onSplit("vertical")} variant="ghost" size="icon" className="h-7 w-7">
                  <SplitSquareVertical className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Split vertically (⌘\)</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button onClick={() => onSplit("horizontal")} variant="ghost" size="icon" className="h-7 w-7">
                  <SplitSquareHorizontal className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Split horizontally (⌘⇧\)</TooltipContent>
            </Tooltip>
          </>
        )}
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7">
                  <Settings className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>Settings</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Settings</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem
              checked={copyAsMarkdown}
              onCheckedChange={setCopyAsMarkdown}
            >
              Copy as Markdown
            </DropdownMenuCheckboxItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Text Size</DropdownMenuLabel>
            <div className="flex items-center gap-1 px-2 pb-1.5">
              <Button
                variant="outline"
                size="icon"
                className="h-6 w-6"
                onClick={zoomOut}
                disabled={zoom <= 0.7}
              >
                <Minus className="h-3 w-3" />
              </Button>
              <button
                onClick={zoomReset}
                className="min-w-[3rem] rounded px-1 text-center text-xs text-foreground hover:bg-accent"
                title="Reset to 100%"
              >
                {Math.round(zoom * 100)}%
              </button>
              <Button
                variant="outline"
                size="icon"
                className="h-6 w-6"
                onClick={zoomIn}
                disabled={zoom >= 1.6}
              >
                <Plus className="h-3 w-3" />
              </Button>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <ThemeIcon className="h-3.5 w-3.5" />
                Theme
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuRadioGroup value={theme} onValueChange={(v) => setTheme(v as Theme)}>
                  <DropdownMenuRadioItem value="light">
                    <Sun className="h-3.5 w-3.5" />
                    Light
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="dark">
                    <Moon className="h-3.5 w-3.5" />
                    Dark
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="system">
                    <Monitor className="h-3.5 w-3.5" />
                    System
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
