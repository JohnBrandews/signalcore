import { NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";
const authorized = (request: Request) => !!process.env.ADMIN_TOKEN && request.headers.get("authorization") === `Bearer ${process.env.ADMIN_TOKEN}`;
export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "CSV file is required" }, { status: 400 });
  const text = await file.text();
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  const errors: Array<{ row: number; error: string }> = [];
  const accepted: Array<{ symbol: string; date: Date; close: number; source: string }> = [];
  const headers = (lines.shift() ?? "").split(",").map((x) => x.trim().toLowerCase());
  const indexes = { symbol: headers.indexOf("symbol"), date: headers.indexOf("date"), close: headers.indexOf("close") };
  if (Object.values(indexes).some((i) => i < 0)) return NextResponse.json({ error: "Required CSV header: symbol,date,close", accepted: 0, errors: [] }, { status: 400 });
  for (let i = 0; i < lines.length; i++) {
    const cells = lines[i].split(",").map((x) => x.trim());
    const symbol = cells[indexes.symbol]; const dateText = cells[indexes.date]; const close = Number(cells[indexes.close]);
    if (symbol !== "XAUUSD") { errors.push({ row: i + 2, error: "Only manual XAUUSD uploads are supported" }); continue; }
    const date = new Date(`${dateText}T00:00:00.000Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== dateText || !Number.isFinite(close) || close <= 0) { errors.push({ row: i + 2, error: "Expected a valid YYYY-MM-DD date and positive numeric close" }); continue; }
    accepted.push({ symbol, date, close, source: "admin" });
  }
  let saved = 0;
  for (const row of accepted) {
    await prisma.priceBar.upsert({ where: { symbol_date: { symbol: row.symbol, date: row.date } }, create: row, update: { close: row.close, source: row.source } });
    saved++;
  }
  if (saved) {
    const latest = await prisma.priceBar.findFirst({ where: { symbol: "XAUUSD" }, orderBy: { date: "desc" } });
    if (latest) { const now = new Date(); const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()); const lagDays = Math.max(0, Math.floor((today - latest.date.getTime()) / 86400000)); await prisma.priceSeriesStatus.upsert({ where: { symbol: "XAUUSD" }, create: { symbol: "XAUUSD", latestDate: latest.date, lagDays, source: "admin" }, update: { latestDate: latest.date, lagDays, source: "admin" } }); }
  }
  return NextResponse.json({ accepted: saved, errors });
}



