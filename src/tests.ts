import { replay } from "./backtest";
import { BIAS_DIRECTION_THRESHOLD, MIXED_REGIME_STATE } from "./config";
import {
  DailyRow,
  PricePoint,
  PriceSeriesMap,
  evaluateDaily,
  evaluateIsolatedReleases,
  scoreBucketReport,
  spearmanRankCorrelation,
} from "./daily-backtest";
import { applyTimeDecay } from "./decay";
import { MacroEngine } from "./engine";
import { EconomicEvent } from "./models";
import { REGIME_RULES } from "./rules";
import { calculateSurprise } from "./surprise";
import { TEST_EVENTS as T, TestEvent } from "./test-data";

let passed = 0;

const test = (name: string, fn: () => void) => {
  try {
    fn();
    passed++;
  } catch (error) {
    throw new Error(`${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
};

const ok = (condition: boolean, message = "assertion failed") => {
  if (!condition) throw new Error(message);
};

const snapAt = (asOf: string, ...events: TestEvent[]) => {
  const engine = new MacroEngine();
  events.forEach((event) => engine.process(event));
  return engine.snapshot(asOf);
};

const snap = (...events: TestEvent[]) => snapAt("2024-02-01T19:00:00Z", ...events);

const factorOf = (asOf: string, factor: string, ...events: TestEvent[]) =>
  snapAt(asOf, ...events).factors.find((f) => f.factor === factor)!;

test("1 strong inflation has positive directional surprise", () =>
  ok(calculateSurprise(T.strongInflation).directional > 0));

test("2 weak inflation has negative directional surprise", () =>
  ok(calculateSurprise(T.weakInflation).directional < 0));

test("3 strong NFP increases labor pressure", () =>
  ok(snap(T.strongNfp).factors.find((f) => f.factor === "LABOR_PRESSURE")!.direction === 1));

test("4 weak NFP decreases labor pressure", () =>
  ok(snap(T.weakNfp).factors.find((f) => f.factor === "LABOR_PRESSURE")!.direction === -1));

test("5 hawkish FOMC increases policy pressure", () =>
  ok(
    snap(T.hawkish).factors.find((f) => f.factor === "MONETARY_POLICY_PRESSURE")!.direction === 1,
  ));

test("6 dovish FOMC decreases policy pressure", () =>
  ok(
    snap(T.dovish).factors.find((f) => f.factor === "MONETARY_POLICY_PRESSURE")!.direction === -1,
  ));

test("7 inflation and weak growth remain separate regime evidence", () => {
  const s = snap(T.strongInflation, T.weakGdp);
  ok(s.regime.dimensions.find((d) => d.dimension === "INFLATION")!.state === "inflationary");
  ok(s.regime.dimensions.find((d) => d.dimension === "GROWTH")!.state === "slowing growth");
});

test("8 old information loses influence", () => {
  const d = applyTimeDecay(1, "2024-01-01T00:00:00Z", "2024-01-11T00:00:00Z", 120);
  ok(Math.abs(d.effectiveImpact - 0.25) < 0.0001);
});

test("9 aligned events strengthen factor evidence", () => {
  const one = snap(T.strongInflation).factors.find((f) => f.factor === "INFLATION_PRESSURE")!;
  const two = snap(T.strongInflation, T.hotPce).factors.find(
    (f) => f.factor === "INFLATION_PRESSURE",
  )!;
  ok(two.contributions.length > one.contributions.length && two.direction === 1);
});

test("10 recent major contradiction preserves conflict", () => {
  const s = snap(T.strongInflation, T.weakInflation);
  const f = s.factors.find((x) => x.factor === "INFLATION_PRESSURE")!;
  ok(f.conflicting && f.contributions.length === 2);
});

test("11 replay is chronological and carries no future events", () => {
  const points = replay([T.strongInflation, T.strongNfp]);
  ok(
    points[0].snapshot.factors.find((f) => f.factor === "INFLATION_PRESSURE")!.contributions
      .length === 0,
  );
  ok(
    points[1].snapshot.factors.find((f) => f.factor === "INFLATION_PRESSURE")!.contributions
      .length === 1,
  );
});

// --- Bug A regression tests: strength must be a magnitude, not an agreement ratio ---

test("12 a bigger surprise produces a bigger factor strength", () => {
  const asOf = "2024-01-10T14:30:00Z"; // one hour after both releases
  const big = factorOf(asOf, "INFLATION_PRESSURE", T.strongInflation);
  const tiny = factorOf(asOf, "INFLATION_PRESSURE", T.tinyInflation);
  ok(big.direction === 1 && tiny.direction === 1, "both beats should read as inflationary");
  ok(
    big.strength > tiny.strength * 5,
    `expected a much larger strength for the big beat, got ${big.strength} vs ${tiny.strength}`,
  );
  // Both are single, unanimous contributions, so agreement cannot tell them apart.
  ok(Math.abs(big.agreement - tiny.agreement) < 1e-9, "agreement must be blind to surprise size");
});

test("13 the same event is weaker when it is older", () => {
  const fresh = factorOf("2024-01-11T13:30:00Z", "INFLATION_PRESSURE", T.strongInflation);
  const stale = factorOf("2024-04-09T13:30:00Z", "INFLATION_PRESSURE", T.strongInflation);
  ok(stale.strength < fresh.strength, "90-day-old evidence must be weaker than 1-day-old evidence");
  ok(stale.strength < 0.2, `stale strength should be near zero, got ${stale.strength}`);
});

test("14 instrument bias decays to NEUTRAL after a long gap with no new events", () => {
  const fresh = snapAt("2024-01-11T13:30:00Z", T.strongInflation).biases.XAUUSD;
  const stale = snapAt("2027-01-11T13:30:00Z", T.strongInflation).biases.XAUUSD;
  ok(fresh.direction !== "NEUTRAL", "a one-day-old CPI beat should still produce a direction");
  ok(stale.direction === "NEUTRAL", `expected NEUTRAL after three years, got ${stale.direction}`);
  ok(Math.abs(stale.netScore) < 1e-6, "net score should have decayed to ~0");
});

// --- Bug B regression test: regime.mixed must not be structurally forced to true ---

test("15 regime.mixed is false when every active dimension has aligned evidence", () => {
  const s = snap(T.strongInflation, T.strongNfp, T.strongGdp, T.hawkish);
  ok(
    s.regime.dimensions.length === REGIME_RULES.length,
    "one regime dimension per active regime rule",
  );
  const unnamed = s.regime.dimensions.filter((d) => d.state === MIXED_REGIME_STATE);
  ok(
    unnamed.length === 0,
    `every dimension should be named, unnamed: ${unnamed.map((d) => d.dimension)}`,
  );
  ok(s.regime.mixed === false, "regime.mixed should be false when all evidence agrees");
});

// --- Backtest: no look-ahead ---

const priceSeries = (start: string, count: number): PricePoint[] => {
  const base = Date.parse(`${start}T00:00:00Z`);
  return Array.from({ length: count }, (_, i) => ({
    date: new Date(base + i * 86_400_000).toISOString().slice(0, 10),
    close: 100 + i,
  }));
};

test("16 a future release cannot influence an earlier daily snapshot", () => {
  const prices: PriceSeriesMap = {
    XAUUSD: priceSeries("2024-01-01", 60),
    USDJPY: priceSeries("2024-01-01", 60),
  };
  const past: EconomicEvent = T.strongInflation; // 2024-01-10
  const future: EconomicEvent = {
    ...T.hawkish,
    id: "fomc-future",
    timestamp: "2024-02-01T19:00:00Z",
  };

  const without = evaluateDaily([past], prices);
  const with_ = evaluateDaily([past, future], prices);

  const before = (rows: DailyRow[]) => rows.filter((row) => row.date < "2024-02-01");
  ok(before(without).length > 0, "need rows before the future event to compare");
  ok(
    JSON.stringify(before(without)) === JSON.stringify(before(with_)),
    "rows dated before the future release changed when that release was added",
  );

  // And the test must not be vacuous: after the release, the rows do differ.
  const after = (rows: DailyRow[]) => rows.filter((row) => row.date >= "2024-02-02");
  ok(
    JSON.stringify(after(without)) !== JSON.stringify(after(with_)),
    "the future release should change later rows",
  );
});

test("17 daily evaluation emits one row per instrument per trading day", () => {
  const prices: PriceSeriesMap = {
    XAUUSD: priceSeries("2024-01-01", 30),
    USDJPY: priceSeries("2024-01-01", 30),
  };
  const rows = evaluateDaily([T.strongInflation], prices);
  ok(rows.length === 60, `expected 60 rows, got ${rows.length}`);
  ok(
    rows.filter((row) => row.forwardReturnPct[20] === null).length === 40,
    "tail has no 20d forward",
  );
});

test("18 score sign matches directional bias above the configured threshold", () => {
  const bullish = snap(T.strongInflation).biases.USDJPY;
  const bearish = snap(T.strongInflation).biases.XAUUSD;
  ok(bullish.score > BIAS_DIRECTION_THRESHOLD && bullish.direction === "BULLISH");
  ok(bearish.score < -BIAS_DIRECTION_THRESHOLD && bearish.direction === "BEARISH");
  ok(bullish.score === bullish.netScore && bearish.score === bearish.netScore);
});

test("19 score buckets split ordered evaluation days into quantiles", () => {
  const rows = Array.from({ length: 10 }, (_, index) => ({
    date: `2024-01-${String(index + 1).padStart(2, "0")}`,
    asOf: `2024-01-${String(index + 1).padStart(2, "0")}T21:00:00Z`,
    instrument: "XAUUSD",
    close: 100,
    direction: index < 5 ? "BEARISH" : "BULLISH",
    score: index - 5,
    netScore: index - 5,
    agreement: 1,
    confidence: 1,
    eventsVisible: 1,
    forwardReturnPct: { 5: index },
    isDirectionChange: false,
  })) as DailyRow[];
  const report = scoreBucketReport(rows, 5);
  ok(report.buckets.length === 5, `expected 5 buckets, got ${report.buckets.length}`);
  ok(
    report.buckets.every((bucket) => bucket.days === 2),
    "each bucket should contain two days",
  );
  ok(report.averageReturnMonotonicallyRises === true);
  ok(report.topBottomAverageReturnSpreadPct === 8, "top-bottom average spread should be 8");
});

test("20 Spearman rank correlation matches a known tied example", () => {
  const correlation = spearmanRankCorrelation([1, 2, 2, 4], [10, 30, 20, 40]);
  ok(correlation !== null && Math.abs(correlation - 0.948683298) < 1e-8, `got ${correlation}`);
});

test("21 isolated indicator snapshots exclude other indicators' events", () => {
  const prices: PriceSeriesMap = {
    XAUUSD: priceSeries("2024-01-01", 60),
    USDJPY: priceSeries("2024-01-01", 60),
  };
  const rows = evaluateIsolatedReleases([T.strongNfp, T.strongInflation], prices);
  const cpiGold = rows.find(
    (row) => row.eventId === T.strongInflation.id && row.instrument === "XAUUSD",
  );
  const standalone = snapAt(T.strongInflation.timestamp, T.strongInflation).biases.XAUUSD;
  if (cpiGold === undefined) throw new Error("CPI isolated row must exist");
  ok(cpiGold.score === standalone.score, "CPI isolated score included another indicator");
});

console.log(`${passed} deterministic Phase 0 tests passed`);
