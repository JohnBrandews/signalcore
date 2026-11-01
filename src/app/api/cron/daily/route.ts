import { NextResponse } from "next/server";
import { ingestFredPrices } from "../../../../lib/price-job";
import { computeMissingReleaseReactions } from "../../../../lib/ingestion";
import { insertDailySnapshots } from "../../../../lib/snapshot-job";
export const dynamic = "force-dynamic";
async function handle(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const steps: Record<string, unknown> = {};
  const errors: string[] = [];
  try { steps.prices = await ingestFredPrices(); if ((steps.prices as { failed: boolean }).failed) errors.push("one or more FRED series failed"); }
  catch (error) { const message = error instanceof Error ? error.message : String(error); console.error("Daily price step failed", error); errors.push(`price ingestion: ${message}`); }
  try { steps.reactions = await computeMissingReleaseReactions(); }
  catch (error) { const message = error instanceof Error ? error.message : String(error); console.error("Daily reaction step failed", error); errors.push(`release reactions: ${message}`); }
  try { steps.snapshots = await insertDailySnapshots(); }
  catch (error) { const message = error instanceof Error ? error.message : String(error); console.error("Daily snapshot step failed", error); errors.push(`snapshots: ${message}`); }
  return NextResponse.json({ order: ["prices", "reactions", "snapshots"], steps, errors }, { status: errors.length ? 207 : 200 });
}
export const GET = handle;
export const POST = handle;
