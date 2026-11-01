import { MacroEngine } from "./engine";
import { EconomicEvent, ReplayPoint } from "./models";

/** Chronological replay: each snapshot sees only releases timestamped at or before its event. */
export function replay(events: readonly EconomicEvent[]): ReplayPoint[] {
  for (const event of events) {
    if (!Number.isFinite(Date.parse(event.timestamp))) {
      throw new Error(`${event.id}: invalid timestamp`);
    }
  }

  const chronological = [...events].sort(
    (a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp),
  );
  const engine = new MacroEngine();
  return chronological.map((event) => {
    engine.process(event);
    return {
      event,
      snapshot: engine.snapshot(event.timestamp),
      subsequentMarketMovement: event.subsequentMarketMovement,
    };
  });
}
