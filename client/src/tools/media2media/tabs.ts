/**
 * The three tabs, in strip order. The tab lives in the URL
 * (`/media2media/image|video|gif`) so each one is linkable.
 *
 * Rules every tab keeps: each control previews instantly, costly work
 * (encoding) runs only on export, and undo snapshots on gesture start.
 */
export const tabs = [
  { id: "image", label: "image" },
  { id: "video", label: "video" },
  { id: "gif", label: "gif" },
] as const;

export type TabId = (typeof tabs)[number]["id"];

export function isTab(value: string | undefined): value is TabId {
  return tabs.some((t) => t.id === value);
}
