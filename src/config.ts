/**
 * Tunable engine thresholds.
 *
 * Kept out of `rules.ts` on purpose: `rules.ts` holds *relationship* hypotheses
 * (which indicator moves which factor, and in which direction). This file holds
 * the *cut-offs* that turn continuous scores into labels. The two are calibrated
 * separately and reviewed by different eyes.
 */

/**
 * Minimum absolute net bias score before an instrument is labelled BULLISH or
 * BEARISH instead of NEUTRAL.
 *
 * Applied to the magnitude-based net score, never to the agreement ratio, so
 * that evidence which has fully decayed falls back to NEUTRAL instead of
 * staying "confidently directional forever".
 */
export const BIAS_DIRECTION_THRESHOLD = 0.15;

/**
 * Minimum absolute net regime score before a regime dimension is named.
 * Below this the dimension reports {@link MIXED_REGIME_STATE}.
 */
export const REGIME_MIXED_THRESHOLD = 0.08;

/** Label used when a regime dimension has too little net evidence to name. */
export const MIXED_REGIME_STATE = "mixed/uncertain";

/** Version of the rule assumptions used for any persisted score. */
export const RULES_VERSION = "rules-v1";
