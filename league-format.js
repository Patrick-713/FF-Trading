/** Read only scoring rules that the valuation model explicitly supports. */
export function leagueDefaults(snapshot) {
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
        snapshot?.slots.includes('SUPER_FLEX') ||
        snapshot?.slots.filter((slot) => slot === 'QB').length > 1 ||
        false,
      passTD: Number(scoring.pass_td) === 6 ? 6 : 4,
      tePremium: supportedPremium ? premium : 0,
    },
    warning: supportedPremium
      ? null
      : `The imported TE reception bonus (${String(rawPremium)}) is outside the supported 0, 0.5 and 1 options. The model starts at 0; any selected supported TE bonus is an override.`,
  };
}
