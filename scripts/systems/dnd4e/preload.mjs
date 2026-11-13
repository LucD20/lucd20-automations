import { MODULE_ID } from "./constants.mjs";
import { setting, log } from "./utils.mjs";

/*
 * Character sheets enrich every power/feature description. Some of those descriptions link to
 * compendium documents (e.g. "Feral Might" links to barbarian powers), and enriching such a link
 * makes Foundry fetch the whole document from the server: ~0.8 s each on Molten, sequentially, so
 * the first sheet opened in a session stalled for ~2 s. Once fetched, the documents stay cached.
 *
 * After the game is ready we (1) load compendium indexes and (2) fetch, in one batch per pack,
 * every compendium document linked from the descriptions of the actors this user can see.
 */

const UUID_RE = /@UUID\[Compendium\.([\w-]+\.[\w-]+)\.(?:[A-Za-z]+\.)?([A-Za-z0-9]{16})\]/g;
const COMPENDIUM_RE = /@Compendium\[([\w-]+\.[\w-]+)\.([A-Za-z0-9]{16})\]/g;

async function runPool(tasks, size = 3) {
	const queue = [...tasks];
	const worker = async () => {
		while (queue.length) {
			const task = queue.shift();
			try {
				await task();
			} catch (err) {
				console.warn(`${MODULE_ID} | preload task failed`, err);
			}
		}
	};
	await Promise.all(Array.from({ length: size }, worker));
}

function collectLinkedDocuments() {
	const byPack = new Map();
	const add = (packId, id) => {
		if (!byPack.has(packId)) byPack.set(packId, new Set());
		byPack.get(packId).add(id);
	};
	const scan = (text) => {
		if (!text || typeof text !== "string" || !text.includes("@")) return;
		for (const m of text.matchAll(UUID_RE)) add(m[1], m[2]);
		for (const m of text.matchAll(COMPENDIUM_RE)) add(m[1], m[2]);
	};
	const actors = game.actors.filter((a) => (a.type === "Player Character") && a.testUserPermission(game.user, "OBSERVER"));
	for (const actor of actors) {
		scan(actor.system?.biography);
		for (const item of actor.items) scan(item.system?.description?.value);
	}
	return byPack;
}

export async function preloadCompendiumIndexes() {
	if (!setting("preloadIndexes")) return;
	const start = performance.now();
	// Let the UI settle first so we don't compete with the scene loading.
	await new Promise((r) => setTimeout(r, 1500));

	const packs = game.packs.filter((p) => !p.indexed && ["Item", "JournalEntry", "Actor"].includes(p.documentName));
	await runPool(packs.map((pack) => () => pack.getIndex()));

	let fetched = 0;
	const linked = collectLinkedDocuments();
	const tasks = [];
	for (const [packId, ids] of linked) {
		const pack = game.packs.get(packId);
		if (!pack) continue;
		const missing = [...ids].filter((id) => !pack.get(id) && pack.index.has(id));
		if (!missing.length) continue;
		fetched += missing.length;
		tasks.push(() => pack.getDocuments({ _id__in: missing }));
	}
	await runPool(tasks);
	log(`preloaded ${packs.length} indexes and ${fetched} linked documents in ${Math.round(performance.now() - start)} ms`);
}
