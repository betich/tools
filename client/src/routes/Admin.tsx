import { useCallback, useEffect, useState, type FormEvent } from "react";
import { PageHead, Shell } from "@/components/Shell";
import { Button, Card, Empty, Field, Input, Section, Sections, Stat, TextButton } from "@/components/ui";
import { ApiError, api, type AdminStats } from "@/lib/api";
import { bytes, stamp } from "@/lib/format";

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
 * Usage at a glance: what the API has seen. Page views and everything that
 * happens only in the browser (squoosh never calls the server) are in Google
 * Analytics instead.
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
        <PageHead title="admin" note="Usage of the tools and the API behind them." />
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

  const week = stats.series.slice(-7);
  const sum = (rows: { hits: number; visitors: number }[], k: "hits" | "visitors") => rows.reduce((n, r) => n + r[k], 0);
  const today = stats.series.at(-1);

  return (
    <Shell width="page">
      <PageHead
        title="admin"
        note="What the API has seen. Page views, and squoosh — which never calls the server — are in Google Analytics."
        actions={
          <>
            <TextButton onClick={() => void load(password)} disabled={busy}>
              {busy ? "loading…" : "refresh"}
            </TextButton>
            <a className="text-meta hover:text-indigo font-mono text-meta uppercase transition-colors duration-200" href="https://analytics.google.com/" target="_blank" rel="noreferrer">
              analytics ↗
            </a>
            <TextButton onClick={signOut}>sign out</TextButton>
          </>
        }
      />

      <Sections>
        <Section title="traffic">
          <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
            <Stat label="callers today" value={today?.visitors ?? 0} accent />
            <Stat label="callers · 7d (daily sum)" value={sum(week, "visitors")} />
            <Stat label="requests today" value={today?.hits ?? 0} />
            <Stat label="requests · 30d" value={sum(stats.series, "hits")} />
          </div>
          <Card>
            <Bars series={stats.series} />
          </Card>
        </Section>

        <Section title="stored">
          <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
            <Stat label="projects" value={stats.projects} />
            <Stat label="share links" value={`${stats.shares} · ${stats.lockedShares} locked`} />
            <Stat label="uploads" value={`${stats.assets} · ${bytes(stats.assetBytes)}`} />
            <Stat label="uptime" value={uptime(stats.uptimeSeconds)} />
            <Stat label="free · data" value={stats.freeBytes.data === null ? "—" : bytes(stats.freeBytes.data)} />
            <Stat label="free · uploads" value={stats.freeBytes.assets === null ? "—" : bytes(stats.freeBytes.assets)} />
          </div>
        </Section>

        <Section title="routes · 30 days">
          {stats.routes.length === 0 ? (
            <Empty>no requests yet</Empty>
          ) : (
            <Rows rows={stats.routes.map((r) => [r.route, r.hits.toLocaleString()])} />
          )}
        </Section>

        <Section title="recently saved projects">
          {stats.recentProjects.length === 0 ? (
            <Empty>no projects yet</Empty>
          ) : (
            <Rows rows={stats.recentProjects.map((p) => [p.name || p.id, stamp(p.updatedAt)])} />
          )}
        </Section>
      </Sections>
    </Shell>
  );
}

/** Callers per day as bars; the day's request count rides in the tooltip. */
function Bars({ series }: { series: AdminStats["series"] }) {
  const max = Math.max(1, ...series.map((d) => d.visitors));
  return (
    <div className="flex flex-col gap-3">
      <div className="flex h-32 items-end gap-1" role="img" aria-label="callers per day, last 30 days">
        {series.map((d) => (
          <div
            key={d.day}
            className="tooltip group flex h-full flex-1 items-end"
            data-tip={`${d.day} · ${d.visitors} callers · ${d.hits} requests`}
          >
            <span
              className="bg-ink/55 group-hover:bg-indigo block w-full rounded-t-[2px] transition-colors duration-200"
              style={{ height: `${Math.max(d.visitors ? 4 : 1, (d.visitors / max) * 100)}%` }}
            />
          </div>
        ))}
      </div>
      <div className="text-meta flex justify-between font-mono text-meta uppercase">
        <span>{series[0]?.day}</span>
        <span>callers per day · peak {max}</span>
        <span>{series.at(-1)?.day}</span>
      </div>
    </div>
  );
}

function Rows({ rows }: { rows: [string, string][] }) {
  return (
    <ul className="flex flex-col">
      {rows.map(([name, value], i) => (
        <li key={`${name}-${i}`} className="border-hairline-faint flex items-baseline justify-between gap-4 border-b py-2 last:border-b-0">
          <span className="text-label min-w-0 truncate font-mono text-label tracking-normal">{name}</span>
          <span className="text-ink shrink-0 font-mono text-label tabular-nums tracking-normal">{value}</span>
        </li>
      ))}
    </ul>
  );
}

function uptime(s: number): string {
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86_400)}d ${Math.floor((s % 86_400) / 3600)}h`;
}
