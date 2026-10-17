# Data quality and cost controls

## What established tools use

[FantasyPros](https://www.fantasypros.com/about/faq/football-rest-of-season-accuracy-methodology/) combines expert rest-of-season rankings and evaluates predictions against later results. Its [projection API](https://api.fantasypros.com/public/v2/docs/) is a separate licensed product; FF Trading does not copy those rankings or use that API.

[Fantasy Life](https://www.fantasylife.com/nfl/utilization-report/game-log) emphasizes role and opportunity, including targets, carries, routes and situational usage. FF Trading uses publicly available scoring, targets, carries, target share, WOPR and EPA. It does not claim to have route participation or proprietary expected-points data.

Our public source remains [nflverse](https://nflreadr.nflverse.com/reference/load_player_stats.html), with league information from Sleeper. Last-season context helps avoid valuing an established player from only one or two new games.

## Historical scoring check

The historical check selects one common history weight using 2024 outcomes and 2023 history, then freezes it before evaluating 2025 with 2024 history. At weekly cutoffs 1 through 14 it estimates points per appearance over the next four NFL weeks.

| 2025 holdout | Previous scoring baseline MAE | History blend MAE | Reduction |
| ------------ | ----------------------------: | ----------------: | --------: |
| PPR          |                         3.263 |             3.087 |      5.4% |
| Half PPR     |                         2.980 |             2.811 |      5.7% |
| Standard     |                         2.735 |             2.568 |      6.1% |

Each format has 5,527 player/cutoff observations. These observations overlap and are not independent. Evaluation is conditional on future appearances; it does not estimate injury absence or bye-week totals. Historical provider corrections can postdate a cutoff. This is evidence for the scoring component, not a validation of trade values, injury discounts, usage coefficients or superiority over commercial products.

Run `npm run evaluate:historical` to reproduce `redraft-validation.json`. Raw downloads stay under ignored `data/validation/`. Routine tests and CI never download historical seasons.

## Stay within existing services

- No paid data subscription, new service, automatic polling or plan upgrade.
- One shared last-season summary, cached for 30 days; current stats retain a six-hour cache.
- Compact provider rows retain only fields used by scoring and usage calculations.
- Prepared analysis reads avoid the full Sleeper catalog and reuse bounded, version-checked input caches.
- Historical games never inflate current games, current FP/game or starter pace. Rookie draft anchors remain separate.
- Existing saved trades retain their original model versions and values.

These changes reduce usage per request; they cannot guarantee that unlimited future traffic stays inside account quotas. Review actual provider usage as the audience grows.
