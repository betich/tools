/**
 * The job loop — claiming queued PDF jobs from SQLite and running them through
 * the toolchain via `run()` in ./exec. Built in #6; until then the worker only
 * keeps its heartbeat.
 */
export function startJobs(): void {}
