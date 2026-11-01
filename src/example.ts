import { replay } from "./backtest";
import { TEST_EVENTS as T } from "./test-data";

const run = replay([T.strongNfp, T.strongInflation, T.weakGdp, T.dovish]);
const finalState = run[run.length - 1].snapshot;

console.log(
  JSON.stringify(
    { asOf: finalState.asOf, regime: finalState.regime, biases: finalState.biases },
    null,
    2,
  ),
);
