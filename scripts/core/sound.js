/**
 * A short metallic "shing", made with Web Audio (no sound file), at Foundry's interface volume.
 * Used by the movement warnings (D&D 4e opportunity attacks, PF2e Reactive Strike).
 */
export const audio = { ctx: null, played: 0 };

export function shing() {
	try {
		const Ctx = window.AudioContext ?? window.webkitAudioContext;
		if (!Ctx) return;
		const ctx = (audio.ctx ??= new Ctx());
		if (ctx.state === "suspended") ctx.resume();
		const volume = Math.min(1, Math.max(0, Number(game.settings.get("core", "globalInterfaceVolume") ?? 0.5)));
		if (!volume) return;
		const now = ctx.currentTime;
		const out = ctx.createGain();
		out.gain.value = volume * 0.5;
		out.connect(ctx.destination);
		// The scrape: filtered noise sweeping upward.
		const length = Math.floor(ctx.sampleRate * 0.28);
		const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
		const data = buffer.getChannelData(0);
		for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
		const noise = ctx.createBufferSource();
		noise.buffer = buffer;
		const band = ctx.createBiquadFilter();
		band.type = "bandpass";
		band.Q.value = 2.5;
		band.frequency.setValueAtTime(2200, now);
		band.frequency.exponentialRampToValueAtTime(9000, now + 0.22);
		const noiseGain = ctx.createGain();
		noiseGain.gain.setValueAtTime(0.0001, now);
		noiseGain.gain.exponentialRampToValueAtTime(0.9, now + 0.03);
		noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
		noise.connect(band).connect(noiseGain).connect(out);
		noise.start(now);
		// The ring: two high partials that fade.
		for (const [frequency, level] of [[3520, 0.22], [5280, 0.14]]) {
			const osc = ctx.createOscillator();
			osc.type = "sine";
			osc.frequency.setValueAtTime(frequency * 0.97, now);
			osc.frequency.exponentialRampToValueAtTime(frequency, now + 0.08);
			const gain = ctx.createGain();
			gain.gain.setValueAtTime(0.0001, now + 0.02);
			gain.gain.exponentialRampToValueAtTime(level, now + 0.06);
			gain.gain.exponentialRampToValueAtTime(0.0005, now + 0.55);
			osc.connect(gain).connect(out);
			osc.start(now + 0.02);
			osc.stop(now + 0.6);
		}
		audio.played++;
		return true;
	} catch (err) {
		// No sound is not worth an error.
	}
	return false;
}

