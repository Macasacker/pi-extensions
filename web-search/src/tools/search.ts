/**
 * web_search pipeline: provider search → allowlist filter → formatted output.
 *
 * The shared pre-flight (config load, enabled guard, empty-allowlist warning,
 * allowlist-drift check) is run by the caller via `prepareToolExecution`;
 * this module receives an already-prepared config and provider and runs the
 * search-specific steps. Only results from allowlisted domains are returned;
 * the rest are hidden (a count is reported) so a prompt-injected model can't
 * use search to surface or reference disallowed hosts.
 */

import type { AgentToolResult, AgentToolUpdateCallback, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { WebSearchConfig } from "../config.ts";
import { buildAllowlistOptions, checkUrl, type AllowlistOptions } from "../domains.ts";
import { logCall } from "../log.ts";
import type { SearchProvider, SearchResult } from "../providers/types.ts";
import type { SearchDetails } from "../render.ts";
import { sanitizeForTui } from "../sanitize.ts";
import { recordSessionCall, type SessionState } from "../session.ts";

export interface WebSearchDeps {
	config: WebSearchConfig;
	session: SessionState;
	provider: SearchProvider;
	signal: AbortSignal | undefined;
	ctx: ExtensionContext;
	pi: ExtensionAPI;
	onUpdate?: AgentToolUpdateCallback<SearchDetails>;
}

interface WebSearchParams {
	query: string;
	max_results?: number;
}

/** Outcome of a provider search: either results, or a cancellation. */
interface SearchRunOutcome {
	cancelled: boolean;
	results: SearchResult[];
}

/** Results partitioned by the allowlist, with the hidden count. */
interface FilteredSearchResults {
	allowed: NonNullable<SearchDetails["results"]>;
	hidden: number;
}

/**
 * Run the search provider, surfacing provider errors and aborts.
 *
 * A provider error is logged and re-thrown (the tool reports it). If the
 * signal aborted after the search settled, a cancelled outcome is returned so
 * the caller reports "Cancelled" instead of results.
 */
async function runProviderSearch(params: WebSearchParams, deps: WebSearchDeps): Promise<SearchRunOutcome> {
	const { provider, config, signal, pi, ctx } = deps;
	let searchResults: SearchResult[];
	try {
		searchResults = await provider.search(params.query, params.max_results ?? config.maxResults, signal ?? new AbortController().signal);
	} catch (error) {
		logCall({ pi, ctx, entry: { kind: "search", target: params.query, ok: false, detail: String(error instanceof Error ? error.message : error) } });
		throw error;
	}
	if (signal?.aborted) {
		logCall({ pi, ctx, entry: { kind: "search", target: params.query, ok: false, detail: "cancelled" } });
		return { cancelled: true, results: [] };
	}
	return { cancelled: false, results: searchResults };
}

/**
 * Partition provider results by the allowlist.
 *
 * Only allowlisted results are kept (with their normalized host); the rest are
 * counted but never returned, so hidden results can't reach the model.
 */
function filterResultsByAllowlist(searchResults: SearchResult[], allowlistOptions: AllowlistOptions): FilteredSearchResults {
	const allowed: NonNullable<SearchDetails["results"]> = [];
	let hidden = 0;
	for (const result of searchResults) {
		const check = checkUrl(result.url, allowlistOptions);
		if (check.allowed) allowed.push({ title: result.title, url: result.url, snippet: result.snippet, domain: check.host });
		else hidden += 1;
	}
	return { allowed, hidden };
}

/** Build the human-readable result list, or the no-results guidance text. */
function buildSearchResultsText(query: string, allowed: NonNullable<SearchDetails["results"]>, hidden: number, allowedDomains: string[]): string {
	if (allowed.length === 0) {
		return (
			`No results from allowed domains for: ${sanitizeForTui(query)}\n` +
			`${hidden} result(s) hidden by the domain allowlist.\n` +
			`Allowed domains: ${allowedDomains.join(", ") || "(none)"}\n` +
			`Use /web-search-domains add <domain> to widen the allowlist.`
		);
	}
	let text = allowed
		.map((result, index) => `[${index + 1}] ${result.title}\n    ${result.url}\n    ${result.snippet}`)
		.join("\n\n");
	if (hidden > 0) text += `\n\n(${hidden} result(s) hidden: domain not in allowlist)`;
	return text;
}

/** Everything `formatSearchResults` needs: the request, config, provider, and the filtered results. */
interface SearchFormatContext {
	params: WebSearchParams;
	config: WebSearchConfig;
	provider: SearchProvider;
	filtered: FilteredSearchResults;
}

/** Build the tool's output text and structured details from the filtered results. */
function formatSearchResults({ params, config, provider, filtered }: SearchFormatContext): AgentToolResult<SearchDetails> {
	const { allowed, hidden } = filtered;
	const text = buildSearchResultsText(params.query, allowed, hidden, config.allowedDomains);
	return {
		content: [{ type: "text", text }],
		details: { query: params.query, provider: provider.id, results: allowed, hiddenCount: hidden } satisfies SearchDetails,
	};
}

/**
 * Run the web_search pipeline: announce, search, filter by allowlist, format.
 *
 * The caller has already run the shared pre-flight and selected the provider;
 * `deps` carries everything the pipeline needs.
 */
export async function executeWebSearch(params: WebSearchParams, deps: WebSearchDeps): Promise<AgentToolResult<SearchDetails>> {
	const { config, session, provider, ctx, pi, onUpdate } = deps;

	onUpdate?.({ content: [{ type: "text", text: `Searching: ${sanitizeForTui(params.query)}` }], details: {} });

	const runOutcome = await runProviderSearch(params, deps);
	if (runOutcome.cancelled) {
		return { content: [{ type: "text", text: "Cancelled" }], details: {} };
	}

	const filtered = filterResultsByAllowlist(runOutcome.results, buildAllowlistOptions(config, session));
	const result = formatSearchResults({ params, config, provider, filtered });

	recordSessionCall(session, ctx);
	logCall({ pi, ctx, entry: { kind: "search", target: params.query, ok: true, detail: `${filtered.allowed.length} allowed, ${filtered.hidden} hidden (provider: ${provider.id})` } });
	return result;
}
