/**
 * Session log entries for the web-search extension.
 *
 * Every tool call and allowlist change is appended to the session as a
 * `web-search-log` entry (rendered TUI-only, see the entry renderer in
 * index.ts). The target is LLM-supplied (query/URL) and the detail may echo
 * web-derived text, so both are sanitized before the entry is stored — the
 * entry is later rendered from the session in the TUI, so terminal escape
 * sequences from a prompt-injected model must not reach the terminal.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { sanitizeForTui } from "./sanitize.ts";

export interface LogData {
	kind: "search" | "fetch" | "config";
	target: string;
	ok: boolean;
	detail?: string;
}

/** Everything `logCall` needs: the logging targets and the entry to record. */
interface LogCallContext {
	pi: ExtensionAPI;
	ctx: ExtensionContext;
	entry: LogData;
}

export function logCall({ pi, entry }: LogCallContext): void {
	try {
		// The target is LLM-supplied (query/URL) — sanitize before it is rendered
		// from the session entry in the TUI.
		const sanitizedEntry = { ...entry, target: sanitizeForTui(entry.target), detail: entry.detail ? sanitizeForTui(entry.detail) : undefined };
		pi.appendEntry("web-search-log", { ...sanitizedEntry, ts: Date.now() });
	} catch {
		// logging must never break a tool call
	}
}
