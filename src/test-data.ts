import { EconomicEvent } from "./models";

const e = (
  id: string,
  indicator: EconomicEvent["indicator"],
  timestamp: string,
  actual: number,
  forecast: number,
  unit: EconomicEvent["unit"] = "percent",
): EconomicEvent => ({ id, indicator, timestamp, actual, forecast, unit, period: "monthly" });

export const TEST_EVENTS = {
  strongInflation: e("cpi-hot", "US_CPI", "2024-01-10T13:30:00Z", 3.3, 3.0),
  weakInflation: e("cpi-cool", "US_CPI", "2024-01-10T13:30:00Z", 2.8, 3.0),
  /** Same release, same moment, but a beat barely above the forecast. */
  tinyInflation: e("cpi-tiny-beat", "US_CPI", "2024-01-10T13:30:00Z", 3.02, 3.0),
  strongNfp: e("nfp-hot", "US_NFP", "2024-01-05T13:30:00Z", 350, 180, "thousands"),
  weakNfp: e("nfp-weak", "US_NFP", "2024-01-05T13:30:00Z", 80, 180, "thousands"),
  hawkish: {
    id: "fomc-hawk",
    indicator: "FOMC_RATE_DECISION",
    timestamp: "2024-01-31T19:00:00Z",
    unit: "text",
    period: "meeting",
    policySignal: "HAWKISH",
    expectedPolicySignal: "NEUTRAL",
  } as EconomicEvent,
  dovish: {
    id: "fomc-dove",
    indicator: "FOMC_STATEMENT",
    timestamp: "2024-01-31T19:00:00Z",
    unit: "text",
    period: "meeting",
    policySignal: "DOVISH",
    expectedPolicySignal: "NEUTRAL",
  } as EconomicEvent,
  weakGdp: e("gdp-weak", "US_GDP", "2024-01-25T13:30:00Z", 1.0, 2.5),
  strongGdp: e("gdp-strong", "US_GDP", "2024-01-25T13:30:00Z", 3.5, 2.5),
  hotPce: e("pce-hot", "US_CORE_PCE", "2024-01-26T13:30:00Z", 3.0, 2.7),
};

export type TestEvent = (typeof TEST_EVENTS)[keyof typeof TEST_EVENTS];
