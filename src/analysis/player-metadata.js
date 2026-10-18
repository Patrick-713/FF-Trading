/** Convert provider records into the same player shape for every ownership state. */
export function normalizePlayer(id, owner, player, metadata, context) {
  const numeric = (value) =>
    value === null || value === undefined || value === ''
      ? null
      : Number.isFinite(Number(value))
        ? Number(value)
        : null;
  const birth = player.birth_date || metadata.birth;
  const age = birth
    ? Math.floor((context.observedAt - new Date(birth).getTime()) / (365.2425 * 86400000))
    : numeric(player.age);
  const experience = numeric(player.years_exp);

  return {
    id,
    kind: 'player',
    owner,
    name: String(
      player.full_name ||
        player.name ||
        [player.first_name, player.last_name].filter(Boolean).join(' ') ||
        `Player ${id}`,
    ),
    position: player.position || '?',
    club: player.team || player.club || 'FA',
    injury: player.injury_status || player.injury || null,
    age: Number.isFinite(age) ? age : null,
    draftRound: numeric(player.draft_round) || metadata.draftRound || null,
    draftYear: numeric(player.draft_year) || metadata.draftYear || null,
    draftPick: numeric(player.draft_pick) || metadata.draftPick || null,
    experience: experience === null ? null : experience + context.season - context.metadataYear,
    rookieDraft: context.rookieDraft || null,
    gsis: player.gsis_id || null,
  };
}
