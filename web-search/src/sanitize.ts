/**
 * Sanitize untrusted text before it reaches the TUI (or the LLM context).
 *
 * pi-tui's Text component preserves ANSI/OSC sequences, so a malicious page
 * (or a prompt-injected model echoing one) could otherwise write to the
 * user's clipboard (OSC 52), repaint the screen, or fake prompts. This
 * strips:
 *   - OSC sequences:  ESC ] ... BEL  |  ESC ] ... ESC \
 *   - CSI sequences:  ESC [ ... (final byte 0x40-0x5E or 0x7F)
 *   - other escape sequences (ESC + intermediates + final byte)
 *   - remaining C0 controls (except \n and \t) and DEL
 */
export function sanitizeForTui(input: string): string {
	let out = "";
	let i = 0;
	const n = input.length;
	while (i < n) {
		const c = input.charCodeAt(i);
		if (c === 0x1b) {
			const next = i + 1 < n ? input.charCodeAt(i + 1) : -1;
			if (next === 0x5d) {
				// OSC: ESC ] ... terminated by BEL or ST (ESC \)
				let j = i + 2;
				while (j < n) {
					const cc = input.charCodeAt(j);
					if (cc === 0x07) {
						j += 1;
						break;
					}
					if (cc === 0x1b && j + 1 < n && input.charCodeAt(j + 1) === 0x5c) {
						j += 2;
						break;
					}
					j += 1;
				}
				i = j; // unterminated OSC: drop to end
				continue;
			}
			if (next === 0x5b) {
				// CSI: ESC [ ... final byte in 0x40-0x7E (or 0x7F)
				let j = i + 2;
				while (j < n) {
					const cc = input.charCodeAt(j);
					if ((cc >= 0x40 && cc <= 0x7e) || cc === 0x7f) {
						j += 1;
						break;
					}
					j += 1;
				}
				i = j;
				continue;
			}
			if (next >= 0x30 && next <= 0x3f) {
				// Other escape introducer: ESC + intermediates (0x20-0x2F) + final byte
				let j = i + 2;
				while (j < n) {
					const cc = input.charCodeAt(j);
					if (cc >= 0x20 && cc <= 0x2f) {
						j += 1;
						continue;
					}
					j += 1;
					break;
				}
				i = j;
				continue;
			}
			i += 2; // plain two-char escape
			continue;
		}
		if ((c < 0x20 && c !== 0x0a && c !== 0x09) || c === 0x7f) {
			i += 1;
			continue;
		}
		out += input[i];
		i += 1;
	}
	return out;
}
