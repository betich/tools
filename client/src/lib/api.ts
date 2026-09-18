import type { GoogleFont, MergeData, MergeDoc, Project, ToolMeta } from "@tools/shared";

const BASE = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");
const url = (path: string) => `${BASE}${path}`;

/**
 * Absolute URL for a stored asset. The client and the API are separate origins
 * in production, so a relative `/api/assets/...` would hit the static host.
 */
export const assetUrl = (ref: string) => url(`/api/assets/${ref.replace(/^asset:/, "")}`);

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url(path), {
    ...init,
    headers: init?.body instanceof FormData ? init.headers : { "content-type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    throw new ApiError(detail?.error ?? `request failed (${res.status})`, res.status);
  }
  if (res.status === 204) return null as T;
  return (await res.json()) as T;
}

export type ProjectSummary = { id: string; name: string; createdAt: string; updatedAt: string };
export type FontList = { source: "google" | "fallback"; total: number; fonts: Pick<GoogleFont, "family" | "category" | "variants">[] };

export const api = {
  /** Resolves only when the server is actually reachable — the UI degrades gracefully otherwise. */
  health: () => request<{ ok: boolean; projects: number; uptimeSeconds: number }>("/api/health"),

  tools: () => request<ToolMeta[]>("/api/tools"),

  fonts: (q = "", limit = 300) => request<FontList>(`/api/fonts?q=${encodeURIComponent(q)}&limit=${limit}`),

  listProjects: () => request<ProjectSummary[]>("/api/projects"),
  getProject: (id: string) => request<Project>(`/api/projects/${id}`),
  createProject: (name: string, doc: MergeDoc, data: MergeData) =>
    request<ProjectSummary>("/api/projects", { method: "POST", body: JSON.stringify({ name, doc, data }) }),
  updateProject: (id: string, name: string, doc: MergeDoc, data: MergeData) =>
    request<ProjectSummary>(`/api/projects/${id}`, { method: "PUT", body: JSON.stringify({ name, doc, data }) }),
  deleteProject: (id: string) => request<null>(`/api/projects/${id}`, { method: "DELETE" }),

  /** An empty password unlocks an existing link; omitting it leaves the lock as it is. */
  share: (id: string, password?: string) =>
    request<{ slug: string; protected: boolean }>(`/api/projects/${id}/share`, {
      method: "POST",
      body: JSON.stringify(password === undefined ? {} : { password }),
    }),
  unshare: (id: string) => request<null>(`/api/projects/${id}/share`, { method: "DELETE" }),
  shareMeta: (slug: string) => request<{ protected: boolean }>(`/api/share/${slug}/meta`),
  getShared: (slug: string, password?: string) =>
    request<Project & { readOnly: true; protected: boolean }>(`/api/share/${slug}`, {
      headers: password ? { "x-share-password": password } : undefined,
    }),

  uploadAsset: async (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<{ id: string; ref: string; contentType: string; bytes: number }>("/api/assets", {
      method: "POST",
      body: form,
    });
  },

  /** Server-side batch render. Returns a ZIP so a 500-row merge never pins the tab. */
  renderBatch: async (doc: MergeDoc, data: MergeData, namePattern: string): Promise<Blob> => {
    const res = await fetch(url("/api/render/batch"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ doc, data, namePattern }),
    });
    if (!res.ok) {
      const detail = await res.json().catch(() => null);
      throw new ApiError(detail?.error ?? `render failed (${res.status})`, res.status);
    }
    return res.blob();
  },
};
