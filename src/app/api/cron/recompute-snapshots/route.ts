import { NextResponse } from "next/server";
import { insertDailySnapshots } from "../../../../lib/snapshot-job";
export const dynamic = "force-dynamic";
async function handle(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(await insertDailySnapshots());
}
export const POST = handle;
export const GET = handle;
