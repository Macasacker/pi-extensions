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
import type { SearchProvider, SearchResult } from "./types.ts";

const ENDPOINT = "https://html.duckduckgo.com/html/";
const MAX_BODY_BYTES = 1024 * 1024; // provider responses are capped like web_fetch bodies

function decodeDdgHref(href: string): string | null {
	if (!href) return null;
	let full = href;
	if (href.startsWith("//")) full = "https:" + href;
	else if (!href.startsWith("http://") && !href.startsWith("https://")) return null;
	try {
		const u = new URL(full);
		if (u.hostname === "duckduckgo.com" || u.hostname.endsWith(".duckduckgo.com")) {
			const uddg = u.searchParams.get("uddg");
			if (uddg) return decodeURIComponent(uddg);
			// A bare duckduckgo.com link (e.g. a "more results" link) is not a result.
			return null;
		}
		return u.toString();
	} catch {
		return null;
	}
}

const CHALLENGE_MARKERS = ["challenge-form", "anomaly", "not a robot", "please try again later", "unusual traffic"];

export const duckduckgoProvider: SearchProvider = {
	id: "duckduckgo",

	async search(query, limit, signal, fetchImpl) {
		const doFetch = fetchImpl ?? fetch;
		const url = `${ENDPOINT}?q=${encodeURIComponent(query)}`;

		let res: Response;
		try {
			res = await doFetch(url, {
				method: "GET",
				signal,
				headers: {
					"User-Agent": "Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0",
					Accept: "text/html,application/xhtml+xml",
					"Accept-Language": "en-US,en;q=0.9",
				},
			});
		} catch (err) {
			if (signal.aborted) throw new Error("Search cancelled");
			throw new Error(`DuckDuckGo request failed: ${err instanceof Error ? err.message : String(err)}`);
		}

		if (!res.ok) {
			throw new Error(`DuckDuckGo returned HTTP ${res.status}. Consider configuring the Brave provider (webSearch.provider: "brave" + braveApiKey).`);
		}

		const html = await readCappedText(res, MAX_BODY_BYTES);
		if (CHALLENGE_MARKERS.some((m) => html.toLowerCase().includes(m)) && !html.includes("result__a")) {
			throw new Error(
				"DuckDuckGo served a challenge page (likely rate limiting or datacenter IP). " +
					"Retry later, or configure the Brave provider (webSearch.provider: \"brave\" + braveApiKey) for reliable results.",
			);
		}

		const root = parse(html);
		const results: SearchResult[] = [];
		for (const item of root.querySelectorAll(".result")) {
			const a = item.querySelector("a.result__a");
			const urlEl = a?.getAttribute("href");
			const realUrl = urlEl ? decodeDdgHref(urlEl) : null;
			if (!realUrl) continue;
			const title = sanitizeForTui(a?.text?.trim() ?? "");
			const snippet = sanitizeForTui(item.querySelector(".result__snippet")?.text?.trim() ?? "");
			if (!title) continue;
			results.push({ title, url: realUrl, snippet });
			if (results.length >= limit) break;
		}
		return results;
	},
};
