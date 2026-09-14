/**
 * Shared pre-flight for the web_search / web_fetch tool executions.
 *
 * Both tools run the same sequence before their own logic: load the
 * effective config, refuse to run when the extension is disabled (logging
 * the disabled entry and re-throwing the same error so the caller sees the
 * original message), warn once when the allowlist is empty, and surface
 * out-of-band allowlist changes. Keeping the sequence in one place means the
 * two tools can never drift apart on the safety guards.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { loadConfig, type WebSearchConfig } from "../config.ts";
import { logCall } from "../log.ts";
import { checkAllowlistDrift, warnIfAllowlistEmpty, type SessionState } from "../session.ts";

/** Throw when the extension is disabled in settings. */
export function assertEnabled(config: WebSearchConfig): void {
	if (!config.enabled) {
		throw new Error("web-search is disabled (webSearch.enabled: false). Re-enable it in settings to use web_search/web_fetch.");
	}
}

export interface ToolPreparation {
	/** Which tool is running; recorded in the disabled log entry. */
	kind: "search" | "fetch";
	/** LLM-supplied value (query/URL) recorded in the disabled log entry. */
	target: string;
}

export interface ToolPreparationContext {
	pi: ExtensionAPI;
	ctx: ExtensionContext;
	session: SessionState;
	preparation: ToolPreparation;
}

/**
 * Run the shared tool pre-flight and return the effective config.
 *
 * @throws the original disabled error after logging the disabled entry.
 */
export function prepareToolExecution({ pi, ctx, session, preparation }: ToolPreparationContext): WebSearchConfig {
	const loadedConfig = loadConfig({ cwd: ctx.cwd, projectTrusted: ctx.isProjectTrusted?.() ?? false });
	const config = loadedConfig.config;
	try {
		assertEnabled(config);
	} catch (error) {
		logCall(pi, ctx, { kind: preparation.kind, target: preparation.target, ok: false, detail: "disabled (webSearch.enabled: false)" });
		throw error;
	}
	warnIfAllowlistEmpty(config, session, ctx);
	checkAllowlistDrift(pi, ctx, config, session);
	return config;
}
