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
	let charIndex = 0;
	const inputLength = input.length;
	while (charIndex < inputLength) {
		const charCode = input.charCodeAt(charIndex);
		if (charCode === 0x1b) {
			const nextCharCode = charIndex + 1 < inputLength ? input.charCodeAt(charIndex + 1) : -1;
			if (nextCharCode === 0x5d) {
				// OSC: ESC ] ... terminated by BEL or ST (ESC \)
				let sequenceIndex = charIndex + 2;
				while (sequenceIndex < inputLength) {
					const charCode = input.charCodeAt(sequenceIndex);
					if (charCode === 0x07) {
						sequenceIndex += 1;
						break;
					}
					if (charCode === 0x1b && sequenceIndex + 1 < inputLength && input.charCodeAt(sequenceIndex + 1) === 0x5c) {
						sequenceIndex += 2;
						break;
					}
					sequenceIndex += 1;
				}
				charIndex = sequenceIndex; // unterminated OSC: drop to end
				continue;
			}
			if (nextCharCode === 0x5b) {
				// CSI: ESC [ ... final byte in 0x40-0x7E (or 0x7F)
				let sequenceIndex = charIndex + 2;
				while (sequenceIndex < inputLength) {
					const charCode = input.charCodeAt(sequenceIndex);
					if ((charCode >= 0x40 && charCode <= 0x7e) || charCode === 0x7f) {
						sequenceIndex += 1;
						break;
					}
					sequenceIndex += 1;
				}
				charIndex = sequenceIndex;
				continue;
			}
			if (nextCharCode >= 0x30 && nextCharCode <= 0x3f) {
				// Other escape introducer: ESC + intermediates (0x20-0x2F) + final byte
				let sequenceIndex = charIndex + 2;
				while (sequenceIndex < inputLength) {
					const charCode = input.charCodeAt(sequenceIndex);
					if (charCode >= 0x20 && charCode <= 0x2f) {
						sequenceIndex += 1;
						continue;
					}
					sequenceIndex += 1;
					break;
				}
				charIndex = sequenceIndex;
				continue;
			}
			charIndex += 2; // plain two-char escape
			continue;
		}
		if ((charCode < 0x20 && charCode !== 0x0a && charCode !== 0x09) || charCode === 0x7f) {
			charIndex += 1;
			continue;
		}
		out += input[charIndex];
		charIndex += 1;
	}
	return out;
}
