import { BIAS_DIRECTION_THRESHOLD, MIXED_REGIME_STATE, REGIME_MIXED_THRESHOLD } from "./config";
import { applyTimeDecay } from "./decay";
import {
  BiasContribution,
  BiasDirection,
  Direction,
  EconomicEvent,
  EngineSnapshot,
  FactorContribution,
  InstrumentBias,
  MacroFactor,
  MacroFactorState,
  MacroRegime,
  MarketInstrument,
} from "./models";
import { FACTOR_RULES, INDICATOR_RULES, INSTRUMENT_RULES, REGIME_RULES } from "./rules";
import { calculateSurprise } from "./surprise";

const MS_PER_HOUR = 3_600_000;

const FACTORS: MacroFactor[] = [
  "INFLATION_PRESSURE",
  "GROWTH_PRESSURE",
  "LABOR_PRESSURE",
  "MONETARY_POLICY_PRESSURE",
  "REAL_YIELD_PRESSURE",
  "USD_PRESSURE",
  "SAFE_HAVEN_PRESSURE",
];

const clamp = (n: number): number => Math.max(-1, Math.min(1, n));

const sign = (n: number): Direction => (n > 0 ? 1 : n < 0 ? -1 : 0);

/** Threshold applied to a magnitude-based net score, not to an agreement ratio. */
const biasDirection = (net: number): BiasDirection =>
  net > BIAS_DIRECTION_THRESHOLD
    ? "BULLISH"
    : net < -BIAS_DIRECTION_THRESHOLD
      ? "BEARISH"
      : "NEUTRAL";

export class MacroEngine {
  private readonly events: EconomicEvent[] = [];

  process(event: EconomicEvent): void {
    if (!Number.isFinite(Date.parse(event.timestamp))) {
      throw new Error(`${event.id}: invalid timestamp`);
    }
    // Validates the event up front so a malformed release fails on insert,
    // not later inside an unrelated snapshot.
    calculateSurprise(event);
    this.events.push(event);
    this.events.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  }

  snapshot(asOf: string): EngineSnapshot {
    if (!Number.isFinite(Date.parse(asOf))) {
      throw new Error("Invalid snapshot timestamp");
    }
    const contributions = this.factorContributions(asOf);
    const factors = FACTORS.map((factor) =>
      this.aggregate(
        factor,
        contributions.filter((c) => c.factor === factor),
      ),
    );
    return {
      asOf,
      factors,
      regime: this.regime(factors),
      biases: {
        XAUUSD: this.bias("XAUUSD", factors, asOf),
        USDJPY: this.bias("USDJPY", factors, asOf),
      },
    };
  }

  /** Only releases timestamped at or before `asOf` are visible. No look-ahead. */
  private factorContributions(asOf: string): FactorContribution[] {
    const cutoff = Date.parse(asOf);
    return this.events
      .filter((event) => Date.parse(event.timestamp) <= cutoff)
      .flatMap((event) => {
        const surprise = calculateSurprise(event);
        const indicator = INDICATOR_RULES[event.indicator];
        return FACTOR_RULES.filter((rule) => rule.indicator === event.indicator).map((rule) => {
          const initial = surprise.directional * rule.weight;
          const decay = applyTimeDecay(
            initial,
            event.timestamp,
            asOf,
            rule.halfLifeHours ?? indicator.halfLifeHours,
          );
          return {
            factor: rule.factor,
            signedImpact: decay.effectiveImpact,
            confidence: indicator.confidence * rule.confidence,
            sourceEvent: event,
            relationship: rule.relationship,
            decay,
          };
        });
      });
  }

  private aggregate(factor: MacroFactor, contributions: FactorContribution[]): MacroFactorState {
    const absolute = contributions.reduce((total, c) => total + Math.abs(c.signedImpact), 0);
    const net = contributions.reduce((total, c) => total + c.signedImpact, 0);

    // Strength is a MAGNITUDE. Surprise size and time decay both move it, and a
    // single stale event fades towards 0 instead of staying at full scale.
    const strength = clamp(Math.abs(net));

    // Agreement is the old (mis-named) "strength": how consistent the evidence
    // is, independent of how big it is. It belongs in confidence.
    const agreement = absolute === 0 ? 0 : Math.abs(net) / absolute;

    const weightedConfidence =
      absolute === 0
        ? 0
        : contributions.reduce((total, c) => total + Math.abs(c.signedImpact) * c.confidence, 0) /
          absolute;

    const conflicting =
      contributions.some((c) => c.signedImpact > 0) &&
      contributions.some((c) => c.signedImpact < 0);

    return {
      factor,
      direction: sign(net),
      strength,
      agreement,
      confidence: clamp(weightedConfidence * agreement),
      contributions,
      conflicting,
    };
  }

  private regime(states: MacroFactorState[]): MacroRegime {
    const dimensions = REGIME_RULES.map((rule) => {
      const selected = states.filter((state) => rule.factors.includes(state.factor));
      const net = selected.reduce((total, state) => total + state.direction * state.strength, 0);
      const confidence =
        selected.length === 0
          ? 0
          : selected.reduce((total, state) => total + state.confidence, 0) / selected.length;
      const state =
        Math.abs(net) < REGIME_MIXED_THRESHOLD
          ? MIXED_REGIME_STATE
          : net > 0
            ? rule.positive
            : rule.negative;
      return {
        dimension: rule.dimension,
        state,
        strength: Math.abs(net),
        confidence,
        evidenceFactors: rule.factors,
      };
    });
    return {
      dimensions,
      mixed:
        dimensions.some((d) => d.state === MIXED_REGIME_STATE) ||
        states.some((state) => state.conflicting),
    };
  }

  private bias(
    instrument: MarketInstrument,
    states: MacroFactorState[],
    asOf: string,
  ): InstrumentBias {
    const rules = INSTRUMENT_RULES.filter((rule) => rule.instrument === instrument);

    const contributions: BiasContribution[] = rules
      .map((rule) => {
        const state = states.find((s) => s.factor === rule.factor)!;
        const score = state.direction * state.strength * rule.direction * rule.weight;
        return {
          instrument,
          factor: rule.factor,
          // Classified by sign only. The NEUTRAL threshold is applied once, to
          // the aggregated net below; applying it here would silently drop
          // small contributions out of the net instead of netting them off.
          direction: (score > 0 ? "BULLISH" : "BEARISH") as BiasDirection,
          strength: Math.abs(score),
          confidence: state.confidence * rule.confidence,
          sourceEvents: state.contributions.map((c) => c.sourceEvent.id),
          relationship: rule.relationship,
          uncertainty: rule.uncertainty,
        };
      })
      .filter((c) => c.strength > 0);

    const byStrength = (a: BiasContribution, b: BiasContribution) => b.strength - a.strength;
    const positive = contributions.filter((c) => c.direction === "BULLISH").sort(byStrength);
    const negative = contributions.filter((c) => c.direction === "BEARISH").sort(byStrength);

    const sum = (list: BiasContribution[]) => list.reduce((total, c) => total + c.strength, 0);
    const netScore = sum(positive) - sum(negative);
    const total = sum(contributions);
    const agreement = total === 0 ? 0 : Math.abs(netScore) / total;
    const confidence =
      total === 0
        ? 0
        : (contributions.reduce((t, c) => t + c.confidence * c.strength, 0) / total) * agreement;

    const direction = biasDirection(netScore);
    const cutoff = Date.parse(asOf);
    const visible = this.events.filter((event) => Date.parse(event.timestamp) <= cutoff);

    return {
      instrument,
      direction,
      score: netScore,
      netScore,
      agreement,
      confidence,
      positiveContributors: positive,
      negativeContributors: negative,
      conflictingSignals: positive.length > 0 && negative.length > 0 ? contributions : [],
      recentImportantEvents: [...visible]
        .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
        .slice(0, 5),
      decayingEvents: visible.filter((event) => {
        const ageHours = (cutoff - Date.parse(event.timestamp)) / MS_PER_HOUR;
        return ageHours > INDICATOR_RULES[event.indicator].halfLifeHours;
      }),
      invalidationConditions: rules
        .filter((rule) => (direction === "BULLISH" ? rule.direction < 0 : rule.direction > 0))
        .map((rule) => rule.invalidation),
    };
  }
}
