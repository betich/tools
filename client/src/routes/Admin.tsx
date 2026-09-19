import { useCallback, useEffect, useState, type FormEvent } from "react";
import { PageHead, Shell } from "@/components/Shell";
import { Button, Empty, Field, Input, TextButton } from "@/components/ui";
import { ApiError, api, type AdminStats } from "@/lib/api";
import { bytes } from "@/lib/format";
import { cn } from "@/lib/cn";

const KEY = "tools.admin";

// Session storage, so closing the tab signs out. Private mode throws; then it just asks again.
const remembered = () => {
  try {
    return sessionStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
};
const remember = (password: string) => {
  try {
    if (password) sessionStorage.setItem(KEY, password);
    else sessionStorage.removeItem(KEY);
  } catch {
    /* forgets on reload, nothing more */
  }
};

/**
 * One question, answered before anything is read: is anyone using this? The
 * count for today is the headline, the month is the one picture, and where
 * people went is a ranked list in plain words. Page views and anything that
 * never calls the server (all of squoosh) are in Google Analytics.
 */
export function Admin() {
  const [password, setPassword] = useState(remembered);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (pw: string) => {
    setBusy(true);
    setError(null);
    try {
      setStats(await api.adminStats(pw));
      remember(pw);
    } catch (e) {
      setStats(null);
      if (e instanceof ApiError && e.status === 401) remember("");
      setError(e instanceof ApiError ? e.message : "the api is not reachable");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    const pw = remembered();
    if (pw) void load(pw);
  }, [load]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (password) void load(password);
  };

  const signOut = () => {
    remember("");
    setPassword("");
    setStats(null);
  };

  if (!stats) {
    return (
      <Shell>
        <PageHead title="admin" />
        <form onSubmit={submit} className="flex max-w-sm flex-col gap-4">
          <Field label="password">
            <Input type="password" autoFocus autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          {error ? <p className="text-label font-sans text-body">{error}</p> : null}
          <Button type="submit" disabled={busy || !password} className="self-start">
            {busy ? "checking…" : "open"}
          </Button>
        </form>
      </Shell>
    );
  }

  const today = stats.series.at(-1) ?? { day: "", hits: 0, visitors: 0 };
  const before = stats.series.slice(-8, -1);
  const usual = before.reduce((n, d) => n + d.visitors, 0) / Math.max(1, before.length);
  const month = stats.series.reduce((n, d) => n + d.hits, 0);

  return (
    <Shell width="page">
      <header className="mb-12 flex items-center justify-between gap-6">
        <h1 className="text-meta font-mono text-micro uppercase">admin</h1>
        <nav className="flex items-center gap-5">
          <a
            className="text-meta hover:text-indigo font-mono text-micro uppercase transition-colors duration-200"
            href="https://analytics.google.com/"
            target="_blank"
            rel="noreferrer"
          >
            page views
          </a>
          <TextButton onClick={() => void load(password)} disabled={busy}>
            {busy ? "loading…" : "refresh"}
          </TextButton>
          <TextButton onClick={signOut}>sign out</TextButton>
        </nav>
      </header>

      {/* The answer, as a sentence. */}
      <p className="text-ink font-mono text-[clamp(5rem,11vw,7.25rem)] leading-[0.9] font-bold tracking-[-0.035em] uppercase tabular-nums">
        {today.visitors}
        <span className="text-meta block pt-4 text-display font-bold">
          {today.visitors === 1 ? "caller today" : "callers today"}
        </span>
      </p>
      <p className="text-label mt-5 max-w-xl font-sans text-body">{trend(today.visitors, usual, month)}</p>

      <Month series={stats.series} />

      <section className="mt-20">
        <h2 className="text-ink mb-7 font-mono text-title font-bold uppercase">where they went</h2>
        {stats.routes.length === 0 ? <Empty>no requests yet</Empty> : <Ranked routes={stats.routes} />}
      </section>

      {/* Housekeeping, in one line — it matters only when it is wrong. */}
      <footer className="border-hairline-faint text-meta mt-20 flex flex-wrap gap-x-6 gap-y-2 border-t pt-4 font-mono text-micro uppercase">
        <span>{count(stats.projects, "project")} saved</span>
        <span>
          {count(stats.shares, "link")} shared{stats.lockedShares ? ` · ${stats.lockedShares} locked` : ""}
        </span>
        <span>
          {count(stats.assets, "upload")} · {bytes(stats.assetBytes)}
        </span>
        <span>{free(stats.freeBytes)}</span>
        <span>up {uptime(stats.uptimeSeconds)}</span>
      </footer>
    </Shell>
  );
}

/** Today against the seven days before it, then the month in one clause. */
function trend(today: number, usual: number, month: number): string {
  const avg = Math.round(usual);
  const vs =
    avg === 0
      ? today
        ? "Nobody came in the week before."
        : "Quiet all week."
      : today >= avg * 1.25
        ? `Busier than usual — the week before averaged ${avg} a day.`
        : today <= avg * 0.75
          ? `Quieter than usual — the week before averaged ${avg} a day.`
          : `About usual — the week before averaged ${avg} a day.`;
  return `${vs} ${month.toLocaleString()} requests in the last 30 days.`;
}

/**
 * Thirty days, one bar each. Today is the only bar in the accent, and the
 * busiest day carries its own number so the scale needs no axis.
 */
function Month({ series }: { series: AdminStats["series"] }) {
  const max = Math.max(1, ...series.map((d) => d.visitors));
  const peak = series.findIndex((d) => d.visitors === max && max > 0);
  return (
    <figure className="mt-14">
      <div className="flex h-56 items-end gap-[3px] sm:h-72 sm:gap-1.5" role="img" aria-label="callers per day, last 30 days">
        {series.map((d, i) => {
          const last = i === series.length - 1;
          return (
            <div
              key={d.day}
              className="tooltip group relative flex h-full flex-1 items-end"
              data-tip={`${d.day} · ${d.visitors} callers · ${d.hits} requests`}
              data-tip-pos={i < series.length / 2 ? "top-left" : "top-right"}
            >
              {i === peak && !last ? (
                <span className="text-label absolute inset-x-0 text-center font-mono text-micro tracking-normal tabular-nums" style={{ bottom: `calc(${(d.visitors / max) * 100}% + 6px)` }}>
                  {d.visitors}
                </span>
              ) : null}
              <span
                className={cn(
                  "block w-full rounded-t-[2px] transition-colors duration-200",
                  last ? "bg-indigo" : "bg-ink/25 group-hover:bg-ink/60",
                )}
                style={{ height: `${d.visitors ? Math.max(3, (d.visitors / max) * 100) : 0.75}%` }}
              />
            </div>
          );
        })}
      </div>
      <figcaption className="border-hairline text-meta flex justify-between border-t pt-3 font-mono text-micro uppercase">
        <span>{short(series[0]?.day)}</span>
        <span>callers per day</span>
        <span className="text-indigo">today</span>
      </figcaption>
    </figure>
  );
}

/** Routes by use, in the words of the thing people did. The raw route is a hover away. */
function Ranked({ routes }: { routes: AdminStats["routes"] }) {
  const max = routes[0]?.hits || 1;
  return (
    <ol className="flex flex-col gap-5">
      {routes.map((r) => (
        <li key={r.route} className="flex flex-col gap-2" title={r.route}>
          <span className="flex items-baseline justify-between gap-4">
            <span className="text-ink min-w-0 truncate font-sans text-body">{ROUTES[r.route.replace(/\/$/, "")] ?? r.route}</span>
            <span className="text-ink shrink-0 font-mono text-small font-bold tracking-normal tabular-nums">{r.hits.toLocaleString()}</span>
          </span>
          <span className="bg-ink/[0.07] block h-[3px] rounded-full" aria-hidden>
            <span className="bg-ink/55 block h-full rounded-full" style={{ width: `${Math.max(1, (r.hits / max) * 100)}%` }} />
          </span>
        </li>
      ))}
    </ol>
  );
}

const ROUTES: Record<string, string> = {
  "GET /api/tools": "Opened the launchpad",
  "GET /api/fonts": "Browsed fonts",
  "GET /api/fonts/:family/:variant": "Loaded a font",
  "POST /api/assets": "Uploaded an image",
  "GET /api/assets/:id": "Loaded an uploaded image",
  "GET /api/projects": "Listed projects",
  "POST /api/projects": "Saved a new project",
  "GET /api/projects/:id": "Opened a project",
  "PUT /api/projects/:id": "Saved a project",
  "DELETE /api/projects/:id": "Deleted a project",
  "POST /api/projects/:id/share": "Made a share link",
  "DELETE /api/projects/:id/share": "Removed a share link",
  "GET /api/share/:slug/meta": "Followed a share link",
  "GET /api/share/:slug": "Opened a shared project",
  "POST /api/render": "Rendered a preview on the server",
  "POST /api/render/batch": "Exported a batch",
  "POST /api/pdf/uploads": "Started a PDF tools upload",
  "POST /api/pdf/uploads/:id/complete": "Uploaded a file for the PDF tools",
  "POST /api/pdf/jobs": "Opened a PDF job",
  "DELETE /api/pdf/jobs/:id": "Discarded a PDF job",
  "POST /api/pdf/jobs/:id/tasks": "Ran a PDF task",
  "POST /api/pdf/jobs/:id/handoff": "Sent a merge to Compress",
  "GET /api/pdf/jobs/:id/result": "Downloaded a PDF result",
  "GET /api/pdf/worker": "Checked the PDF worker",
};

const count = (n: number, noun: string) => `${n.toLocaleString()} ${noun}${n === 1 ? "" : "s"}`;
const short = (day?: string) => (day ? day.slice(5).replace("-", ".") : "");

function free({ data, assets }: AdminStats["freeBytes"]): string {
  if (data === null && assets === null) return "disk —";
  if (data === assets || assets === null) return `${bytes(data ?? 0)} free`;
  if (data === null) return `${bytes(assets)} free`;
  return `${bytes(data)} free · ${bytes(assets)} free for uploads`;
}

function uptime(s: number): string {
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86_400)}d ${Math.floor((s % 86_400) / 3600)}h`;
}
