import { NextResponse } from "next/server";
import { computeMissingReleaseReactions } from "../../../../../lib/ingestion";
import { ingestFredPrices } from "../../../../../lib/price-job";
import { insertDailySnapshots } from "../../../../../lib/snapshot-job";
export const dynamic = "force-dynamic";
const steps = { "ingest-prices": ingestFredPrices, "compute-reactions": computeMissingReleaseReactions, "insert-snapshots": insertDailySnapshots } as const;
export async function POST(request: Request, { params }: { params: { step: string } }) {
  const token = process.env.ADMIN_TOKEN;
  if (!token || request.headers.get("authorization") !== `Bearer ${token}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const action = steps[params.step as keyof typeof steps];
  if (!action) return NextResponse.json({ error: "Unknown job step" }, { status: 404 });
  try { const result = await action(); const partial = params.step === "ingest-prices" && !!(result as { failed?: boolean }).failed; return NextResponse.json({ step: params.step, result }, { status: partial ? 207 : 200 }); }
  catch (error) { const message = error instanceof Error ? error.message : String(error); console.error(`Manual ${params.step} failed`, error); return NextResponse.json({ error: message }, { status: 500 }); }
}