#!/usr/bin/env node
// node tools/convert/dc.mjs [pf1e|sf1e] <level> <1e DC> [...]  →  the 2e DCs (PLAN §23.3)
import { convertDc } from "../../scripts/conversion/dc.js";
const args = process.argv.slice(2);
const source = /^[ps]f1e$/.test(args[0]) ? args.shift() : "pf1e";
const [level, ...dcs] = args.map(Number);
for (const dc of dcs) {
  const r = convertDc(dc, level, source);
  console.log(`L${level} 1e DC ${dc} → 2e DC ${r.dc} (${r.proficiency}, ${r.difficulty})${r.capped ? " [capped]" : ""}`);
}
