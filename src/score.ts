import { config, type ScoreWeights } from './config.js';

export interface ScoreInput {
  /** Days since the app's release date. */
  daysSinceRelease: number;
  /** Best (lowest) rank on any tracked chart in the last 7 days, 1-based. */
  bestRank: number;
  /** Distinct days the app has appeared on any tracked chart. */
  daysOnChart: number;
  /** New ratings per day over the last 14 days; null when unknown. */
  ratingsPerDay: number | null;
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

/**
 * Radar score, 0–100. Weighted sum of four components, each normalized to
 * [0, 1]. The exact formula (documented in the README, tunable via
 * config.scoreWeights):
 *
 *   recency     = 1 - daysSinceRelease / 365            (linear decay to 0)
 *   rank        = 1 - ln(bestRank) / ln(chartDepth)     (log-scaled; #1 = 1)
 *   persistence = daysOnChart / 30                      (saturates at 30 days)
 *   velocity    = log10(1 + r/day) / log10(1 + 100)     (saturates at 100/day)
 *
 *   score = round(100 * (0.30*recency + 0.25*rank + 0.20*persistence + 0.25*velocity))
 */
export function radarScore(
  input: ScoreInput,
  weights: ScoreWeights = config.scoreWeights,
): number {
  const recency = clamp01(1 - input.daysSinceRelease / config.scoreRecencyHorizonDays);

  const depth = Math.max(2, config.chartDepth);
  const rank = clamp01(1 - Math.log(Math.max(1, input.bestRank)) / Math.log(depth));

  const persistence = clamp01(input.daysOnChart / config.scorePersistenceSaturationDays);

  const velocity =
    input.ratingsPerDay === null
      ? 0
      : clamp01(
          Math.log10(1 + Math.max(0, input.ratingsPerDay)) /
            Math.log10(1 + config.scoreVelocitySaturationPerDay),
        );

  const total =
    weights.recency * recency +
    weights.rank * rank +
    weights.persistence * persistence +
    weights.velocity * velocity;

  return Math.round(100 * total);
}
