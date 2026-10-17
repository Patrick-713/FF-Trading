/** Dynasty pick curve in this app's player-value units, not another site's numeric scale.
 * Calibrated October 17, 2026: roughly three unknown mid firsts across the next three
 * drafts compare with the dated Chase benchmark. Known early picks retain a premium.
 * This is an explicit product calibration, not an imported market-price feed.
 */
const first = [1050, 900, 800, 700, 625, 550, 500, 450, 410, 380, 350, 325];
export function slotBase(overall, teams = 12) {
  const rank = 1 + ((overall - 1) * 12) / teams;
  if (rank <= 12) {
    const lower = Math.max(0, Math.floor(rank) - 1),
      upper = Math.min(11, lower + 1);
    return first[lower] + (first[upper] - first[lower]) * (rank - Math.floor(rank));
  }
  if (rank <= 24) return 300 - (rank - 13) * 12;
  if (rank <= 36) return 145 - (rank - 25) * 6;
  return Math.max(10, 60 * 0.6 ** Math.max(0, Math.floor((rank - 37) / 12)));
}
export function draftPickValue(pick, settings, season, tier = 'mid') {
  if (settings.mode !== 'dynasty') return 0;
  const teams = Number.isInteger(pick.teams) && pick.teams >= 2 ? pick.teams : 12;
  const slot = tier === 'first' ? 1 : tier === 'early' ? 2 : tier === 'late' ? 11 : 6;
  const overall =
    Number.isInteger(pick.overall) && pick.overall > 0
      ? pick.overall
      : (pick.round - 1) * teams + 1 + ((slot - 1) * teams) / 12;
  return Math.round(
    slotBase(overall, teams) *
      0.85 ** Math.max(0, pick.year - season - 1) *
      (settings.superflex ? 1.15 : 1),
  );
}
