/**
 * Passwords for locked projects, remembered for the tab so a project opened
 * once can be saved, reopened and deleted without asking again. Session
 * storage only: closing the tab forgets them. Storage can be unavailable, so
 * the in-memory map is the source of truth and storage is a convenience.
 */
const KEY = "mail-merge:unlocks";
const memory = new Map<string, string>(read());

function read(): [string, string][] {
  try {
    return Object.entries(JSON.parse(sessionStorage.getItem(KEY) ?? "{}") as Record<string, string>);
  } catch {
    return [];
  }
}

function write(): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(Object.fromEntries(memory)));
  } catch {
    /* private window or blocked storage — memory still holds it */
  }
}

export const unlockFor = (projectId: string | null): string | undefined => (projectId ? memory.get(projectId) : undefined);

export function remember(projectId: string, password: string): void {
  if (password) memory.set(projectId, password);
  else memory.delete(projectId);
  write();
}

export function forget(projectId: string): void {
  memory.delete(projectId);
  write();
}
