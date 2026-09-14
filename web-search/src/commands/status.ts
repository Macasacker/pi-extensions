/**
 * /web-search-status report: the effective configuration (enabled state,
 * provider, allowlist size, limits) plus this session's usage (call count,
 * user-granted hosts).
 */

import type { WebSearchConfig } from "../config.ts";
import { expandEnvRef } from "../providers/brave.ts";
import type { SessionState } from "../session.ts";

/** Build the /web-search-status notification text. */
export function buildStatusReport(config: WebSearchConfig, session: SessionState): string {
	const lines = [
		`web-search: ${config.enabled ? "enabled" : "DISABLED"}`,
		`provider: ${config.provider}${config.provider === "brave" ? (expandEnvRef(config.braveApiKey) ? " (key set)" : " (NO KEY — falling back to duckduckgo)") : ""}`,
		`allowlist: ${config.allowedDomains.length} domain(s) [${config.allowedDomains.slice(0, 8).join(", ")}${config.allowedDomains.length > 8 ? ", …" : ""}]`,
		`limits: ${config.maxResults} results, ${config.maxContentChars} chars, ${Math.round(config.maxDownloadBytes / 1024)}KB, ${config.timeoutMs / 1000}s timeout, ${config.maxRedirects} redirects`,
		`session: ${session.callCount} call(s), ${session.grants.size} granted host(s)${session.grants.size ? ` (${[...session.grants].join(", ")})` : ""}`,
	];
	return lines.join("\n");
}
