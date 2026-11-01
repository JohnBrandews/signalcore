import { NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";
import { INDICATOR_RULES } from "../../../../rules";

function authorized(request: Request) { const token = process.env.ADMIN_TOKEN; return !!token && request.headers.get("authorization") === `Bearer ${token}`; }
const validUtc = (value: unknown): value is string => typeof value === "string" && /(?:Z|\+00:00)$/.test(value) && Number.isFinite(Date.parse(value));
export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (!body || typeof body.externalId !== "string" || !body.externalId.trim() || typeof body.indicator !== "string" || !Object.hasOwn(INDICATOR_RULES, body.indicator) || !validUtc(body.releasedAt) || typeof body.unit !== "string" || typeof body.period !== "string" || !["percent", "index", "thousands", "basis_points", "text"].includes(body.unit) || (body.policySignal != null && !["HAWKISH", "NEUTRAL", "DOVISH"].includes(body.policySignal)) || (body.expectedPolicySignal != null && !["HAWKISH", "NEUTRAL", "DOVISH"].includes(body.expectedPolicySignal))) return NextResponse.json({ error: "Invalid release. Provide externalId, known indicator, UTC releasedAt, unit, and period." }, { status: 400 });
  for (const key of ["actual", "forecast", "previous"] as const) if (body[key] !== undefined && body[key] !== null && (typeof body[key] !== "number" || !Number.isFinite(body[key]))) return NextResponse.json({ error: `${key} must be a finite number or null` }, { status: 400 });
  const release = await prisma.release.upsert({ where: { externalId: body.externalId.trim() }, create: { externalId: body.externalId.trim(), indicator: body.indicator, releasedAt: new Date(body.releasedAt), actual: body.actual ?? null, forecast: body.forecast ?? null, previous: body.previous ?? null, unit: body.unit, period: body.period, policySignal: body.policySignal ?? null, expectedPolicySignal: body.expectedPolicySignal ?? null, source: "admin" }, update: { indicator: body.indicator, releasedAt: new Date(body.releasedAt), actual: body.actual ?? null, forecast: body.forecast ?? null, previous: body.previous ?? null, unit: body.unit, period: body.period, policySignal: body.policySignal ?? null, expectedPolicySignal: body.expectedPolicySignal ?? null, source: "admin" } });
  return NextResponse.json({ release }, { status: 201 });
}




