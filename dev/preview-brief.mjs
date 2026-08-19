// Compose (but do not store or push) a brief with live data, to judge the
// prompt's output quality before a deploy.
//
//   node --env-file=.env.local dev/preview-brief.mjs

import { composeBrief } from "../web/tools/brief.js";

const result = await composeBrief();

console.log("=== BRIEF ===\n");
console.log(result.content);
console.log("\n=== META ===");
console.log(JSON.stringify(result.data, null, 2));
