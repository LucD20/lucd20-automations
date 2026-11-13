import { MODULE_ID, error, localize } from "../../core/constants.js";
import { defineFeature } from "../../core/registry.js";
import { appElement } from "../../core/dom.js";
import { watchDOM } from "../../core/dom-watch.js";
import { broadcast, executeAsGM, onBroadcast, onGMRequest } from "../../core/socket.js";
import {
	applyRun, computeState, currentDC, currentStage, isSpent, normalizeChallenge, otherSkill, publicView,
	resolveCheck, resolveGroup, stagePenalty, waitingBonus
} from "./skill-challenge-engine.mjs";
import { FLAG, PUBLIC_KEY, L, esc, signed, skillIds, skillLabel, tallyHTML, portraitsHTML } from "./skill-challenge-shared.mjs";
import { PlayerWindow, enablePlayerSide, onPublicChange } from "./skill-challenge-player.mjs";
import { openEditor } from "./skill-challenge-editor.mjs";

/*
 * Skill Challenges (D&D 4e): run a challenge at the table.
 *
 * - A challenge is data on a journal text page (world or compendium), in
 *   flags[MODULE_ID].skillChallenge. Format: docs/skill-challenge.md.
 * - "Skill Challenges" button at the bottom of the Journal tab (GM): every
 *   challenge found, with Start / Continue / Edit / Reset. A journal entry that
 *   holds a challenge also gets a "Run" button in its title bar.
 * - Runner window (GM): click a character's portrait, then a skill. The roll
 *   goes to that character's player (to the GM when nobody who owns it is
 *   online) and uses the system's own skill roll. The GM's client judges it
 *   against the DC and counts it. Undo, manual + Success / + Failure, group
 *   checks, routes, stages, a modifier for the next check.
 * - Players (open challenges only): a window with the skills, descriptions
 *   written for them, a difficulty word and the tally; they can roll from it
 *   (skill-challenge-player.mjs). They get that from a second world setting
 *   the GM's client writes, which holds nothing secret (engine: publicView).
 * - Chat: one card per check. Open challenge: public, never with a DC.
 *   Secret challenge: whispered to the GM (the player only sees the roll).
 *   When it ends, a result card goes to the GM with "Show players".
 * - Runs are kept in a world setting (several can run at once, they survive
 *   reloads). Players' clients receive world settings, so a run stores no DC
 *   and no GM text: only the page's uuid, its name, the GM's choices and the log.
 */

const RUNS_KEY = "skillChallenge_runs";
const { ApplicationV2, DialogV2 } = foundry.applications.api;

const state = {
	feature: null,
	runs: {}, // key → { uuid, name, visibility, playerRolls, route, needed, revealed, log, started, endPosted, thresholdAt }
	found: null, // [{ uuid, name, entry, source, def }] (null = not searched yet)
	defs: new Map(), // uuid → normalized challenge (as written on the page)
	pending: new Map(), // run key → { checkId, userId, actorUuid, actorName, skillDef, mod }
	groups: new Map(), // run key → { id, name, options, rolls: Map(actorUuid → roll) }
	view: new Map(), // run key → { actorId, otherSkill, otherDC, mod }
	published: "" // what players last got (JSON), to avoid needless writes
};

/* -------------------------------------------- */
/*  Characters                                  */
/* -------------------------------------------- */

/** Player characters that can be asked to roll. */
function characters() {
	const pcs = (game.actors?.contents ?? [...(game.actors ?? [])]).filter(a => a.type === "Player Character");
	const owned = pcs.filter(a => a.hasPlayerOwner);
	return (owned.length ? owned : pcs).sort((a, b) => a.name.localeCompare(b.name));
}

const skillTotal = (actor, skill) => {
	const total = Number(actor?.system?.skills?.[skill]?.total);
	return Number.isFinite(total) ? total : null;
};

/** Who rolls for this character: its player if online, else this GM. */
function rollerFor(actor) {
	const owners = game.users.filter(u => u.active && !u.isGM && actor.testUserPermission?.(u, "OWNER"));
	return owners.find(u => u.character?.id === actor.id) ?? owners[0] ?? game.user;
}

/* -------------------------------------------- */
/*  Finding challenges                          */
/* -------------------------------------------- */

const keyOf = uuid => uuid.replace(/[^A-Za-z0-9]/g, "_");
const flagOf = page => page?.flags?.[MODULE_ID]?.[FLAG] ?? null;
const isEditable = uuid => !String(uuid).startsWith("Compendium.");

function collect(entry, source, out) {
	for (const page of entry.pages ?? []) {
		const def = normalizeChallenge(flagOf(page));
		if (!def) continue;
		state.defs.set(page.uuid, def);
		out.push({ uuid: page.uuid, name: page.name, entry: entry.name, source, def });
	}
}

/** Every challenge in the world's journals and in journal compendiums. */
async function findChallenges({ refresh = false } = {}) {
	if (state.found && !refresh) return state.found;
	const out = [];
	for (const entry of game.journal ?? []) collect(entry, null, out);
	for (const pack of game.packs ?? []) {
		if (pack.documentName !== "JournalEntry") continue;
		try {
			for (const entry of await pack.getDocuments()) collect(entry, pack.metadata?.label ?? pack.collection, out);
		} catch (err) {
			error(`Skill Challenges: could not read ${pack.collection}.`, err);
		}
	}
	out.sort((a, b) => a.name.localeCompare(b.name));
	state.found = out;
	return out;
}

/** Read a run's challenge again from its page (so edits apply) and return it as this run plays it. */
async function defFor(run) {
	try {
		const page = await fromUuid(run.uuid);
		const def = normalizeChallenge(flagOf(page));
		if (def) state.defs.set(run.uuid, def);
	} catch (err) {
		error("Skill Challenges: could not load the challenge's page.", err);
	}
	return cachedDef(run);
}

/** Same, from what is already loaded. */
function cachedDef(run) {
	const base = run && state.defs.get(run.uuid);
	return base ? applyRun(base, run) : null;
}

/* -------------------------------------------- */
/*  Runs                                        */
/* -------------------------------------------- */

const isSecret = run => run.visibility === "secret";
const gmIds = () => game.users.filter(u => u.isGM).map(u => u.id);
const newId = () => foundry.utils.randomID?.() ?? Math.random().toString(36).slice(2, 18);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function saveRuns() {
	try {
		await game.settings.set(MODULE_ID, RUNS_KEY, state.runs);
	} catch (err) {
		error("Could not save the skill challenges.", err);
	}
	await publish();
}

/** Give players' clients what they may know about the open, running challenges. */
async function publish() {
	if (!game.user.isActiveGM) return;
	const out = {};
	for (const [key, run] of Object.entries(state.runs)) {
		if (isSecret(run)) continue;
		const def = cachedDef(run) ?? await defFor(run);
		if (!def) continue;
		const st = computeState(def, run.log);
		if (st.status === "running") out[key] = publicView(def, run, st);
	}
	const json = JSON.stringify(out);
	if (json === state.published) return;
	state.published = json;
	try {
		await game.settings.set(MODULE_ID, PUBLIC_KEY, out);
	} catch (err) {
		error("Could not publish the skill challenges.", err);
	}
}

function startRun(found) {
	const key = keyOf(found.uuid);
	if (!state.runs[key]) {
		const fallback = state.feature?.get("playersSeeProgress") ? "open" : "secret";
		state.runs[key] = {
			uuid: found.uuid, name: found.name, visibility: found.def.visibility ?? fallback, playerRolls: found.def.playerRolls,
			route: found.def.routes[0]?.id ?? null, needed: null, revealed: [], log: [], started: Date.now(), endPosted: null, thresholdAt: 0
		};
		saveRuns();
	}
	return key;
}

/** Add a log entry, save, tell the table, and close the challenge if it is decided. */
async function addEntry(key, entry, detail = {}) {
	const run = state.runs[key];
	const def = run && await defFor(run);
	if (!def) return;
	run.log.push({ id: newId(), t: Date.now(), ...entry });
	const st = computeState(def, run.log);
	const crossed = def.thresholds.filter(t => t.failures > (run.thresholdAt ?? 0) && t.failures <= st.failures);
	run.thresholdAt = st.failures;
	await saveRuns();
	renderAll();
	await postCard(run, def, st, entry, detail);
	if (crossed.length) await postThresholds(run, crossed);
	if (st.status !== "running" && run.endPosted !== st.status) {
		run.endPosted = st.status;
		await saveRuns();
		await postEndCard(key, run, def, st);
	}
}

async function undo(key) {
	const run = state.runs[key];
	const def = run && await defFor(run);
	if (!def || !run.log.length) return;
	run.log.pop();
	const st = computeState(def, run.log);
	if (st.status === "running") run.endPosted = null;
	run.thresholdAt = st.failures;
	await saveRuns();
	renderAll();
	await postCard(run, def, st, { type: "undo" });
}

/** Change one of the GM's choices for a run (visibility, route, successes needed …). */
async function patchRun(key, patch) {
	const run = state.runs[key];
	if (!run) return;
	Object.assign(run, patch);
	await saveRuns();
	renderAll();
}

/* -------------------------------------------- */
/*  Rolling                                     */
/* -------------------------------------------- */

/** The modifier the GM set for the next check, plus the wrong-stage penalty when the stage lists its skills. */
function modFor(key, def, skillDef) {
	const run = state.runs[key];
	const manual = Number(state.view.get(key)?.mod) || 0;
	return manual - stagePenalty(def, computeState(def, run.log), skillDef);
}

async function requestCheck(key, actor, skillDef, user = rollerFor(actor)) {
	if (state.pending.has(key) || state.groups.has(key)) return false;
	const def = cachedDef(state.runs[key]);
	if (!def) return false;
	const pending = {
		checkId: newId(), userId: user.id, userName: user.name, actorUuid: actor.uuid, actorName: actor.name,
		skillDef, mod: modFor(key, def, skillDef)
	};
	state.pending.set(key, pending);
	const view = state.view.get(key);
	if (view) view.mod = 0; // the modifier is for one check
	renderAll();
	if (user.id !== game.user.id) {
		broadcast("skillChallenge.roll", { userId: user.id, actorUuid: actor.uuid, skill: skillDef.skill, checkId: pending.checkId });
		return true;
	}
	let total = null;
	try {
		total = (await actor.rollSkill(skillDef.skill))?.total ?? null;
	} catch (err) {
		error("Skill Challenges: the roll failed.", err);
	}
	await finishCheck(pending.checkId, total);
	return true;
}

/** A player's client: the GM asked this user to roll. Only the skill is sent, never the DC. */
async function onRollRequest({ userId, actorUuid, skill, checkId }) {
	if (userId !== game.user.id || !state.feature?.active) return;
	let total = null;
	try {
		const actor = await fromUuid(actorUuid);
		ui.notifications?.info(L("Asked", { actor: actor.name, skill: skillLabel(skill) }));
		total = (await actor.rollSkill(skill))?.total ?? null;
	} catch (err) {
		error("Skill Challenges: the roll failed.", err);
	}
	await executeAsGM("skillChallenge.result", { checkId, total });
}

/**
 * Dice So Nice: wait until the 3D dice of the roll just made have stopped on
 * this client, so the result card never appears before the dice.
 */
async function waitForDice(userId) {
	const dice3d = game.modules.get("dice-so-nice")?.active ? game.dice3d : null;
	if (!dice3d || typeof dice3d.waitFor3DAnimationByMessageID !== "function") return;
	const recent = () => (game.messages?.contents ?? []).filter(m => (m.author?.id ?? m.user?.id) === userId && m.rolls?.length && Date.now() - m.timestamp < 20000).at(-1);
	let message = recent();
	// The roll's message can reach this client a moment after the result does.
	for (let i = 0; !message && i < 10; i++) {
		await sleep(100);
		message = recent();
	}
	if (!message) return;
	await Promise.race([dice3d.waitFor3DAnimationByMessageID(message.id), sleep(12000)]);
}

async function diceThen(userId) {
	try {
		await waitForDice(userId);
	} catch (err) {
		error("Skill Challenges: waiting for the dice failed.", err);
	}
}

/** The GM's client: a roll came back (total = null: it wasn't rolled). */
async function finishCheck(checkId, total, senderId = null) {
	const [key, pending] = [...state.pending].find(([, p]) => p.checkId === checkId) ?? [];
	if (!pending || pending.answered || (senderId && senderId !== pending.userId)) return false;
	pending.answered = true;
	const rolled = total !== null && total !== undefined && Number.isFinite(Number(total));
	if (rolled) await diceThen(pending.userId);
	if (state.pending.get(key) !== pending) return false; // cancelled meanwhile
	state.pending.delete(key);
	const run = state.runs[key];
	const def = run && await defFor(run);
	if (!def || !rolled) {
		renderAll();
		return false;
	}
	const { skillDef, mod } = pending;
	const result = resolveCheck(skillDef, computeState(def, run.log), Number(total), mod);
	await addEntry(key, {
		type: "check", actorName: pending.actorName, actorUuid: pending.actorUuid, userId: pending.userId,
		skillId: skillDef.id, skill: skillDef.skill, total: Number(total), bonus: result.bonus, mod,
		outcome: result.outcome, ds: result.ds, df: result.df, grant: result.grant
	}, { dc: result.dc, skillDef });
	return true;
}

/** A player clicked Roll in their window. Checked here, on the GM's client, then it is a normal request. */
async function onPlayerRoll({ key, skillId, actorId }, senderId) {
	const run = state.runs[key];
	const def = run && await defFor(run);
	const user = game.users.get?.(senderId) ?? game.users.find(u => u.id === senderId);
	const actor = game.actors.get?.(actorId) ?? characters().find(a => a.id === actorId);
	if (!def || !user || !actor || isSecret(run) || run.playerRolls === false) return { ok: false, reason: "closed" };
	if (!actor.testUserPermission?.(user, "OWNER")) return { ok: false, reason: "closed" };
	const st = computeState(def, run.log);
	const skillDef = def.skills.find(s => s.id === skillId && (!s.hidden || run.revealed?.includes(s.id)));
	if (!skillDef || st.status !== "running" || isSpent(skillDef, st)) return { ok: false, reason: "closed" };
	if (state.pending.has(key) || state.groups.has(key)) return { ok: false, reason: "busy" };
	await requestCheck(key, actor, skillDef, user);
	return { ok: true };
}

/* -------------------------------------------- */
/*  Group checks                                */
/* -------------------------------------------- */

/** Ask the GM what the group check is: a preset from the data, or up to three skills with a DC. */
async function groupDialog(def) {
	const skills = skillIds();
	const presets = def.groupChecks;
	const row = i => `<div class="row"><select name="skill${i}"><option value="">—</option>${skills.map(id => `<option value="${esc(id)}">${esc(skillLabel(id))}</option>`).join("")}</select>
		<label>${L("DCLabel")} <input type="number" name="dc${i}" value="10" min="0" step="1"></label></div>`;
	const content = `<div class="lucd20-sc-group-form">
		<p class="hint">${L("Group.Hint")}</p>
		${presets.length ? `<div class="row"><span>${L("Group.Preset")}</span><select name="preset"><option value="">${L("Group.Custom")}</option>${presets.map((g, i) => `<option value="${i}">${esc(g.name)}</option>`).join("")}</select></div>` : ""}
		<div class="row"><span>${L("Group.Name")}</span><input type="text" name="name" value=""></div>
		${[0, 1, 2].map(row).join("")}
	</div>`;
	return DialogV2.wait({
		classes: ["lucd20-loot-app", "lucd20-sc-dialog"],
		window: { title: L("Group.Title"), icon: "fa-solid fa-people-group" },
		position: { width: 380 },
		content,
		rejectClose: false,
		buttons: [{
			action: "start", label: L("Group.Start"), icon: "fa-solid fa-dice-d20", default: true,
			callback: (event, button) => {
				const form = button.form;
				const preset = presets[Number(form.elements.preset?.value)] ?? null;
				if (form.elements.preset?.value !== "" && preset) return { name: preset.name, options: preset.options };
				const options = [0, 1, 2].map(i => ({ skill: form.elements[`skill${i}`]?.value, dc: Number(form.elements[`dc${i}`]?.value) || 0 })).filter(o => o.skill);
				return { name: form.elements.name?.value?.trim() || L("Group.Title"), options };
			}
		}, { action: "cancel", label: L("Cancel"), icon: "fa-solid fa-xmark" }]
	});
}

async function startGroup(key, { name, options }) {
	if (!options?.length || state.pending.has(key) || state.groups.has(key)) return;
	const group = { id: newId(), name, options, rolls: new Map() };
	const mine = [];
	for (const actor of characters()) {
		const user = rollerFor(actor);
		group.rolls.set(actor.uuid, { actorName: actor.name, userId: user.id, userName: user.name, status: "waiting" });
		if (user.id === game.user.id) mine.push(actor);
		else broadcast("skillChallenge.groupRoll", { userId: user.id, actorUuid: actor.uuid, skills: options.map(o => o.skill), groupId: group.id, name });
	}
	if (!group.rolls.size) return;
	state.groups.set(key, group);
	renderAll();
	// Characters whose player isn't here: the GM rolls for them, one after the other.
	for (const actor of mine) {
		if (state.groups.get(key) !== group) break;
		const answer = await rollForGroup(actor, options.map(o => o.skill), name);
		await onGroupResult({ groupId: group.id, actorUuid: actor.uuid, ...answer }, game.user.id);
	}
}

/** Any client: pick one of the allowed skills (when there are several) and roll it. → { skill, total } */
async function rollForGroup(actor, skills, name) {
	let skill = skills[0];
	try {
		if (skills.length > 1) {
			skill = await DialogV2.wait({
				classes: ["lucd20-loot-app", "lucd20-sc-dialog"],
				window: { title: name, icon: "fa-solid fa-people-group" },
				content: `<p class="lucd20-sc-ask">${L("Group.Choose", { actor: esc(actor.name) })}</p>`,
				rejectClose: false,
				buttons: skills.map((id, i) => {
					const total = skillTotal(actor, id);
					return { action: id, label: `${skillLabel(id)}${total === null ? "" : ` ${signed(total)}`}`, default: i === 0 };
				})
			});
		}
		if (!skill || !skills.includes(skill)) return { skill: null, total: null };
		return { skill, total: (await actor.rollSkill(skill))?.total ?? null };
	} catch (err) {
		error("Skill Challenges: the group roll failed.", err);
		return { skill: null, total: null };
	}
}

async function onGroupRequest({ userId, actorUuid, skills, groupId, name }) {
	if (userId !== game.user.id || !state.feature?.active) return;
	const actor = await fromUuid(actorUuid);
	if (!actor) return;
	ui.notifications?.info(L("Group.Asked", { actor: actor.name, name }));
	const answer = await rollForGroup(actor, skills, name);
	await executeAsGM("skillChallenge.groupResult", { groupId, actorUuid, ...answer });
}

/** The GM's client: one character's group roll came back. */
async function onGroupResult({ groupId, actorUuid, skill, total }, senderId) {
	const [key, group] = [...state.groups].find(([, g]) => g.id === groupId) ?? [];
	const roll = group?.rolls.get(actorUuid);
	if (!roll || roll.status !== "waiting" || senderId !== roll.userId) return false;
	const option = group.options.find(o => o.skill === skill);
	if (!option || total === null || total === undefined || !Number.isFinite(Number(total))) {
		renderAll(); // not rolled: stays "waiting" until the GM skips it
		return false;
	}
	roll.status = "rolling";
	await diceThen(roll.userId);
	if (state.groups.get(key) !== group) return false;
	Object.assign(roll, { status: "done", skill, total: Number(total), outcome: Number(total) >= option.dc ? "success" : "failure" });
	renderAll();
	if ([...group.rolls.values()].every(r => r.status === "done" || r.status === "skipped")) await finishGroup(key);
	return true;
}

/** Count the group check with the rolls that are in. */
async function finishGroup(key) {
	const group = state.groups.get(key);
	if (!group) return;
	state.groups.delete(key);
	const results = [...group.rolls.values()].filter(r => r.status === "done").map(r => ({ actorName: r.actorName, skill: r.skill, total: r.total, outcome: r.outcome }));
	if (!results.length) return renderAll();
	const dcs = Object.fromEntries(group.options.map(o => [o.skill, o.dc]));
	await addEntry(key, { type: "group", name: group.name, results, ...resolveGroup(results) }, { dcs });
}

/* -------------------------------------------- */
/*  Chat cards                                  */
/* -------------------------------------------- */

function grantText(grant) {
	const skills = grant.skills?.length ? grant.skills.map(skillLabel).join(", ") : "";
	const value = signed(grant.value);
	return skills ? L("Effect.BonusFor", { value, skills }) : L("Effect.Bonus", { value });
}

/** What a log entry did, in words. */
function effectText(entry, skillDef) {
	const parts = [];
	if (entry.ds > 0) parts.push(L("Effect.Success"));
	if (entry.ds < 0) parts.push(L("Effect.SuccessRemoved"));
	if (entry.df > 0) parts.push(L("Effect.Failure"));
	if (entry.df < 0) parts.push(L("Effect.Cancel"));
	if (entry.grant?.value) parts.push(grantText(entry.grant));
	if (!parts.length && entry.type === "check") {
		if (entry.outcome === "failure") parts.push(L("Effect.NoFailure"));
		else if (skillDef?.effect === "success") parts.push(L("Effect.Spent"));
		else if (skillDef?.effect === "cancelFailure") parts.push(L("Effect.NothingToCancel"));
		else parts.push(L("Effect.NoSuccess"));
	}
	return parts.join(" · ");
}

const outcomeWord = outcome => L(outcome === "success" ? "Success" : "Failure");
const extras = entry => [entry.bonus, entry.mod].filter(Boolean).map(n => ` ${signed(n)}`).join("");
const rollText = (entry, dc) => L("RollVsDC", { total: entry.total, bonus: extras(entry), dc });

/** One card per change. Public for an open challenge (no DC); whispered to the GM for a secret one. */
async function postCard(run, def, st, entry, { dc, skillDef, dcs } = {}) {
	const secret = isSecret(run);
	const lines = [`<header><i class="fa-solid fa-list-check"></i> <strong>${esc(run.name)}</strong>${secret ? `<span class="secret">${L("Secret")}</span>` : ""}</header>`];
	let cls = "";
	if (entry.type === "check") {
		cls = entry.outcome;
		lines.push(`<p class="line"><strong>${esc(entry.actorName)}</strong> · ${esc(skillLabel(entry.skill))}: <span class="outcome">${outcomeWord(entry.outcome)}</span></p>`);
		// Only on the GM's private card: the numbers.
		if (secret && dc !== undefined) lines.push(`<p class="meta">${rollText(entry, dc)}</p>`);
	} else if (entry.type === "group") {
		cls = entry.ds ? "success" : "failure";
		lines.push(`<p class="line"><i class="fa-solid fa-people-group"></i> <strong>${esc(entry.name)}</strong></p>`);
		lines.push(`<ul class="who">${entry.results.map(r => `<li class="${r.outcome}"><strong>${esc(r.actorName)}</strong> · ${esc(skillLabel(r.skill))}: <span class="outcome">${outcomeWord(r.outcome)}</span>${secret && dcs ? ` <span class="meta">${L("RollVsDC", { total: r.total, bonus: "", dc: dcs[r.skill] })}</span>` : ""}</li>`).join("")}</ul>`);
	} else if (entry.type === "undo") {
		lines.push(`<p class="line">${L("Undone")}</p>`);
	} else {
		lines.push(`<p class="line">${L("ByGM")}</p>`);
	}
	const effect = entry.type === "undo" ? "" : effectText(entry, skillDef);
	if (effect) lines.push(`<p class="effect">${esc(effect)}</p>`);
	lines.push(tallyHTML(def, st));
	const data = {
		content: `<div class="lucd20-sc-card ${cls}">${lines.join("")}</div>`,
		speaker: { alias: L("Speaker") }
	};
	if (secret) data.whisper = gmIds();
	try {
		await ChatMessage.create(data);
	} catch (err) {
		error("Skill Challenges: could not post the card.", err);
	}
}

/** A failure threshold was reached: remind the GM what it means (GM only). */
async function postThresholds(run, crossed) {
	const header = `<header><i class="fa-solid fa-triangle-exclamation"></i> <strong>${esc(run.name)}</strong><span class="secret">${L("GMOnly")}</span></header>`;
	const body = crossed.map(t => `<p class="outcome-text"><strong>${L("ThresholdAt", { failures: t.failures })}</strong> ${esc(t.text).replace(/\n/g, "<br>")}</p>`).join("");
	try {
		await ChatMessage.create({ content: `<div class="lucd20-sc-card">${header}${body}</div>`, whisper: gmIds(), speaker: { alias: L("Speaker") } });
	} catch (err) {
		error("Skill Challenges: could not post the threshold.", err);
	}
}

function contributors(run) {
	const by = new Map();
	const add = (name, outcome) => {
		const c = by.get(name) ?? { checks: 0, successes: 0 };
		c.checks += 1;
		if (outcome === "success") c.successes += 1;
		by.set(name, c);
	};
	for (const e of run.log) {
		if (e.type === "check") add(e.actorName, e.outcome);
		else if (e.type === "group") for (const r of e.results) add(r.actorName, r.outcome);
	}
	return [...by].map(([name, c]) => `<li><strong>${esc(name)}</strong>: ${L("Contribution", c)}</li>`).join("");
}

function resultBody(run, def, st) {
	const text = st.status === "success" ? def.successText : def.failureText;
	const who = contributors(run);
	return [
		`<p class="result">${L(st.status === "success" ? "ResultSuccess" : "ResultFailure")}</p>`,
		tallyHTML(def, st),
		who ? `<ul class="who">${who}</ul>` : "",
		text ? `<p class="outcome-text">${esc(text).replace(/\n/g, "<br>")}</p>` : ""
	].join("");
}

/** The result goes to the GM first; "Show players" posts the public card. */
async function postEndCard(key, run, def, st) {
	const header = `<header><i class="fa-solid fa-flag-checkered"></i> <strong>${esc(run.name)}</strong><span class="secret">${L("GMOnly")}</span></header>`;
	const xp = def.xp ? `<p class="meta">${L("XP", { level: def.level, xp: def.xp })}</p>` : "";
	const button = `<button type="button" data-lucd20-sc="reveal" data-key="${esc(key)}"><i class="fa-solid fa-bullhorn"></i> ${L("ShowPlayers")}</button>`;
	try {
		await ChatMessage.create({
			content: `<div class="lucd20-sc-card end ${st.status}">${header}${resultBody(run, def, st)}${xp}${button}</div>`,
			whisper: gmIds(),
			speaker: { alias: L("Speaker") }
		});
	} catch (err) {
		error("Skill Challenges: could not post the result.", err);
	}
}

async function revealResult(key) {
	const run = state.runs[key];
	const def = run && await defFor(run);
	if (!def) return ui.notifications?.warn(L("Missing"));
	const st = computeState(def, run.log);
	if (st.status === "running") return ui.notifications?.warn(L("NotOver"));
	const header = `<header><i class="fa-solid fa-flag-checkered"></i> <strong>${esc(run.name)}</strong></header>`;
	await ChatMessage.create({
		content: `<div class="lucd20-sc-card end ${st.status}">${header}${resultBody(run, def, st)}</div>`,
		speaker: { alias: L("Speaker") }
	});
}

function onRenderChatMessage(message, html) {
	const root = html instanceof HTMLElement ? html : html?.[0];
	for (const button of root?.querySelectorAll?.('[data-lucd20-sc="reveal"]') ?? []) {
		if (!game.user.isGM) button.remove();
		else button.addEventListener("click", event => {
			event.preventDefault();
			revealResult(button.dataset.key);
		});
	}
}

/* -------------------------------------------- */
/*  List window                                 */
/* -------------------------------------------- */

function statusPill(found, run) {
	if (!run) return `<span class="pill off">${L("Status.New")}</span>`;
	const def = applyRun(found.def, run);
	const st = computeState(def, run.log);
	const tally = `${st.successes}/${def.successes} · ${st.failures}/${def.failures}`;
	if (st.status === "success") return `<span class="pill found"><i class="fa-solid fa-check"></i> ${L("Success")} ${tally}</span>`;
	if (st.status === "failure") return `<span class="pill failed"><i class="fa-solid fa-xmark"></i> ${L("Failure")} ${tally}</span>`;
	return `<span class="pill hidden">${L("Status.Running")} ${tally}</span>`;
}

const iconButton = (action, icon, label, extra = "") => `<button type="button" class="ll-btn ll-btn-square${extra.includes("danger") ? " ll-btn-danger" : ""}" data-action="${action}" ${extra.includes("disabled") ? "disabled" : ""} data-tooltip="${esc(label)}" aria-label="${esc(label)}"><i class="fa-solid ${icon} ll-i"></i></button>`;

function listHTML(found) {
	if (found === null) return `<div class="lucd20-loot-empty"><i class="fa-solid fa-spinner fa-spin ll-empty-art"></i><p class="sub">${L("Searching")}</p></div>`;
	const rows = found.map(f => {
		const run = state.runs[keyOf(f.uuid)];
		const where = [f.source ?? L("World"), f.entry !== f.name ? f.entry : null].filter(Boolean).join(" · ");
		const what = [f.def.level ? L("Level", { level: f.def.level }) : null, L(f.def.failures === 1 ? "GoalOneFailure" : "Goal", f.def)].filter(Boolean).join(" · ");
		return `<li class="lucd20-sc-row" data-uuid="${esc(f.uuid)}">
			<div class="who"><span class="name">${esc(f.name)}</span><span class="sub">${esc(what)}</span><span class="sub">${esc(where)}</span></div>
			${statusPill(f, run)}
			<div class="actions">
				<button type="button" class="ll-btn ll-btn-take" data-action="open"><i class="fa-solid ${run ? "fa-play" : "fa-flag"} ll-i"></i> ${L(run ? "Continue" : "Start")}</button>
				${iconButton("page", "fa-book-open", L("OpenPage"))}
				${iconButton("edit", "fa-pen", L(isEditable(f.uuid) ? "Edit" : "EditLocked"), isEditable(f.uuid) ? "" : "disabled")}
				${iconButton("reset", "fa-rotate-left", L("Reset"), `danger${run ? "" : " disabled"}`)}
			</div>
		</li>`;
	}).join("");
	const body = found.length
		? `<ol class="lucd20-sc-list">${rows}</ol>`
		: `<div class="lucd20-loot-empty"><i class="fa-solid fa-list-check ll-empty-art"></i><p class="title">${L("Empty")}</p><p class="sub">${L("EmptyHint")}</p></div>`;
	return `<div class="lucd20-sc-body">
		<div class="lucd20-sc-scroll">${body}</div>
		<footer class="lucd20-loot-footer">
			<button type="button" class="ll-btn ll-btn-footer" data-action="create"><i class="fa-solid fa-plus ll-i"></i> ${L("New")}</button>
			<button type="button" class="ll-btn ll-btn-footer" data-action="refresh"><i class="fa-solid fa-rotate ll-i"></i> ${L("Refresh")}</button>
		</footer>
	</div>`;
}

/** Open the editor on a world page; when it saves, the list and any runner pick the change up. */
function editChallenge(uuid) {
	if (!isEditable(uuid)) return ui.notifications?.warn(L("EditLocked"));
	return openEditor(uuid, async () => {
		state.found = null;
		await findChallenges({ refresh: true });
		for (const run of Object.values(state.runs)) if (run.uuid === uuid) await defFor(run);
		await publish();
		renderAll();
	});
}

class SkillChallengeList extends ApplicationV2 {
	static DEFAULT_OPTIONS = {
		id: "lucd20-skill-challenges",
		classes: ["lucd20-loot-app", "lucd20-sc-list-window"],
		window: { title: "LUCD20.SkillChallenge.Title", icon: "fa-solid fa-list-check", resizable: true },
		position: { width: 560, height: 480 },
		actions: {
			open: SkillChallengeList.#onOpen,
			page: SkillChallengeList.#onPage,
			edit: SkillChallengeList.#onEdit,
			reset: SkillChallengeList.#onReset,
			create: SkillChallengeList.#onCreate,
			refresh: SkillChallengeList.#onRefresh
		}
	};

	static get instance() {
		return foundry.applications.instances?.get(this.DEFAULT_OPTIONS.id) ?? null;
	}

	static open() {
		const app = this.instance ?? new this();
		app.render({ force: true });
		if (!state.found) findChallenges().then(() => app.rendered && app.render());
		return app;
	}

	async _renderHTML() {
		return listHTML(state.found);
	}

	_replaceHTML(result, content) {
		const top = content.querySelector(".lucd20-sc-scroll")?.scrollTop ?? 0;
		content.innerHTML = result;
		const scroll = content.querySelector(".lucd20-sc-scroll");
		if (scroll) scroll.scrollTop = top;
	}

	static #found(target) {
		const uuid = target.closest("[data-uuid]")?.dataset.uuid;
		return state.found?.find(f => f.uuid === uuid) ?? null;
	}

	static #onOpen(event, target) {
		const found = SkillChallengeList.#found(target);
		if (!found) return;
		SkillChallengeRunner.open(startRun(found));
		this.render();
	}

	static async #onPage(event, target) {
		const page = await fromUuid(SkillChallengeList.#found(target)?.uuid ?? "");
		(page?.parent ?? page)?.sheet?.render(true, { pageId: page.id });
	}

	static #onEdit(event, target) {
		const found = SkillChallengeList.#found(target);
		if (found) editChallenge(found.uuid);
	}

	static async #onReset(event, target) {
		const found = SkillChallengeList.#found(target);
		if (!found) return;
		const ok = await DialogV2.confirm({
			window: { title: L("ResetTitle"), icon: "fa-solid fa-rotate-left" },
			content: `<p>${L("ResetContent", { name: esc(found.name) })}</p>`
		});
		if (!ok) return;
		const key = keyOf(found.uuid);
		delete state.runs[key];
		state.pending.delete(key);
		state.groups.delete(key);
		SkillChallengeRunner.instance(key)?.close();
		await saveRuns();
		renderAll();
	}

	/** A new journal entry with an empty challenge, then the editor. */
	static async #onCreate() {
		const name = L("NewName");
		const entry = await JournalEntry.create({
			name,
			pages: [{ name, type: "text", text: { content: "" }, flags: { [MODULE_ID]: { [FLAG]: { level: 1, complexity: 1, successes: 4, failures: 3, skills: [] } } } }]
		});
		const page = [...(entry?.pages ?? [])][0];
		state.found = null;
		await findChallenges({ refresh: true });
		this.render();
		if (page) editChallenge(page.uuid);
	}

	static async #onRefresh() {
		state.found = null;
		this.render();
		await findChallenges({ refresh: true });
		this.render();
	}
}

/* -------------------------------------------- */
/*  Runner window                               */
/* -------------------------------------------- */

const EFFECT_ICONS = { bonus: "fa-circle-plus", cancelFailure: "fa-eraser", none: "fa-circle-minus" };

function skillRowHTML(s, st, actor, locked, run, penalty) {
	const dc = currentDC(s, st);
	const spent = isSpent(s, st);
	const total = skillTotal(actor, s.skill);
	const bonus = waitingBonus(s, st);
	const shown = !s.hidden || run.revealed?.includes(s.id);
	const chips = [`<span class="chip dc" ${s.dcStep ? `data-tooltip="${esc(L("DCStep", { step: signed(s.dcStep) }))}"` : ""}>${L("DC", { dc })}${s.dcStep ? ` <i class="fa-solid fa-arrow-trend-up"></i>` : ""}</span>`];
	if (s.max) chips.push(`<span class="chip${spent ? " spent" : ""}" data-tooltip="${esc(L(s.effect === "success" ? "MaxSuccesses" : "MaxUses", { max: s.max }))}">${st.wins[s.id] ?? 0}/${s.max}</span>`);
	if (s.effect !== "success") chips.push(`<span class="chip effect" data-tooltip="${esc(L(`Does.${s.effect}`, { value: signed(s.bonus) }))}"><i class="fa-solid ${EFFECT_ICONS[s.effect]}"></i></span>`);
	if (bonus) chips.push(`<span class="chip bonus">${signed(bonus)}</span>`);
	if (penalty) chips.push(`<span class="chip penalty" data-tooltip="${esc(L("Stage.Auto"))}">${signed(-penalty)}</span>`);
	const eye = s.hidden
		? `<button type="button" class="ll-btn ll-btn-square" data-action="reveal-skill" data-tooltip="${esc(L(shown ? "Hide.Shown" : "Hide.Hidden"))}" aria-label="${esc(L(shown ? "Hide.Shown" : "Hide.Hidden"))}" aria-pressed="${shown}"><i class="fa-solid ${shown ? "fa-eye" : "fa-eye-slash"} ll-i"></i></button>`
		: "";
	return `<li class="lucd20-sc-skill${spent ? " spent" : ""}${s.hidden && !shown ? " concealed" : ""}" data-skill="${esc(s.id)}">
		<div class="main">
			<span class="name">${esc(skillLabel(s.skill))}${total === null ? "" : ` <span class="mod">${signed(total)}</span>`}</span>
			<span class="chips">${chips.join("")}</span>
			${eye}
			<button type="button" class="ll-btn ll-btn-take" data-action="roll" ${locked || spent || !actor ? "disabled" : ""}><i class="fa-solid fa-dice-d20 ll-i"></i> ${L("Roll")}</button>
		</div>
		${s.note ? `<p class="note">${esc(s.note)}</p>` : ""}
	</li>`;
}

function logHTML(def, run) {
	// Replay the log to show each check's DC at the time (the log itself stores none).
	const rows = [];
	const sofar = [];
	for (const e of run.log) {
		const before = computeState(def, sofar);
		sofar.push(e);
		if (e.type === "check") {
			const s = def.skills.find(x => x.id === e.skillId);
			const numbers = s ? rollText(e, currentDC(s, before)) : L("RollOnly", { total: e.total });
			rows.push(`<li class="${e.outcome}"><span class="what"><strong>${esc(e.actorName)}</strong> · ${esc(skillLabel(e.skill))} <span class="numbers">${numbers}</span></span><span class="did">${esc(effectText(e, s))}</span></li>`);
		} else if (e.type === "group") {
			const who = e.results.map(r => `${esc(r.actorName)} ${esc(skillLabel(r.skill))} ${r.total} ${r.outcome === "success" ? "✓" : "✗"}`).join(" · ");
			rows.push(`<li class="${e.ds ? "success" : "failure"}"><span class="what"><i class="fa-solid fa-people-group"></i> <strong>${esc(e.name)}</strong> <span class="numbers">${who}</span></span><span class="did">${esc(effectText(e))}</span></li>`);
		} else {
			rows.push(`<li class="manual"><span class="what">${L("ByGM")}</span><span class="did">${esc(effectText(e))}</span></li>`);
		}
	}
	return rows.reverse().join("");
}

function groupPanelHTML(group) {
	const rows = [...group.rolls].map(([uuid, r]) => {
		const status = r.status === "done"
			? `<span class="${r.outcome}">${esc(skillLabel(r.skill))} ${r.total} · ${outcomeWord(r.outcome)}</span>`
			: r.status === "skipped" ? `<span class="muted">${L("Group.Skipped")}</span>`
				: `<span class="muted">${L("Group.Waiting", { user: esc(r.userName) })}</span>`;
		const skip = r.status === "waiting" ? `<button type="button" class="ll-btn" data-action="group-skip" data-actor="${esc(uuid)}">${L("Group.Skip")}</button>` : "";
		return `<li><strong>${esc(r.actorName)}</strong>${status}${skip}</li>`;
	}).join("");
	const options = group.options.map(o => `${esc(skillLabel(o.skill))} ${L("DC", { dc: o.dc })}`).join(" · ");
	return `<div class="lucd20-sc-group">
		<header><i class="fa-solid fa-people-group"></i> <strong>${esc(group.name)}</strong><span class="options">${options}</span></header>
		<ol>${rows}</ol>
		<div class="buttons">
			<button type="button" class="ll-btn ll-btn-take" data-action="group-count"><i class="fa-solid fa-check ll-i"></i> ${L("Group.Count")}</button>
			<button type="button" class="ll-btn" data-action="group-cancel">${L("Cancel")}</button>
		</div>
	</div>`;
}

function runnerHTML(key) {
	const run = state.runs[key];
	const def = cachedDef(run);
	if (!run) return `<div class="lucd20-loot-empty"><p class="title">${L("Missing")}</p></div>`;
	if (!def) return `<div class="lucd20-loot-empty"><i class="fa-solid fa-spinner fa-spin ll-empty-art"></i><p class="sub">${L("Searching")}</p></div>`;
	const st = computeState(def, run.log);
	const view = state.view.get(key) ?? {};
	const pcs = characters();
	const actor = pcs.find(a => a.id === view.actorId) ?? pcs[0] ?? null;
	const pending = state.pending.get(key);
	const group = state.groups.get(key);
	const over = st.status !== "running";
	const locked = over || !!pending || !!group;
	const secret = isSecret(run);
	const stage = currentStage(def, st);
	const mod = Number(view.mod) || 0;

	const banner = group
		? groupPanelHTML(group)
		: pending
			? `<div class="lucd20-sc-banner waiting"><i class="fa-solid fa-hourglass-half"></i><span>${L("Waiting", { user: esc(pending.userName), actor: esc(pending.actorName), skill: esc(skillLabel(pending.skillDef.skill)) })}</span>
				<button type="button" class="ll-btn" data-action="cancelPending">${L("Cancel")}</button></div>`
			: over
				? `<div class="lucd20-sc-banner ${st.status}"><i class="fa-solid ${st.status === "success" ? "fa-check" : "fa-xmark"}"></i><span>${L(st.status === "success" ? "ResultSuccess" : "ResultFailure")}</span>
				<button type="button" class="ll-btn" data-action="reveal"><i class="fa-solid fa-bullhorn ll-i"></i> ${L("ShowPlayers")}</button></div>`
				: st.bonuses.length
					? `<div class="lucd20-sc-banner bonus"><i class="fa-solid fa-circle-plus"></i><span>${st.bonuses.map(g => esc(grantText(g))).join(" · ")}</span></div>`
					: "";

	const group_ = role => {
		const rows = def.skills.filter(s => s.role === role);
		return rows.length ? `<h4>${L(role === "primary" ? "Primary" : "Secondary")}</h4><ol class="lucd20-sc-skills">${rows.map(s => skillRowHTML(s, st, actor, locked, run, stagePenalty(def, st, s))).join("")}</ol>` : "";
	};
	const others = skillIds();
	const otherSkillId = others.includes(view.otherSkill) ? view.otherSkill : others[0];
	const other = others.length ? `<h4>${L("Other")}</h4>
		<div class="lucd20-sc-other">
			<select name="otherSkill" aria-label="${esc(L("Other"))}">${others.map(id => `<option value="${esc(id)}" ${id === otherSkillId ? "selected" : ""}>${esc(skillLabel(id))}</option>`).join("")}</select>
			<label>${L("DCLabel")} <input type="number" name="otherDC" value="${esc(view.otherDC ?? 10)}" min="0" step="1"></label>
			<button type="button" class="ll-btn ll-btn-take" data-action="rollOther" ${locked || !actor ? "disabled" : ""}><i class="fa-solid fa-dice-d20 ll-i"></i> ${L("Roll")}</button>
		</div>` : "";

	const routeBar = def.routes.length ? `<div class="lucd20-sc-bar">
			<label for="lucd20-sc-route-${esc(key)}">${L("Route.Label")}</label>
			<select id="lucd20-sc-route-${esc(key)}" name="route" ${run.log.length ? `disabled data-tooltip="${esc(L("Route.Locked"))}"` : ""}>${def.routes.map(r => `<option value="${esc(r.id)}" ${r.id === run.route ? "selected" : ""}>${esc(r.name)}</option>`).join("")}</select>
		</div>` : "";
	const stageBar = stage ? `<div class="lucd20-sc-bar">
			<span class="label">${L("Stage.Label", { n: stage.index + 1, total: def.stages.length })}</span><strong>${esc(stage.stage.name)}</strong>
			${stage.stage.penalty && !stage.stage.skills.length ? `<button type="button" class="ll-btn${mod === -stage.stage.penalty ? " on" : ""}" data-action="stage-penalty" data-penalty="${stage.stage.penalty}" aria-pressed="${mod === -stage.stage.penalty}" data-tooltip="${esc(L("Stage.WrongHint"))}">${L("Stage.Wrong", { value: signed(-stage.stage.penalty) })}</button>` : ""}
		</div>` : "";
	const modBar = `<div class="lucd20-sc-bar">
			<label for="lucd20-sc-mod-${esc(key)}" data-tooltip="${esc(L("ModHint"))}">${L("Mod")}</label>
			<input id="lucd20-sc-mod-${esc(key)}" type="number" name="mod" value="${mod}" step="1" class="${mod ? "set" : ""}">
			<span class="grow"></span>
			<span class="label">${L("Needed")}</span>
			<button type="button" class="ll-btn ll-btn-square" data-action="needed" data-d="-1" aria-label="${esc(L("NeededLess"))}"><i class="fa-solid fa-minus ll-i"></i></button>
			<b class="needed">${def.successes}</b>
			<button type="button" class="ll-btn ll-btn-square" data-action="needed" data-d="1" aria-label="${esc(L("NeededMore"))}"><i class="fa-solid fa-plus ll-i"></i></button>
		</div>`;

	const notes = [def.route?.note, stage?.stage.note, def.note, def.successText && `${L("OnSuccess")}: ${def.successText}`, def.failureText && `${L("OnFailure")}: ${def.failureText}`].filter(Boolean);
	const thresholds = def.thresholds.map(t => `<p class="lucd20-sc-notes threshold${st.failures >= t.failures ? " reached" : ""}"><strong>${L("ThresholdAt", { failures: t.failures })}</strong> ${esc(t.text).replace(/\n/g, "<br>")}</p>`).join("");
	const log = logHTML(def, run);

	return `<div class="lucd20-sc-body">
		<header class="lucd20-sc-head">
			${tallyHTML(def, st)}
			<div class="meta">
				<span>${[def.level ? L("Level", { level: def.level }) : null, def.xp ? L("XPShort", { xp: def.xp }) : null].filter(Boolean).join(" · ")}</span>
				<span class="buttons">
					${secret ? "" : `<button type="button" class="ll-btn ll-btn-square${run.playerRolls !== false ? " on" : ""}" data-action="playerRolls" aria-pressed="${run.playerRolls !== false}" data-tooltip="${esc(L(run.playerRolls !== false ? "PlayerRolls.On" : "PlayerRolls.Off"))}" aria-label="${esc(L(run.playerRolls !== false ? "PlayerRolls.On" : "PlayerRolls.Off"))}"><i class="fa-solid fa-hand-pointer ll-i"></i></button>`}
					${isEditable(run.uuid) ? iconButton("edit", "fa-pen", L("Edit")) : ""}
					<button type="button" class="ll-btn" data-action="visibility" data-tooltip="${esc(L(secret ? "SecretHint" : "OpenHint"))}"><i class="fa-solid ${secret ? "fa-eye-slash" : "fa-eye"} ll-i"></i> ${L(secret ? "SecretLabel" : "OpenLabel")}</button>
				</span>
			</div>
		</header>
		${banner}
		${portraitsHTML(pcs, actor?.id)}
		${routeBar}${stageBar}${modBar}
		<div class="lucd20-sc-scroll">
			${group_("primary")}${group_("secondary")}${other}
			${notes.length || thresholds ? `<h4>${L("Notes")}</h4>${notes.map(n => `<p class="lucd20-sc-notes">${esc(n).replace(/\n/g, "<br>")}</p>`).join("")}${thresholds}` : ""}
			${log ? `<h4>${L("Log")}</h4><ol class="lucd20-sc-log">${log}</ol>` : ""}
		</div>
		<footer class="lucd20-loot-footer">
			<button type="button" class="ll-btn ll-btn-footer" data-action="manual" data-ds="1" ${over ? "disabled" : ""}><i class="fa-solid fa-plus ll-i"></i> ${L("Success")}</button>
			<button type="button" class="ll-btn ll-btn-footer" data-action="manual" data-df="1" ${over ? "disabled" : ""}><i class="fa-solid fa-plus ll-i"></i> ${L("Failure")}</button>
			<button type="button" class="ll-btn ll-btn-footer" data-action="group" ${locked || !pcs.length ? "disabled" : ""}><i class="fa-solid fa-people-group ll-i"></i> ${L("Group.Button")}</button>
			<button type="button" class="ll-btn ll-btn-footer sc-undo" data-action="undo" ${run.log.length && !pending && !group ? "" : "disabled"}><i class="fa-solid fa-rotate-left ll-i"></i> ${L("Undo")}</button>
		</footer>
	</div>`;
}

class SkillChallengeRunner extends ApplicationV2 {
	static DEFAULT_OPTIONS = {
		classes: ["lucd20-loot-app", "lucd20-sc-runner"],
		window: { title: "LUCD20.SkillChallenge.Title", icon: "fa-solid fa-list-check", resizable: true },
		position: { width: 460, height: 700 },
		actions: {
			pick: SkillChallengeRunner.#onPick,
			roll: SkillChallengeRunner.#onRoll,
			rollOther: SkillChallengeRunner.#onRollOther,
			manual: SkillChallengeRunner.#onManual,
			undo: SkillChallengeRunner.#onUndo,
			cancelPending: SkillChallengeRunner.#onCancelPending,
			visibility: SkillChallengeRunner.#onVisibility,
			playerRolls: SkillChallengeRunner.#onPlayerRolls,
			reveal: SkillChallengeRunner.#onReveal,
			"reveal-skill": SkillChallengeRunner.#onRevealSkill,
			"stage-penalty": SkillChallengeRunner.#onStagePenalty,
			needed: SkillChallengeRunner.#onNeeded,
			edit: SkillChallengeRunner.#onEdit,
			group: SkillChallengeRunner.#onGroup,
			"group-skip": SkillChallengeRunner.#onGroupSkip,
			"group-count": SkillChallengeRunner.#onGroupCount,
			"group-cancel": SkillChallengeRunner.#onGroupCancel
		}
	};

	constructor(key) {
		super({ id: SkillChallengeRunner.idFor(key) });
		this.key = key;
	}

	static idFor = key => `lucd20-sc-run-${key}`;

	static instance(key) {
		return foundry.applications.instances?.get(this.idFor(key)) ?? null;
	}

	static all() {
		return [...(foundry.applications.instances?.values() ?? [])].filter(app => app instanceof SkillChallengeRunner);
	}

	static open(key) {
		const app = this.instance(key) ?? new this(key);
		const run = state.runs[key];
		if (run) defFor(run).then(() => app.render({ force: true }));
		return app;
	}

	get title() {
		return state.runs[this.key]?.name ?? L("Title");
	}

	async _renderHTML() {
		return runnerHTML(this.key);
	}

	_replaceHTML(result, content) {
		const top = content.querySelector(".lucd20-sc-scroll")?.scrollTop ?? 0;
		content.innerHTML = result;
		const scroll = content.querySelector(".lucd20-sc-scroll");
		if (scroll) scroll.scrollTop = top;
	}

	_onRender() {
		const root = appElement(this);
		const view = this.#view();
		root?.querySelector('select[name="otherSkill"]')?.addEventListener("change", event => (view.otherSkill = event.target.value));
		root?.querySelector('input[name="otherDC"]')?.addEventListener("change", event => (view.otherDC = Number(event.target.value) || 0));
		root?.querySelector('input[name="mod"]')?.addEventListener("change", event => {
			view.mod = Math.trunc(Number(event.target.value)) || 0;
			this.render();
		});
		root?.querySelector('select[name="route"]')?.addEventListener("change", event => patchRun(this.key, { route: event.target.value }));
	}

	#view() {
		if (!state.view.has(this.key)) state.view.set(this.key, {});
		return state.view.get(this.key);
	}

	#actor() {
		const pcs = characters();
		return pcs.find(a => a.id === this.#view().actorId) ?? pcs[0] ?? null;
	}

	static #onPick(event, target) {
		this.#view().actorId = target.closest("[data-actor]")?.dataset.actor;
		this.render();
	}

	static async #onRoll(event, target) {
		const def = cachedDef(state.runs[this.key]);
		const skillDef = def?.skills.find(s => s.id === target.closest("[data-skill]")?.dataset.skill);
		const actor = this.#actor();
		if (skillDef && actor) await requestCheck(this.key, actor, skillDef);
	}

	static async #onRollOther() {
		const root = appElement(this);
		const skill = root?.querySelector('select[name="otherSkill"]')?.value;
		const dc = Number(root?.querySelector('input[name="otherDC"]')?.value);
		const actor = this.#actor();
		if (!skill || !actor || !Number.isFinite(dc)) return;
		Object.assign(this.#view(), { otherSkill: skill, otherDC: dc });
		await requestCheck(this.key, actor, otherSkill(skill, dc));
	}

	static async #onManual(event, target) {
		await addEntry(this.key, { type: "manual", ds: Number(target.dataset.ds) || 0, df: Number(target.dataset.df) || 0 });
	}

	static async #onUndo() {
		await undo(this.key);
	}

	static #onCancelPending() {
		state.pending.delete(this.key);
		renderAll();
	}

	static async #onVisibility() {
		const run = state.runs[this.key];
		if (run) await patchRun(this.key, { visibility: isSecret(run) ? "open" : "secret" });
	}

	static async #onPlayerRolls() {
		const run = state.runs[this.key];
		if (run) await patchRun(this.key, { playerRolls: run.playerRolls === false });
	}

	static async #onReveal() {
		await revealResult(this.key);
	}

	static async #onRevealSkill(event, target) {
		const run = state.runs[this.key];
		const id = target.closest("[data-skill]")?.dataset.skill;
		if (!run || !id) return;
		const revealed = new Set(run.revealed ?? []);
		if (!revealed.delete(id)) revealed.add(id);
		await patchRun(this.key, { revealed: [...revealed] });
	}

	static #onStagePenalty(event, target) {
		const view = this.#view();
		const penalty = -(Number(target.dataset.penalty) || 0);
		view.mod = view.mod === penalty ? 0 : penalty;
		this.render();
	}

	static async #onNeeded(event, target) {
		const def = cachedDef(state.runs[this.key]);
		if (def) await patchRun(this.key, { needed: Math.max(1, def.successes + (Number(target.dataset.d) || 0)) });
	}

	static #onEdit() {
		editChallenge(state.runs[this.key]?.uuid);
	}

	static async #onGroup() {
		const def = cachedDef(state.runs[this.key]);
		const choice = def && await groupDialog(def);
		if (choice?.options?.length) await startGroup(this.key, choice);
	}

	static #onGroupSkip(event, target) {
		const group = state.groups.get(this.key);
		const roll = group?.rolls.get(target.dataset.actor);
		if (!roll) return;
		roll.status = "skipped";
		if ([...group.rolls.values()].every(r => r.status === "done" || r.status === "skipped")) return finishGroup(this.key);
		renderAll();
	}

	static async #onGroupCount() {
		await finishGroup(this.key);
	}

	static #onGroupCancel() {
		state.groups.delete(this.key);
		renderAll();
	}
}

function renderAll() {
	const list = SkillChallengeList.instance;
	if (list?.rendered) list.render();
	for (const app of SkillChallengeRunner.all()) if (app.rendered) app.render();
}

/* -------------------------------------------- */
/*  Buttons in Foundry's own windows            */
/* -------------------------------------------- */

function addDirectoryButton(root) {
	if (!root || root.querySelector(".lucd20-sc-open")) return;
	let footer = root.querySelector(".directory-footer");
	if (!footer) {
		footer = document.createElement("footer");
		footer.className = "directory-footer action-buttons lucd20-directory-footer";
		root.append(footer);
	}
	const button = document.createElement("button");
	button.type = "button";
	button.className = "lucd20-sc-open";
	button.innerHTML = `<i class="fa-solid fa-list-check"></i> ${L("Title")}`;
	button.addEventListener("click", event => {
		event.preventDefault();
		SkillChallengeList.open();
	});
	footer.append(button);
}

/** "Run skill challenge" in the title bar of an open journal entry that has one. */
function addSheetButtons() {
	for (const app of foundry.applications.instances?.values() ?? []) {
		const entry = app.document;
		if (entry?.documentName !== "JournalEntry") continue;
		const header = appElement(app)?.querySelector(".window-header");
		if (!header) continue;
		const pages = [...(entry.pages ?? [])].filter(page => normalizeChallenge(flagOf(page)));
		const old = header.querySelector(".lucd20-sc-run");
		if (!pages.length) {
			old?.remove();
			continue;
		}
		if (old) continue;
		const button = document.createElement("button");
		button.type = "button";
		button.className = "lucd20-header-button lucd20-sc-run";
		button.innerHTML = `<i class="fa-solid fa-list-check fa-fw" inert></i>`;
		button.dataset.tooltip = L("Run");
		button.setAttribute("aria-label", L("Run"));
		button.addEventListener("click", event => {
			event.preventDefault();
			runFromEntry(entry);
		});
		header.insertBefore(button, header.querySelector('[data-action="toggleControls"]') ?? header.querySelector('[data-action="close"]'));
	}
}

/** One challenge in the entry: run it. Several: the list. */
function runFromEntry(entry) {
	const pages = [...(entry.pages ?? [])].map(page => ({ page, def: normalizeChallenge(flagOf(page)) })).filter(p => p.def);
	if (pages.length !== 1) return SkillChallengeList.open();
	const { page, def } = pages[0];
	state.defs.set(page.uuid, def);
	SkillChallengeRunner.open(startRun({ uuid: page.uuid, name: page.name, def }));
	renderAll();
}

/* -------------------------------------------- */
/*  Feature                                     */
/* -------------------------------------------- */

defineFeature({
	id: "dnd4eSkillChallenge",
	category: "dnd4e",
	systems: ["dnd4e"],
	scope: "world",
	gmOnly: true,
	defaultEnabled: true,
	settings: {
		playersSeeProgress: { kind: "boolean", default: true }
	},
	onSettingChange() {},

	init() {
		game.settings.register(MODULE_ID, RUNS_KEY, {
			scope: "world",
			config: false,
			type: Object,
			default: {},
			onChange: value => {
				if (game.user.isActiveGM) return; // this client's copy is the source
				state.runs = foundry.utils.deepClone(value ?? {});
				renderAll();
			}
		});
		game.settings.register(MODULE_ID, PUBLIC_KEY, { scope: "world", config: false, type: Object, default: {}, onChange: () => onPublicChange() });
		// Always registered; they do nothing while the feature is off.
		const on = () => !!state.feature?.active;
		onBroadcast("skillChallenge.roll", payload => onRollRequest(payload));
		onBroadcast("skillChallenge.groupRoll", payload => onGroupRequest(payload));
		onGMRequest("skillChallenge.result", ({ checkId, total }, senderId) => (on() ? finishCheck(checkId, total, senderId) : false));
		onGMRequest("skillChallenge.groupResult", (payload, senderId) => (on() ? onGroupResult(payload, senderId) : false));
		onGMRequest("skillChallenge.playerRoll", (payload, senderId) => (on() ? onPlayerRoll(payload, senderId) : { ok: false, reason: "closed" }));
	},

	enable(feature) {
		state.feature = feature;
		feature.on("renderChatMessageHTML", onRenderChatMessage);
		if (game.user.isGM) {
			state.runs = foundry.utils.deepClone(game.settings.get(MODULE_ID, RUNS_KEY) ?? {});
			state.published = JSON.stringify(game.settings.get(MODULE_ID, PUBLIC_KEY) ?? {});
			// New, changed or removed journal pages: search again next time the list opens.
			for (const hook of ["createJournalEntryPage", "updateJournalEntryPage", "deleteJournalEntryPage", "createJournalEntry", "deleteJournalEntry"]) {
				feature.on(hook, () => (state.found = null));
			}
			feature.onCleanup(watchDOM("skill-challenge-button", () => {
				addDirectoryButton(appElement(ui.journal) ?? document.getElementById("journal"));
				addSheetButtons();
			}));
			publish();
		} else {
			enablePlayerSide(feature);
		}
		feature.onCleanup(() => {
			document.querySelectorAll(".lucd20-sc-open, .lucd20-sc-run, .lucd20-directory-footer:empty").forEach(el => el.remove());
			SkillChallengeList.instance?.close();
			PlayerWindow.instance?.close();
			for (const app of SkillChallengeRunner.all()) app.close();
			state.pending.clear();
			state.groups.clear();
			state.found = null;
			state.feature = null;
		});
	}
});

/** For the harness. */
export const _test = { state, SkillChallengeList, SkillChallengeRunner, findChallenges, startRun, finishCheck, onGroupResult, onPlayerRoll, keyOf };
