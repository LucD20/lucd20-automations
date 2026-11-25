/**
 * Chat cards in PF2e's own style (the system's action card: `pf2e chat-card action-card`, a header with
 * the item's image, its name and action glyph, the text, then the buttons side by side). Clicking the
 * card anywhere but a button opens the item's compendium entry (else the item itself), to read its
 * wording (owner, v0.47.1).
 */
const esc = (v) => Handlebars.escapeExpression(String(v ?? ""));

/** The compendium entry an item came from, else the item. */
export function sourceUuid(item) {
	return item?._stats?.compendiumSource ?? item?.sourceId ?? item?.flags?.core?.sourceId ?? item?.uuid ?? null;
}

/** An actor's item by slug (or name). */
export function itemBySlug(actor, slugs, name) {
	return Array.from(actor?.items?.contents ?? actor?.items ?? []).find((i) => slugs.includes(i.slug ?? i.system?.slug) || (name && name.test(i.name ?? ""))) ?? null;
}

/**
 * The card's HTML (v0.88.2: the owner's condensed style, mockup A3 of docs/mockups/reaction-cards-condensed.html).
 * A coloured edge by kind (reaction orange, action blue, free green); a title line (picture, name, glyph, who,
 * `aside` on the right, e.g. a shield's HP); the facts in one short line; a row of small full-width buttons,
 * the first one the main choice (filled). glyph: PF2e's action font letter ("R" = reaction, "1"–"3", "F" = free).
 * body: HTML (short). buttons: [{ data, value, icon, label }]. kind: "reaction" | "action" | "free" (default
 * from the glyph).
 */
const kindOf = (glyph, kind) => kind ?? (glyph === "R" ? "reaction" : glyph === "F" ? "free" : "action");
const headerOf = (img, title, glyph, who, aside = "") => `<header class="card-header flexrow">${img ? `<img src="${esc(img)}" alt="" />` : ""}<h3><span class="lucd20-card-title">${esc(title)}</span>${glyph ? `<span class="lucd20-card-glyph"><span class="action-glyph">${esc(glyph)}</span></span>` : ""}${who ? `<span class="lucd20-card-whom">${esc(who)}</span>` : ""}${aside ? `<span class="lucd20-card-aside">${aside}</span>` : ""}</h3></header>`;

/**
 * who: the creature's name, small, in the header (v0.50.1: the chat message's own header is hidden on these
 * cards, for the least vertical room).
 */
export function pf2eCard({ img, title, glyph = "", who = "", aside = "", open = null, body = "", buttons = [], extraClass = "", kind = null }) {
	return `<div class="pf2e chat-card action-card lucd20-pf2e-card is-${kindOf(glyph, kind)} ${buttons.length > 2 ? "has-many" : ""} ${extraClass}"${open ? ` data-lucd20-open="${esc(open)}"` : ""}>
	${headerOf(img, title, glyph, who, aside)}
	<div class="card-content">${body}</div>
	<div class="card-buttons lucd20-card-buttons">${buttons.map((b, i) => `<button type="button" class="${i === 0 ? "lucd20-card-primary" : ""}" data-${b.data}="${esc(b.value)}">${b.icon ? `<i class="fa-solid ${b.icon}"></i> ` : ""}${esc(b.label)}</button>`).join("")}</div>
</div>`;
}

/** Replace a card's buttons by a line (the card was answered). */
export function answered(content, text) {
	return content.replace(/<div class="card-buttons lucd20-card-buttons">[\s\S]*?<\/div>\s*<\/div>\s*$/, `<p class="lucd20-card-done">${esc(text)}</p></div>`);
}

/** In a rendered message: a click on the card (not a button) opens its compendium entry. */
export function wireOpen(html) {
	const card = html.querySelector?.("[data-lucd20-open]");
	if (!card || card.dataset.lucd20Wired) return;
	card.dataset.lucd20Wired = "1";
	card.addEventListener("click", async (event) => {
		if (event.target.closest("button, a")) return;
		const doc = await fromUuid(card.dataset.lucd20Open).catch(() => null);
		doc?.sheet?.render(true);
	});
}

/**
 * An answered reaction, as everyone may see it (owner, v0.47.2): one slim line, the picture, name and symbol,
 * and (v0.88.2) what happened on the right: `result` ("Blocked 5 · took 6", "Struck", "Skipped"); `muted` greys it.
 */
export function compactCard({ img, title, glyph = "", who = "", open = null, extraClass = "", kind = null, result = "", muted = false }) {
	const res = result ? `<span class="lucd20-card-result${muted ? " is-muted" : ""}">${esc(result)}</span>` : "";
	return `<div class="pf2e chat-card action-card lucd20-pf2e-card lucd20-card-compact is-${kindOf(glyph, kind)} ${extraClass}"${open ? ` data-lucd20-open="${esc(open)}"` : ""}>
	${headerOf(img, title, glyph, who, res)}
</div>`;
}

/** The name a token goes by for players (PF2e may hide an NPC's name). */
export const nameForPlayers = (doc, fallback) => (doc?.playersCanSeeName === false ? fallback : (doc?.name ?? fallback));
