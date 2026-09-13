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

export function createBraveProvider(apiKey: string): SearchProvider {
	return {
		id: "brave",

		async search(query, limit, signal, fetchImpl) {
			const key = expandEnvRef(apiKey);
			if (!key) {
				throw new Error("Brave provider selected but no API key configured (webSearch.braveApiKey).");
			}

			const doFetch = fetchImpl ?? fetch;
			const url = `${ENDPOINT}?q=${encodeURIComponent(query)}&count=${Math.min(limit, 20)}&search_lang=en`;

			let res: Response;
			try {
				res = await doFetch(url, {
					method: "GET",
					signal,
					headers: {
						Accept: "application/json",
						"Accept-Encoding": "identity",
						"X-Subscription-Token": key,
					},
				});
			} catch (err) {
				if (signal.aborted) throw new Error("Search cancelled");
				throw new Error(`Brave request failed: ${err instanceof Error ? err.message : String(err)}`);
			}

			if (res.status === 401 || res.status === 403) {
				throw new Error(`Brave API rejected the key (HTTP ${res.status}). Check webSearch.braveApiKey.`);
			}
			if (res.status === 429) {
				throw new Error("Brave API rate limit exceeded (429). Free tier allows 2,000 queries/month — retry later or switch to DuckDuckGo.");
			}
			if (!res.ok) {
				throw new Error(`Brave API returned HTTP ${res.status}.`);
			}

			const data = (await readCappedText(res, MAX_BODY_BYTES).then((t) => JSON.parse(t))) as {
				web?: { results?: Array<{ title?: string; url?: string; description?: string }> };
			};
			const results: SearchResult[] = [];
			for (const r of data.web?.results ?? []) {
				if (!r.url) continue;
				results.push({
					title: sanitizeForTui(r.title ?? r.url),
					url: r.url,
					snippet: sanitizeForTui(r.description ?? ""),
				});
				if (results.length >= limit) break;
			}
			return results;
		},
	};
}
