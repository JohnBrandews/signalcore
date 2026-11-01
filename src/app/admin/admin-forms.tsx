"use client";
import { FormEvent, useState } from "react";

const JOBS = [
  ["ingest-prices", "Ingest FRED prices"],
  ["compute-reactions", "Compute missing release reactions"],
  ["insert-snapshots", "Insert daily snapshot"],
] as const;

export default function AdminForms() {
  const [message, setMessage] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  async function release(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    const body: Record<string, unknown> = Object.fromEntries(data.entries());
    for (const key of ["actual", "forecast", "previous"]) body[key] = body[key] === "" ? null : Number(body[key]);
    const response = await fetch("/api/admin/releases", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) });
    const result = await response.json(); setMessage(response.ok ? `Saved release ${result.release.externalId}.` : result.error ?? "Could not save release.");
  }
  async function prices(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    const response = await fetch("/api/admin/prices", { method: "POST", headers: { authorization: `Bearer ${token}` }, body: form });
    const result = await response.json(); setMessage(`Saved ${result.accepted ?? 0} price rows. ${result.errors?.map((e: { row: number; error: string }) => `Row ${e.row}: ${e.error}`).join(" ") ?? result.error ?? ""}`);
  }
  async function runJob(step: string) {
    setBusy(true);
    try {
      const response = await fetch(`/api/admin/jobs/${step}`, { method: "POST", headers: { authorization: `Bearer ${token}` } });
      const result = await response.json();
      setMessage(response.ok ? `${step} finished: ${JSON.stringify(result.result)}` : result.error ?? "Job failed.");
    } catch { setMessage("Could not reach the job route."); }
    finally { setBusy(false); }
  }
  return <main className="mx-auto max-w-3xl px-5 py-10">
    <h1 className="text-3xl font-semibold">Admin data entry</h1>
    <p className="my-3 text-slate-600">Requests require ADMIN_TOKEN. Release timestamps must include Z (UTC). CSV prices accept symbol,date,close and currently allow XAUUSD manual uploads.</p>
    <label className="block">Admin token<input className="mt-1 block w-full rounded border p-2" type="password" value={token} onChange={e => setToken(e.target.value)} autoComplete="off" /></label>
    <section className="my-8 rounded border p-5"><h2 className="text-xl font-semibold">Manual job triggers</h2><p className="mb-3 text-sm text-slate-600">Each step can be run independently; the daily cron runs them in sequence.</p><div className="flex flex-wrap gap-2">{JOBS.map(([step, label]) => <button key={step} disabled={busy} onClick={() => void runJob(step)} className="rounded bg-slate-800 px-3 py-2 text-white disabled:opacity-50">{label}</button>)}</div></section>
    <form onSubmit={release} className="my-8 grid gap-3 rounded border p-5"><h2 className="text-xl font-semibold">Add or edit release</h2><input required name="externalId" placeholder="Event ID" className="rounded border p-2"/><input required name="indicator" placeholder="Indicator, e.g. US_CORE_CPI" className="rounded border p-2"/><input required name="releasedAt" placeholder="2026-10-02T13:30:00Z" className="rounded border p-2"/><div className="grid grid-cols-3 gap-2">{["actual","forecast","previous"].map(key=><input key={key} name={key} placeholder={key} type="number" step="any" className="min-w-0 rounded border p-2"/>)}</div><div className="grid grid-cols-2 gap-2"><input required name="unit" defaultValue="percent" className="rounded border p-2"/><input required name="period" placeholder="Period" className="rounded border p-2"/></div><button className="rounded bg-slate-900 p-2 text-white">Save release</button></form>
    <form onSubmit={prices} className="grid gap-3 rounded border p-5"><h2 className="text-xl font-semibold">Upload XAUUSD prices</h2><p className="text-sm">CSV columns: symbol,date,close</p><input required name="file" type="file" accept=".csv,text/csv"/><button className="rounded bg-slate-900 p-2 text-white">Upload CSV</button></form>
    <p role="status" className="mt-4 whitespace-pre-wrap">{message}</p>
  </main>;
}
