/** Profile labels and explanations stay together so terminology remains consistent. */
const stats = {
  ppg: [
    'This season FP / game',
    'Average fantasy points in this season’s included games. Missed games and confirmed injury exclusions do not count as zeroes.',
  ],
  recentPPG: [
    'Recent FP / game',
    'Average fantasy points over the last four included games, or fewer if that is all we have.',
  ],
  scoringEstimate: [
    'Scoring estimate',
    'The scoring number used to help value a player. It blends this season’s average and recent form, with last season helping when the current sample is small. This is not an expert projection.',
  ],
  lastSeasonPPG: [
    'Last season FP / game',
    'Average fantasy points from last season’s available sample, using your current scoring settings.',
  ],
  targetsPerGame: [
    'Targets / game',
    'Average passes thrown toward this player per included game, whether caught or not.',
  ],
  carriesPerGame: ['Carries / game', 'Average rushing attempts per included game.'],
  targetShare: [
    'Target share (%)',
    'The player’s average share of team pass targets in included games. A 25% share means about one in four targets went to that player.',
  ],
  wopr: [
    'Receiving opportunity (WOPR)',
    'Combines a player’s share of team targets and downfield passing opportunities. A higher number means a larger receiving role.',
  ],
  adot: [
    'Average target depth',
    'Average distance downfield, in yards, of passes intended for this player. It measures where targets go, not yards gained after a catch.',
  ],
  epaPerOpportunity: [
    'EPA / opportunity',
    'Expected points added measures how plays change a team’s chance of scoring. This is the average per opportunity counted by our model. Positive numbers mean the plays added scoring value.',
  ],
  consistency: [
    'Consistency',
    'A 0 to 100 score for how steady a player’s fantasy points have been. Higher means less variation around their average, not better scoring. A few games can make this score misleading.',
  ],
  yardsPerTouch: [
    'Yards / touch',
    'Rushing and receiving yards divided by carries plus catches. It shows average yards gained each time the player ran with or caught the ball.',
  ],
};
const esc = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const info =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/></svg>';

export function profileStats(values) {
  return `<table class="profile-stats"><caption class="sr-only">Player statistics and explanations</caption><tbody>${Object.entries(
    values,
  )
    .map(([key, value]) => {
      const [label, explanation] = stats[key] || [
        key,
        'This statistic is provided by the valuation model.',
      ];
      return `<tr><td><details class="stat-definition"><summary aria-label="Explain ${esc(label)}"><span>${esc(label)}</span><span class="stat-info">${info}</span></summary><p>${esc(explanation)}</p></details></td><td><span class="profile-stat-value">${esc(value ?? 'Not available')}</span></td></tr>`;
    })
    .join('')}</tbody></table>`;
}

export function profileGameLog(data) {
  const number = (value) => Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 });
  const metrics = (row) =>
    data.position === 'QB'
      ? [
          ['Pass yards', row.passingYards],
          ['Pass TD', row.passingTD],
          ['Interceptions', row.interceptions],
          ['Attempts', row.attempts],
          ['Rush yards', row.rushingYards],
          ['Rush TD', row.rushingTD],
        ]
      : data.position === 'K'
        ? [
            ['Field goals', row.fieldGoals],
            ['Extra points', row.extraPoints],
          ]
        : ['RB', 'WR', 'TE'].includes(data.position)
          ? [
              ['Rush yards', row.rushingYards],
              ['Rec yards', row.receivingYards],
              ['Catches', row.receptions],
              ['Targets', row.targets],
              ['Carries', row.carries],
              ['Touchdowns', row.rushingTD + row.receivingTD],
            ]
          : [];
  return `<p>${esc(data.season)} regular season. Points use your league scoring. Only recorded games are shown; missing weeks are not added as zeroes.</p>${
    data.gameLog.length
      ? `<div class="profile-game-grid">${data.gameLog
          .map(
            (row) =>
              `<article class="profile-game${row.exclusion ? ' game-excluded' : ''}"><div class="profile-game-heading"><h4>Week ${esc(row.week)}</h4><strong>${number(row.points)} <small>FP</small></strong></div>${row.exclusion ? `<p class="game-log-exclusion">Excluded from averages: ${esc(row.exclusion.reason)}</p>` : ''}<dl>${metrics(
                row,
              )
                .map(
                  ([label, value]) => `<div><dt>${esc(label)}</dt><dd>${number(value)}</dd></div>`,
                )
                .join('')}</dl></article>`,
          )
          .join('')}</div>`
      : '<p>No weekly game data is available for this player in the current analysis.</p>'
  }`;
}
