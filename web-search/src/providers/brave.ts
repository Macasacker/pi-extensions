/**
 * Brave Search API provider (reliable, requires a free API key).
 *
 * Docs: https://api-dashboard.search.brave.com/app/guides
 * Free tier: 2,000 queries/month. Set webSearch.braveApiKey in settings
 * (literal or "$ENV_VAR" reference, expanded from process.env).
 */

import { readCappedText } from "../fetch.ts";
import { sanitizeForTui } from "../sanitize.ts";
import type { SearchProvider, SearchResult } from "./types.ts";

const ENDPOINT = "https://api.search.brave.com/res/v1/web/search";
const MAX_BODY_BYTES = 1024 * 1024;

export function expandEnvRef(value: string): string {
	if (value.startsWith("$")) {
		const name = value.replace(/^\$\{?/, "").replace(/\}$/, "");
		return process.env[name] ?? "";
	}
	return value;
}

export function createBraveProvider(apiKey: string, options?: { fetchImpl?: typeof fetch }): SearchProvider {
	const doFetch = options?.fetchImpl ?? fetch;

	return {
		id: "brave",

		async search(query, limit, signal) {
			const key = expandEnvRef(apiKey);
			if (!key) {
				throw new Error("Brave provider selected but no API key configured (webSearch.braveApiKey).");
			}

			const url = `${ENDPOINT}?q=${encodeURIComponent(query)}&count=${Math.min(limit, 20)}&search_lang=en`;

			let response: Response;
			try {
				response = await doFetch(url, {
					method: "GET",
					signal,
					headers: {
						Accept: "application/json",
						"Accept-Encoding": "identity",
						"X-Subscription-Token": key,
					},
				});
			} catch (error) {
				if (signal.aborted) throw new Error("Search cancelled");
				throw new Error(`Brave request failed: ${error instanceof Error ? error.message : String(error)}`);
			}

			if (response.status === 401 || response.status === 403) {
				throw new Error(`Brave API rejected the key (HTTP ${response.status}). Check webSearch.braveApiKey.`);
			}
			if (response.status === 429) {
				throw new Error("Brave API rate limit exceeded (429). Free tier allows 2,000 queries/month — retry later or switch to DuckDuckGo.");
			}
			if (!response.ok) {
				throw new Error(`Brave API returned HTTP ${response.status}.`);
			}

			const data = (await readCappedText(response, MAX_BODY_BYTES).then((responseBody) => JSON.parse(responseBody))) as {
				web?: { results?: Array<{ title?: string; url?: string; description?: string }> };
			};
			const results: SearchResult[] = [];
			for (const result of data.web?.results ?? []) {
				if (!result.url) continue;
				results.push({
					title: sanitizeForTui(result.title ?? result.url),
					url: result.url,
					snippet: sanitizeForTui(result.description ?? ""),
				});
				if (results.length >= limit) break;
			}
			return results;
		},
	};
}
