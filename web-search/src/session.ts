/**
 * Per-session state for the web-search extension.
 *
 * The extension is a singleton per pi process, but a process can serve
 * multiple sessions (e.g. resumed sessions, or the e2e tests). All state
 * that is meaningful per session — granted hosts, call count, one-shot
 * warnings, the last-seen allowlist — lives in a SessionState object that
 * the extension creates in its closure scope and resets to a fresh object
 * on session_start / session_shutdown. Helpers receive the object as a
 * parameter and never hold a reference to it, so a reset rebind is visible
 * to every later call.
 */

export interface SessionState {
	/** Hosts the user confirmed for fetching outside the allowlist. */
	grants: Set<string>;
	/** Number of web_search/web_fetch calls in this session (status footer). */
	callCount: number;
	/** One-shot: Brave selected but no API key found. */
	warnedBrave: boolean;
	/** One-shot: allowlist is empty. */
	warnedEmptyAllowlist: boolean;
	/** Effective allowlist as seen by the last tool call (drift detection). */
	lastAllowlist: string[] | null;
}

export function createSessionState(): SessionState {
	return {
		grants: new Set(),
		callCount: 0,
		warnedBrave: false,
		warnedEmptyAllowlist: false,
		lastAllowlist: null,
	};
}
