/** One transparent curve prices rookie selections and future-pick scenarios in the same units. */
const first = [2600, 2450, 2300, 2150, 2050, 1950, 1850, 1750, 1700, 1650, 1600, 1550];
export function slotBase(overall, teams = 12) {
  const rank = 1 + ((overall - 1) * 12) / teams;
  if (rank <= 12) {
    const lower = Math.max(0, Math.floor(rank) - 1),
      upper = Math.min(11, lower + 1);
    return first[lower] + (first[upper] - first[lower]) * (rank - Math.floor(rank));
  }
  if (rank <= 24) return 1100 - (rank - 13) * 50;
  if (rank <= 36) return 525 - (rank - 25) * 25;
  return Math.max(35, 250 * 0.6 ** Math.floor((rank - 37) / 12));
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
