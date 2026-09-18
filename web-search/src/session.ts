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
 *
 * This module also holds the session-state helpers that read or write that
 * object: provider selection (one-shot Brave warning), the call counter,
 * the empty-allowlist warning, the config-warning surfacing, and
 * allowlist-drift detection/reporting.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { WebSearchConfig } from "./config.ts";
import { diffAllowlists } from "./domains.ts";
import { logCall } from "./log.ts";
import { duckduckgoProvider } from "./providers/duckduckgo.ts";
import { createBraveProvider, expandEnvRef } from "./providers/brave.ts";
import type { SearchProvider } from "./providers/types.ts";
import { getTestProvider } from "./test-seam.ts";

export interface SessionState {
	/** Hosts the user confirmed for fetching outside the allowlist. */
	grants: Set<string>;
	/** Number of web_search/web_fetch calls in this session (status footer). */
	callCount: number;
	/** One-shot: Brave selected but no API key found. */
	warnedBrave: boolean;
	/** One-shot: allowlist is empty. */
	warnedEmptyAllowlist: boolean;
	/** One-shot: config load warnings surfaced. */
	warnedConfig: boolean;
	/** Effective allowlist as seen by the last tool call (drift detection). */
	lastAllowlist: string[] | null;
}

export function createSessionState(): SessionState {
	return {
		grants: new Set(),
		callCount: 0,
		warnedBrave: false,
		warnedEmptyAllowlist: false,
		warnedConfig: false,
		lastAllowlist: null,
	};
}

/**
 * Select the search provider. A test seam override wins; otherwise the
 * configured provider is used, falling back to DuckDuckGo (with a one-shot
 * warning) when Brave is selected but no API key resolves.
 */
export function getProvider(config: WebSearchConfig, session: SessionState, ctx?: ExtensionContext): SearchProvider {
	const testProvider = getTestProvider();
	if (testProvider) return testProvider;
	if (config.provider === "brave") {
		if (expandEnvRef(config.braveApiKey)) return createBraveProvider(config.braveApiKey);
		if (ctx?.hasUI && !session.warnedBrave) {
			session.warnedBrave = true;
			ctx.ui.notify("web-search: Brave selected but no API key found — falling back to DuckDuckGo", "warning");
		}
		return duckduckgoProvider;
	}
	return duckduckgoProvider;
}

/** Increment the session call counter and refresh the status footer. */
export function recordSessionCall(session: SessionState, ctx: ExtensionContext): void {
	session.callCount += 1;
	try {
		ctx.ui.setStatus("web-search", `${session.callCount} web call(s) this session`);
	} catch {
		// status is cosmetic
	}
}

/** Warn once per session when the allowlist is empty (every fetch will block). */
export function warnIfAllowlistEmpty(config: WebSearchConfig, session: SessionState, ctx: ExtensionContext): void {
	if (config.allowedDomains.length === 0 && !session.warnedEmptyAllowlist) {
		session.warnedEmptyAllowlist = true;
		if (ctx.hasUI) ctx.ui.notify("web-search: allowlist is empty — every fetch will be blocked. Use /web-search-domains to add domains.", "warning");
	}
}

/** Surface config-load warnings once per session. */
export function warnIfConfigWarnings(ctx: ExtensionContext, configWarnings: string[], session: SessionState): void {
	if (configWarnings.length > 0 && !session.warnedConfig) {
		session.warnedConfig = true;
		if (ctx.hasUI) ctx.ui.notify(configWarnings.join("\n"), "warning");
	}
}

/** Surface a detected allowlist change: user-visible warning + session log entry. */
export function reportAllowlistDrift(pi: ExtensionAPI, ctx: ExtensionContext, diff: { added: string[]; removed: string[] }): void {
	const parts = ["web-search: allowlist changed during session"];
	if (diff.added.length > 0) parts.push(`added: ${diff.added.join(", ")}`);
	if (diff.removed.length > 0) parts.push(`removed: ${diff.removed.join(", ")}`);
	parts.push("If you didn't make this change, check who edited your settings (an agent can edit settings.json with the built-in file tools).");
	if (ctx.hasUI) ctx.ui.notify(parts.join(" — "), "warning");
	logCall(pi, ctx, { kind: "config", target: "allowlist", ok: true, detail: `${diff.added.length} added, ${diff.removed.length} removed` });
}

/**
 * Detect out-of-band allowlist changes: the extension's own tools can never
 * modify the allowlist (only the user's /web-search-domains command can), but
 * the agent could edit settings.json with the built-in file tools. The
 * allowlist is the user's security boundary, so any change made outside the
 * command flow is surfaced as a warning + session log entry instead of being
 * applied silently.
 */
export function checkAllowlistDrift(pi: ExtensionAPI, ctx: ExtensionContext, config: WebSearchConfig, session: SessionState): void {
	const current = [...config.allowedDomains].sort();
	const diff = diffAllowlists(session.lastAllowlist, current);
	if (diff && (diff.added.length > 0 || diff.removed.length > 0)) {
		reportAllowlistDrift(pi, ctx, diff);
	}
	session.lastAllowlist = current;
}
