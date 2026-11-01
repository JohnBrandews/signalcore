import { NextResponse } from "next/server";
import { ingestFredPrices } from "../../../../lib/price-job";
export const dynamic = "force-dynamic";
async function handle(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const result = await ingestFredPrices();
  return NextResponse.json(result, { status: result.failed ? 207 : 200 });
}
export const POST = handle;
export const GET = handle;
