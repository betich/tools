import { WORKER_BEAT_MS } from "@tools/shared";
import { db } from "./db";

export const startedAt = Date.now();
export let lastBeat = 0;

function beat() {
  lastBeat = Date.now();
  try {
    db.run("INSERT OR REPLACE INTO worker_heartbeat (id, beat_at, started_at) VALUES (1, ?, ?)", [lastBeat, startedAt]);
  } catch (err) {
    // A locked database skips one beat; three in a row and the API calls us down, which is true enough.
    console.error("heartbeat failed:", err);
  }
}

export function startHeartbeat(): void {
  beat();
  setInterval(beat, WORKER_BEAT_MS);
}
