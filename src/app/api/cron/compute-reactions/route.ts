import { NextResponse } from "next/server";
import { computeMissingReleaseReactions } from "../../../../lib/ingestion";
export const dynamic = "force-dynamic";
async function handle(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(await computeMissingReleaseReactions());
}
export const GET = handle;
export const POST = handle;
