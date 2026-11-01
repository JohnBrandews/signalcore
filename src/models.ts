export type MarketInstrument = "XAUUSD" | "USDJPY";

export type EconomicIndicator =
  | "US_CPI"
  | "US_CORE_CPI"
  | "US_PCE"
  | "US_CORE_PCE"
  | "US_NFP"
  | "US_UNEMPLOYMENT_RATE"
  | "US_AVERAGE_HOURLY_EARNINGS"
  | "US_GDP"
  | "US_ISM_MANUFACTURING_PMI"
  | "US_ISM_SERVICES_PMI"
  | "FOMC_RATE_DECISION"
  | "FOMC_STATEMENT"
  | "FED_SPEECH";

export type PolicySignal = "HAWKISH" | "NEUTRAL" | "DOVISH";

export type Direction = -1 | 0 | 1;
export type Confidence = number;
export type Strength = number;

export type MacroFactor =
  | "INFLATION_PRESSURE"
  | "GROWTH_PRESSURE"
  | "LABOR_PRESSURE"
  | "MONETARY_POLICY_PRESSURE"
  | "REAL_YIELD_PRESSURE"
  | "USD_PRESSURE"
  | "SAFE_HAVEN_PRESSURE";

export type RegimeDimension =
  | "INFLATION"
  | "GROWTH"
  | "LABOR_MARKET"
  | "MONETARY_POLICY"
  | "USD_STRENGTH"
  | "SAFE_HAVEN_DEMAND";

export type BiasDirection = "BULLISH" | "BEARISH" | "NEUTRAL";

export type EventUnit = "percent" | "index" | "thousands" | "basis_points" | "text";

export interface EconomicEvent {
  id: string;
  indicator: EconomicIndicator;
  timestamp: string;
  actual?: number;
  forecast?: number;
  previous?: number;
  unit: EventUnit;
  period: string;
  policySignal?: PolicySignal;
  expectedPolicySignal?: PolicySignal;
  /** Recorded for later evaluation only. No calculation in this engine reads it. */
  subsequentMarketMovement?: Partial<Record<MarketInstrument, number>>;
}

export interface Surprise {
  raw: number;
  normalized: number;
  directional: number;
  interpretation: string;
}

export interface TimeDecay {
  initialImpact: number;
  halfLifeHours: number;
  ageHours: number;
  effectiveImpact: number;
}

export interface EventImpact {
  event: EconomicEvent;
  surprise: Surprise;
  factor: MacroFactor;
  direction: Direction;
  initialStrength: Strength;
  confidence: Confidence;
  decay: TimeDecay;
  relationship: string;
  uncertainty: string;
  regimeDependent: boolean;
}

export interface FactorContribution {
  factor: MacroFactor;
  signedImpact: number;
  confidence: Confidence;
  sourceEvent: EconomicEvent;
  relationship: string;
  decay: TimeDecay;
}

export interface MacroFactorState {
  factor: MacroFactor;
  direction: Direction;
  /**
   * Magnitude of the decayed net evidence, clamped to [0, 1]. A bigger surprise
   * or a fresher one produces a bigger number; stale evidence trends to 0.
   */
  strength: Strength;
  /**
   * |net| / sum(|contributions|). 1 when every contribution points the same
   * way, 0 when they cancel exactly. This is a consistency measure, not a size
   * measure, and it is folded into `confidence`.
   */
  agreement: number;
  confidence: Confidence;
  contributions: FactorContribution[];
  conflicting: boolean;
}

export interface MacroRegimeState {
  dimension: RegimeDimension;
  state: string;
  strength: Strength;
  confidence: Confidence;
  evidenceFactors: MacroFactor[];
}

export interface MacroRegime {
  dimensions: MacroRegimeState[];
  mixed: boolean;
}

export interface BiasContribution {
  instrument: MarketInstrument;
  factor: MacroFactor;
  direction: BiasDirection;
  /** |score| for this single rule. A magnitude, already decayed. */
  strength: Strength;
  confidence: Confidence;
  sourceEvents: string[];
  relationship: string;
  uncertainty: string;
}

export interface InstrumentBias {
  instrument: MarketInstrument;
  direction: BiasDirection;
  /**
   * Signed, unbounded net of decayed instrument contributions. Positive is
   * bullish and negative is bearish; `direction` applies the configured
   * threshold to this value.
   */
  score: number;
  /**
   * Signed, magnitude-based net of the bullish and bearish contributions. This
   * Compatibility alias for `score`.
   */
  netScore: number;
  /**
   * |netScore| / sum(|contribution strengths|). Agreement between contributors,
   * NOT the size of the evidence. Previously (and misleadingly) named
   * `strength`.
   */
  agreement: number;
  confidence: Confidence;
  positiveContributors: BiasContribution[];
  negativeContributors: BiasContribution[];
  conflictingSignals: BiasContribution[];
  recentImportantEvents: EconomicEvent[];
  decayingEvents: EconomicEvent[];
  invalidationConditions: string[];
}

export interface EngineSnapshot {
  asOf: string;
  factors: MacroFactorState[];
  regime: MacroRegime;
  biases: Record<MarketInstrument, InstrumentBias>;
}

export interface ReplayPoint {
  event: EconomicEvent;
  snapshot: EngineSnapshot;
  subsequentMarketMovement?: Partial<Record<MarketInstrument, number>>;
}
