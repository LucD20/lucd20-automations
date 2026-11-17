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
	return (actor?.items ?? []).find((i) => slugs.includes(i.slug ?? i.system?.slug) || (name && name.test(i.name ?? ""))) ?? null;
}

/**
 * The card's HTML. glyph: PF2e's action font letter ("R" = reaction, "1"–"3", "F" = free).
 * body: HTML paragraphs. buttons: [{ data, value, icon, label }].
 */
export function pf2eCard({ img, title, glyph = "", open = null, body = "", buttons = [], extraClass = "" }) {
	return `<div class="pf2e chat-card action-card lucd20-pf2e-card ${extraClass}"${open ? ` data-lucd20-open="${esc(open)}"` : ""}>
	<header class="card-header flexrow">${img ? `<img src="${esc(img)}" alt="" />` : ""}<h3>${esc(title)}${glyph ? ` <span class="action-glyph">${esc(glyph)}</span>` : ""}</h3></header>
	<div class="card-content">${body}</div>
	<div class="card-buttons lucd20-card-buttons">${buttons.map((b) => `<button type="button" data-${b.data}="${esc(b.value)}">${b.icon ? `<i class="fa-solid ${b.icon}"></i> ` : ""}${esc(b.label)}</button>`).join("")}</div>
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
 * An answered reaction, as everyone may see it (owner, v0.47.2): only the reaction's image, name and
 * symbol, no text, so it takes little room in the chat.
 */
export function compactCard({ img, title, glyph = "R", open = null, extraClass = "" }) {
	return `<div class="pf2e chat-card action-card lucd20-pf2e-card lucd20-card-compact ${extraClass}"${open ? ` data-lucd20-open="${esc(open)}"` : ""}>
	<header class="card-header flexrow">${img ? `<img src="${esc(img)}" alt="" />` : ""}<h3>${esc(title)}${glyph ? ` <span class="action-glyph">${esc(glyph)}</span>` : ""}</h3></header>
</div>`;
}

/** The name a token goes by for players (PF2e may hide an NPC's name). */
export const nameForPlayers = (doc, fallback) => (doc?.playersCanSeeName === false ? fallback : (doc?.name ?? fallback));
