// One live run of the accountability layer with immediate delivery — the
// end-to-end proof that a found shortcoming reaches the phone.
//
//   node --env-file=.env.local dev/run-accountability-once.mjs

import { reviewShortcomings } from "../web/tools/accountability.js";

const result = await reviewShortcomings({ budget: 2, deliverImmediately: true });

console.log(JSON.stringify(result, null, 2));
