// Dry-run the accountability layer against live data — shows what it WOULD
// nudge, writes and pushes nothing.
//
//   node --env-file=.env.local dev/preview-accountability.mjs

import { reviewShortcomings } from "../web/tools/accountability.js";

const result = await reviewShortcomings({ budget: 2, dryRun: true });

console.log(JSON.stringify(result, null, 2));
