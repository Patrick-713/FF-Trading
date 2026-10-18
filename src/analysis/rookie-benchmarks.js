/** Explicit product assumptions supplied by the owner, not an ADP or consensus data feed.
 * Verified league selections take precedence. Add benchmarks only with a documented source.
 */
const benchmarks = {
  13287: {
    season: 2026,
    overall: 1,
    teams: 12,
    benchmark: true,
    source: 'Owner-supplied 1.01 benchmark for Jeremiyah Love',
  },
};
export function rookieBenchmark(player) {
  return benchmarks[player.id] || null;
}
