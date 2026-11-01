import {
  EconomicIndicator,
  MacroFactor,
  MarketInstrument,
  PolicySignal,
  RegimeDimension,
} from "./models";

export interface IndicatorRule {
  normalizationScale: number;
  favorableDirection: 1 | -1;
  halfLifeHours: number;
  confidence: number;
  description: string;
}

export interface FactorRule {
  indicator: EconomicIndicator;
  factor: MacroFactor;
  weight: number;
  confidence: number;
  halfLifeHours?: number;
  relationship: string;
  uncertainty: string;
  regimeDependent: boolean;
}

export interface InstrumentRule {
  instrument: MarketInstrument;
  factor: MacroFactor;
  direction: 1 | -1;
  weight: number;
  confidence: number;
  relationship: string;
  uncertainty: string;
  regimeDependent: boolean;
  invalidation: string;
}

export interface RegimeRule {
  dimension: RegimeDimension;
  factors: MacroFactor[];
  positive: string;
  negative: string;
}

export const POLICY_VALUE: Record<PolicySignal, number> = { HAWKISH: 1, NEUTRAL: 0, DOVISH: -1 };

/**
 * Editable hypotheses: scales are meaningful release sizes, NOT statistical
 * z-scores. Every weight needs later calibration.
 */
const I = (
  normalizationScale: number,
  favorableDirection: 1 | -1,
  halfLifeHours: number,
  confidence: number,
  description: string,
): IndicatorRule => ({
  normalizationScale,
  favorableDirection,
  halfLifeHours,
  confidence,
  description,
});

export const INDICATOR_RULES: Record<EconomicIndicator, IndicatorRule> = {
  US_CPI: I(0.2, 1, 720, 0.72, "Higher-than-forecast inflation"),
  US_CORE_CPI: I(0.2, 1, 720, 0.76, "Higher-than-forecast core inflation"),
  US_PCE: I(0.2, 1, 720, 0.7, "Higher-than-forecast inflation"),
  US_CORE_PCE: I(0.2, 1, 720, 0.74, "Higher-than-forecast core inflation"),
  US_NFP: I(100, 1, 336, 0.68, "Stronger payrolls"),
  US_UNEMPLOYMENT_RATE: I(0.1, -1, 336, 0.72, "Lower unemployment is stronger labor"),
  US_AVERAGE_HOURLY_EARNINGS: I(0.2, 1, 336, 0.62, "Stronger wage growth"),
  US_GDP: I(0.4, 1, 2160, 0.7, "Stronger growth"),
  US_ISM_MANUFACTURING_PMI: I(2, 1, 720, 0.6, "Stronger manufacturing activity"),
  US_ISM_SERVICES_PMI: I(2, 1, 720, 0.64, "Stronger services activity"),
  FOMC_RATE_DECISION: I(1, 1, 1080, 0.82, "Structured policy stance surprise"),
  FOMC_STATEMENT: I(1, 1, 1080, 0.65, "Structured statement stance"),
  FED_SPEECH: I(1, 1, 240, 0.48, "Structured speech stance"),
};

const r = (
  indicator: EconomicIndicator,
  factor: MacroFactor,
  weight: number,
  relationship: string,
  uncertainty: string,
  regimeDependent = true,
): FactorRule => ({
  indicator,
  factor,
  weight,
  confidence: 0.65,
  relationship,
  uncertainty,
  regimeDependent,
});

const INFL: EconomicIndicator[] = ["US_CPI", "US_CORE_CPI", "US_PCE", "US_CORE_PCE"];
const LAB: EconomicIndicator[] = ["US_NFP", "US_UNEMPLOYMENT_RATE"];
const GROW: EconomicIndicator[] = ["US_GDP", "US_ISM_MANUFACTURING_PMI", "US_ISM_SERVICES_PMI"];
const FED: EconomicIndicator[] = ["FOMC_RATE_DECISION", "FOMC_STATEMENT", "FED_SPEECH"];

const indirect = "Indirect and dependent on policy/risk regime.";

export const FACTOR_RULES: FactorRule[] = [
  ...INFL.flatMap((x) => [
    r(
      x,
      "INFLATION_PRESSURE",
      0.95,
      "Inflation release updates price pressure.",
      "Measurement/revision noise.",
      false,
    ),
    r(
      x,
      "MONETARY_POLICY_PRESSURE",
      0.55,
      "Inflation can encourage tighter policy expectations.",
      indirect,
    ),
    r(
      x,
      "REAL_YIELD_PRESSURE",
      0.38,
      "Tighter expectations can lift real yields.",
      "Inflation expectations can offset.",
    ),
  ]),
  ...LAB.flatMap((x) => [
    r(
      x,
      "LABOR_PRESSURE",
      0.95,
      "Labor release updates labor resilience.",
      "Survey and participation effects.",
      false,
    ),
    r(
      x,
      "MONETARY_POLICY_PRESSURE",
      0.38,
      "Labor resilience can support tighter expectations.",
      indirect,
    ),
  ]),
  r(
    "US_AVERAGE_HOURLY_EARNINGS",
    "LABOR_PRESSURE",
    0.45,
    "Wages add labor pressure.",
    "Composition effects.",
  ),
  r(
    "US_AVERAGE_HOURLY_EARNINGS",
    "INFLATION_PRESSURE",
    0.35,
    "Wages may add inflation pressure.",
    "Pass-through is variable.",
  ),
  ...GROW.map((x) =>
    r(
      x,
      "GROWTH_PRESSURE",
      0.95,
      "Activity release updates growth evidence.",
      "GDP revisions and PMI survey noise.",
      false,
    ),
  ),
  ...FED.flatMap((x) => [
    r(
      x,
      "MONETARY_POLICY_PRESSURE",
      0.98,
      "Policy communication updates policy pressure.",
      "Classification and pricing can differ.",
    ),
    r(
      x,
      "REAL_YIELD_PRESSURE",
      0.65,
      "Policy repricing can affect real yields.",
      "Term premium can offset.",
    ),
  ]),
  ...[...INFL, ...LAB, ...GROW, ...FED].map((x) =>
    r(x, "USD_PRESSURE", 0.4, "Stronger/tighter US evidence can support USD.", indirect),
  ),
];

const ir = (
  instrument: MarketInstrument,
  factor: MacroFactor,
  direction: 1 | -1,
  weight: number,
  relationship: string,
  uncertainty: string,
  invalidation: string,
): InstrumentRule => ({
  instrument,
  factor,
  direction,
  weight,
  confidence: 0.65,
  relationship,
  uncertainty,
  regimeDependent: true,
  invalidation,
});

/**
 * TODO(safe-haven): SAFE_HAVEN_PRESSURE is disabled, not deleted. No entry in
 * FACTOR_RULES feeds it, so it scored a constant 0 while still being counted as
 * a contributor here — which dragged every gold/yen bias toward NEUTRAL and, via
 * its always-"mixed/uncertain" regime dimension, forced `regime.mixed` to true
 * on every snapshot. Restore these two rules once a real risk input exists
 * (VIX regime, equity drawdown, or a classified geopolitical-risk event):
 *   ir("XAUUSD", "SAFE_HAVEN_PRESSURE",  1, 0.80, ...)
 *   ir("USDJPY", "SAFE_HAVEN_PRESSURE", -1, 0.60, ...)
 */
export const INSTRUMENT_RULES: InstrumentRule[] = [
  ir(
    "XAUUSD",
    "REAL_YIELD_PRESSURE",
    -1,
    0.95,
    "Real yields can raise gold opportunity cost.",
    "Safe-haven demand can dominate.",
    "A sustained rise in real yields.",
  ),
  ir(
    "XAUUSD",
    "USD_PRESSURE",
    -1,
    0.65,
    "USD pressure can weigh on USD-priced gold.",
    "Not deterministic.",
    "Sustained USD strengthening.",
  ),
  ir(
    "USDJPY",
    "USD_PRESSURE",
    1,
    0.82,
    "USD pressure can support USDJPY.",
    "BOJ policy/risk can dominate.",
    "Falling USD pressure.",
  ),
  ir(
    "USDJPY",
    "REAL_YIELD_PRESSURE",
    1,
    0.72,
    "US real yields can support USDJPY.",
    "BOJ/carry omitted.",
    "Falling US real yields.",
  ),
];

/**
 * TODO(safe-haven): the SAFE_HAVEN_DEMAND dimension is disabled for the same
 * reason as above. Restore alongside the instrument rules:
 *   { dimension: "SAFE_HAVEN_DEMAND", factors: ["SAFE_HAVEN_PRESSURE"],
 *     positive: "elevated safe-haven demand", negative: "subdued safe-haven demand" }
 */
export const REGIME_RULES: RegimeRule[] = [
  {
    dimension: "INFLATION",
    factors: ["INFLATION_PRESSURE"],
    positive: "inflationary",
    negative: "disinflationary",
  },
  {
    dimension: "GROWTH",
    factors: ["GROWTH_PRESSURE"],
    positive: "accelerating growth",
    negative: "slowing growth",
  },
  {
    dimension: "LABOR_MARKET",
    factors: ["LABOR_PRESSURE"],
    positive: "tightening/resilient labor",
    negative: "weakening labor",
  },
  {
    dimension: "MONETARY_POLICY",
    factors: ["MONETARY_POLICY_PRESSURE"],
    positive: "hawkish monetary environment",
    negative: "dovish monetary environment",
  },
  {
    dimension: "USD_STRENGTH",
    factors: ["USD_PRESSURE"],
    positive: "USD-supportive pressure",
    negative: "USD-negative pressure",
  },
];
