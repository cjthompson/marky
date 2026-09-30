import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { tauri, type AnnotatedFolder, type Folder } from "@/lib/tauri";

/**
 * Open the native "choose a folder" dialog and, if the user picks one,
 * register it with the backend. Shared by the sidebar's + button and the
 * File ▸ Open Folder… menu action so both go through one code path.
 */
export async function pickAndAddFolder(): Promise<Folder | null> {
  const picked = await openDialog({ directory: true, multiple: false });
  if (typeof picked !== "string") return null;
  return tauri.addFolder(picked);
}

/**
 * Find the registered folder that owns `path`.
 *
 * Uses longest path-prefix match on `folder.path + "/"` so nested folders
 * pick the deepest one and sibling-prefix cases (`/a/foo` vs `/a/foobar`)
 * don't accidentally match the wrong folder.
 */
export function folderForPath(
  folders: AnnotatedFolder[],
  path: string | undefined,
): AnnotatedFolder | null {
  if (!path) return null;
  let best: AnnotatedFolder | null = null;
  for (const f of folders) {
    if (!path.startsWith(f.path + "/")) continue;
    if (best === null || f.path.length > best.path.length) best = f;
  }
  return best;
}
