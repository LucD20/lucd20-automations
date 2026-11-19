#!/usr/bin/env node
/**
 * Dump a Foundry world's LevelDB collections to JSON (PLAN §23, §25): one <collection>.json per folder in
 * <world>/data (journal, folders, actors, items, scenes …); embedded documents keep their LevelDB key in `_key`
 * ("!journal!<id>", "!journal.pages!<journal>.<page>").
 *
 *   npm install classic-level          (once, in a scratch folder: not a dependency of the module)
 *   node tools/convert/dump_world.mjs <unzipped world folder> <output folder>
 *
 * The world must not be open in Foundry (LevelDB lock). Dumps contain the owner's adventure text: keep them out
 * of the repository.
 */
import { createRequire } from "module";
import fs from "fs";
import path from "path";

const require = createRequire(path.join(process.cwd(), "noop.js"));
const { ClassicLevel } = require("classic-level");
const [, , world, out] = process.argv;
if (!world || !out) {
  console.error("usage: node dump_world.mjs <world folder> <output folder>");
  process.exit(1);
}
fs.mkdirSync(out, { recursive: true });
for (const coll of fs.readdirSync(path.join(world, "data"))) {
  const dir = path.join(world, "data", coll);
  try { fs.unlinkSync(path.join(dir, "LOCK")); } catch {}
  const db = new ClassicLevel(dir, { valueEncoding: "json", createIfMissing: false });
  const rows = [];
  try {
    for await (const [key, value] of db.iterator()) rows.push({ _key: key, ...value });
  } catch (err) {
    console.error(coll, err.message);
  }
  await db.close();
  fs.writeFileSync(path.join(out, `${coll}.json`), JSON.stringify(rows, null, 1));
  console.log(coll, rows.length);
}
