/**
 * DuckDuckGo HTML endpoint provider (zero-config, unofficial).
 *
 * Scrapes https://html.duckduckgo.com/html/ — the same endpoint used by
 * lightweight DDG frontends. Result links are `//duckduckgo.com/l/?uddg=<url>`
 * redirect wrappers; we decode the `uddg` parameter to recover the real URL.
 *
 * Best-effort: DDG may serve a challenge/anomaly page under heavy load or
 * from datacenter IPs. We detect that and surface a clear error suggesting
 * the Brave provider instead.
 */

import { parse } from "node-html-parser";
import { readCappedText } from "../fetch.ts";
import { sanitizeForTui } from "../sanitize.ts";
import { fetchProviderResponse } from "./common.ts";
import { PROVIDER_MAX_BODY_BYTES } from "./types.ts";
import type { SearchProvider, SearchResult } from "./types.ts";

const ENDPOINT = "https://html.duckduckgo.com/html/";

function decodeDdgHref(href: string): string | null {
	if (!href) return null;
	let full = href;
	if (href.startsWith("//")) full = "https:" + href;
	else if (!href.startsWith("http://") && !href.startsWith("https://")) return null;
	try {
		const parsedUrl = new URL(full);
		if (parsedUrl.hostname === "duckduckgo.com" || parsedUrl.hostname.endsWith(".duckduckgo.com")) {
			const uddg = parsedUrl.searchParams.get("uddg");
			if (uddg) return decodeURIComponent(uddg);
			// A bare duckduckgo.com link (e.g. a "more results" link) is not a result.
			return null;
		}
		return parsedUrl.toString();
	} catch {
		return null;
	}
}

const CHALLENGE_MARKERS = ["challenge-form", "anomaly", "not a robot", "please try again later", "unusual traffic"];

function parseDuckDuckGoResults(html: string, limit: number): SearchResult[] {
	const root = parse(html);
	const results: SearchResult[] = [];
	for (const item of root.querySelectorAll(".result")) {
		const resultLink = item.querySelector("a.result__a");
		const resultHref = resultLink?.getAttribute("href");
		const realUrl = resultHref ? decodeDdgHref(resultHref) : null;
		if (!realUrl) continue;
		const title = sanitizeForTui(resultLink?.text?.trim() ?? "");
		const snippet = sanitizeForTui(item.querySelector(".result__snippet")?.text?.trim() ?? "");
		if (!title) continue;
		results.push({ title, url: realUrl, snippet });
		if (results.length >= limit) break;
	}
	return results;
}

export function createDuckDuckGoProvider(options?: { fetchImpl?: typeof fetch }): SearchProvider {
	const doFetch = options?.fetchImpl ?? fetch;

	return {
		id: "duckduckgo",

		async search(query, limit, signal) {
			const url = `${ENDPOINT}?q=${encodeURIComponent(query)}`;

			const response = await fetchProviderResponse(url, {
				doFetch,
				signal,
				headers: {
					"User-Agent": "Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0",
					Accept: "text/html,application/xhtml+xml",
					"Accept-Language": "en-US,en;q=0.9",
				},
				providerName: "DuckDuckGo",
			});

			if (!response.ok) {
				throw new Error(`DuckDuckGo returned HTTP ${response.status}. Consider configuring the Brave provider (webSearch.provider: "brave" + braveApiKey).`);
			}

			const html = await readCappedText(response, PROVIDER_MAX_BODY_BYTES);
			if (CHALLENGE_MARKERS.some((challengeMarker) => html.toLowerCase().includes(challengeMarker)) && !html.includes("result__a")) {
				throw new Error(
					"DuckDuckGo served a challenge page (likely rate limiting or datacenter IP). " +
						"Retry later, or configure the Brave provider (webSearch.provider: \"brave\" + braveApiKey) for reliable results.",
				);
			}

			return parseDuckDuckGoResults(html, limit);
		},
	};
}

export const duckduckgoProvider = createDuckDuckGoProvider(); // default instance (production)
