/** Last season is a starting point, not a permanent floor for a changed role. */
export function historyWeight(games, previousGames, strength = 4, fadeGames = 17) {
  if (previousGames < 4) return 0;
  return (
    (strength / (games + strength)) *
    Math.max(0, 1 - games / fadeGames) *
    Math.min(1, previousGames / 8)
  );
}
export function scoringSignal(
  scores,
  previousPPG = null,
  previousGames = 0,
  strength = 4,
  fadeGames = 17,
) {
  const mean = (list) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : 0);
  const current = mean(scores) * 0.4 + mean(scores.slice(-4)) * 0.6;
  const weight =
    previousPPG == null ? 0 : historyWeight(scores.length, previousGames, strength, fadeGames);
  return {
    current,
    estimate: current * (1 - weight) + (previousPPG || 0) * weight,
    historyWeight: weight,
  };
}
