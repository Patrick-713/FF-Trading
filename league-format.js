/** Read only scoring rules that the valuation model explicitly supports. */
export function leagueDefaults(snapshot) {
  const slots = Array.isArray(snapshot?.slots) ? snapshot.slots : [];
  const scoring = snapshot?.league.scoring || {};
  const rawPremium = scoring.bonus_rec_te;
  const premium = rawPremium === undefined || rawPremium === null ? 0 : Number(rawPremium);
  const supportedPremium = [0, 0.5, 1].includes(premium);

  return {
    settings: {
      mode: snapshot?.league.type === 2 ? 'dynasty' : 'redraft',
      scoring:
        Number(scoring.rec) === 0.5 ? 'half' : Number(scoring.rec) === 0 ? 'standard' : 'ppr',
      superflex:
        slots.includes('SUPER_FLEX') || slots.filter((slot) => slot === 'QB').length > 1 || false,
      passTD: Number(scoring.pass_td) === 6 ? 6 : 4,
      tePremium: supportedPremium ? premium : 0,
    },
    warning: supportedPremium
      ? null
      : `The imported TE reception bonus (${String(rawPremium)}) is outside the supported 0, 0.5 and 1 options. The model starts at 0; any selected supported TE bonus is an override.`,
  };
}

export const SCORING_KEYS = ['scoring', 'superflex', 'passTD', 'tePremium'];
/** Legacy rows copied every setting, so their QB flag did not establish a manual choice. */
export function scoringOverrides(stored, snapshot) {
  const source = stored?.version === 1 ? stored.overrides || {} : stored || {};
  return Object.fromEntries(
    SCORING_KEYS.filter(
      (key) =>
        Object.hasOwn(source, key) && !(snapshot && stored?.version !== 1 && key === 'superflex'),
    ).map((key) => [key, source[key]]),
  );
}
