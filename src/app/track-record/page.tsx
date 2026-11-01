import { prisma } from "../../lib/prisma";
export const dynamic = "force-dynamic";
type Direction = "BULLISH" | "BEARISH" | "NEUTRAL";
function ids(text: string): string[] { try { const value: unknown = JSON.parse(text); return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []; } catch { return []; } }
export default async function TrackRecordPage() {
  const [live, replay, allReleases, prices] = await Promise.all([
    prisma.biasSnapshot.findMany({ where: { origin: "live" }, orderBy: [{ instrument: "asc" }, { asOf: "asc" }] }),
    prisma.biasSnapshot.count({ where: { origin: "backfill" } }),
    prisma.release.findMany({ orderBy: { releasedAt: "asc" } }),
    prisma.priceBar.findMany({ where: { symbol: { in: ["XAUUSD", "USDJPY"] } }, orderBy: [{ symbol: "asc" }, { date: "asc" }] }),
  ]);
  const firstLive = live.reduce<Date | null>((min, row) => !min || row.asOf < min ? row.asOf : min, null);
  const late = firstLive ? allReleases.filter(release => release.releasedAt >= firstLive && release.createdAt.getTime() > release.releasedAt.getTime() + 86_400_000) : [];
  const lateWithoutEarlierSnapshots = late.filter(release => live.some(snapshot => snapshot.instrument === "XAUUSD" && snapshot.asOf >= release.releasedAt && !ids(snapshot.releaseIds).includes(release.id)) || live.some(snapshot => snapshot.instrument === "USDJPY" && snapshot.asOf >= release.releasedAt && !ids(snapshot.releaseIds).includes(release.id)));
  const byInstrument = new Map<string, typeof prices>();
  for (const bar of prices) byInstrument.set(bar.symbol, [...(byInstrument.get(bar.symbol) ?? []), bar]);
  const instrumentRows = ["XAUUSD", "USDJPY"].map(instrument => {
    const snapshots = live.filter(row => row.instrument === instrument);
    const series = byInstrument.get(instrument) ?? [];
    const dateIndex = new Map(series.map((bar, index) => [bar.date.toISOString().slice(0,10), index]));
    let independentRuns = 0; let priorDirection: Direction | undefined;
    for (const row of snapshots) { if (row.direction !== priorDirection) independentRuns++; priorDirection = row.direction as Direction; }
    const windows = [5,20].map(days => {
      const returns: Array<{ direction: Direction; move: number }> = [];
      for (const row of snapshots) {
        const index = dateIndex.get(row.asOf.toISOString().slice(0,10));
        if (index === undefined || index + days >= series.length) continue;
        const start = series[index].close; const end = series[index + days].close;
        if (start !== 0) returns.push({ direction: row.direction as Direction, move: (end / start - 1) * 100 });
      }
      const calls = returns.filter(item => item.direction !== "NEUTRAL");
      const hits = calls.filter(item => item.direction === "BULLISH" ? item.move > 0 : item.move < 0).length;
      const bullish = returns.filter(item => item.move > 0).length;
      return { days, completed: returns.length, directional: calls.length, hitRate: calls.length ? hits / calls.length * 100 : null, baseline: returns.length ? bullish / returns.length * 100 : null };
    });
    return { instrument, snapshots, independentRuns, windows };
  });
  const loggedDays = new Set(live.map(row => row.asOf.toISOString().slice(0,10))).size;
  return <main className="mx-auto max-w-6xl px-5 py-8"><h1 className="text-3xl font-semibold">Live forward-test track record</h1><p className="mt-2 text-slate-600">Only origin=live snapshots count here. Dev and historical backfill are excluded from forward-test statistics.</p><p className="mt-3">Start: {firstLive?.toISOString().slice(0,10) ?? "not started"} · {loggedDays} distinct days logged · {live.length} instrument snapshots.</p>
    {late.length > 0 && <aside role="alert" className="mt-5 rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-950"><h2 className="font-semibold">Late release data entered</h2><p>{late.length} release(s) were entered more than 24 hours after their release time. Prior snapshots that omit these release IDs were computed without that late data{lateWithoutEarlierSnapshots.length ? `; ${lateWithoutEarlierSnapshots.length} release(s) are absent from at least one affected live snapshot` : "."}</p><ul className="mt-2 list-disc pl-5 text-sm">{late.slice(0,10).map(row=><li key={row.id}>{row.externalId}: released {row.releasedAt.toISOString()}, entered {row.createdAt.toISOString()}</li>)}</ul></aside>}
    <div className="mt-6 grid gap-4 md:grid-cols-2">{instrumentRows.map(({instrument,snapshots,independentRuns,windows})=><section key={instrument} className="rounded-xl border bg-white p-5"><h2 className="text-xl font-semibold">{instrument}</h2><p className="mt-1 text-sm text-slate-600">{independentRuns} independent direction runs · {snapshots.length} snapshots</p>{independentRuns<30&&<p className="mt-3 rounded bg-amber-50 p-3 text-sm text-amber-900">Too early to judge: fewer than 30 independent direction runs.</p>}<div className="mt-4 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th className="p-2">Window</th><th className="p-2">Completed</th><th className="p-2">Directional hit rate</th><th className="p-2">Always bullish baseline</th></tr></thead><tbody>{windows.map(window=><tr key={window.days} className="border-t"><td className="p-2">{window.days} trading days</td><td className="p-2">{window.completed}</td><td className="p-2">{window.hitRate===null?"—":`${window.hitRate.toFixed(1)}%`}</td><td className="p-2">{window.baseline===null?"—":`${window.baseline.toFixed(1)}%`}</td></tr>)}</tbody></table></div><p className="mt-2 text-xs text-slate-500">Hit rate excludes neutral calls. The always-bullish baseline uses every completed window.</p></section>)}</div>
    <section className="mt-8 rounded-xl border bg-slate-50 p-5"><h2 className="text-xl font-semibold">Historical replay (not a forward test)</h2><p>{replay} backfill snapshots are stored separately and are excluded from all live metrics above.</p></section>
  </main>;
}