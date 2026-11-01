import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import "./globals.css";
export const metadata: Metadata = { title: "SignalCore", description: "Rule-based economic release interpretation." };
export const dynamic = "force-dynamic";
export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  let series: Array<{ symbol: string; latestDate: Date | null; lagDays: number | null }> = [];
  try { series = await prisma.priceSeriesStatus.findMany({ orderBy: { symbol: "asc" } }); }
  catch (error) { console.error("Could not read series update status", error); }
  return <html lang="en"><body><nav className="mx-auto flex max-w-5xl flex-wrap gap-4 px-5 pt-5 text-sm"><Link href="/">Home</Link><Link href="/releases">Releases</Link><Link href="/track-record">Track record</Link><Link href="/methodology">Methodology</Link><Link href="/admin">Admin</Link></nav><aside className="mx-auto mt-3 max-w-5xl px-5 text-xs text-slate-500" aria-label="Market data freshness">Data through: {series.length ? series.map(s => `${s.symbol} ${s.latestDate?.toISOString().slice(0,10) ?? "no data"}${s.lagDays === null ? "" : ` (${s.lagDays}d lag)`}`).join(" · ") : "no data"}. FRED DXY series is a broad dollar index proxy.</aside>{children}<footer className="mx-auto max-w-5xl border-t border-slate-200 px-5 py-5 text-sm text-slate-500">Rule based analysis, not investment advice.</footer></body></html>;
}

