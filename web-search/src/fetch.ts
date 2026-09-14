/**
 * Safe HTTP(S) fetch with redirect re-validation.
 *
 * - `redirect: "manual"` so every hop passes through the allowlist check.
 * - Combined abort signal: caller signal (Esc) + per-request timeout.
 * - Body is read incrementally and stopped at maxBytes (marked truncated).
 * - Throws FetchBlockedError for policy violations, FetchError otherwise.
 */

import { checkUrl, type AllowlistOptions } from "./domains.ts";
import { sanitizeForTui } from "./sanitize.ts";

export class FetchBlockedError extends Error {
	readonly url: string;
	constructor(url: string, reason: string) {
		// The message is rendered in the TUI error line and sent to the LLM;
		// url/reason may embed LLM-supplied strings, so strip terminal escapes.
		super(`Blocked: ${sanitizeForTui(url)} — ${sanitizeForTui(reason)}`);
		this.name = "FetchBlockedError";
		this.url = url;
	}
}

export class FetchError extends Error {
	readonly url: string;
	readonly status?: number;
	constructor(url: string, message: string, status?: number) {
		super(`Fetch failed: ${sanitizeForTui(url)} — ${sanitizeForTui(message)}`);
		this.name = "FetchError";
		this.url = url;
		this.status = status;
	}
}

export interface RedirectHop {
	from: string;
	to: string;
}

export interface SafeFetchResult {
	finalUrl: string;
	status: number;
	body: string;
	bodyTruncated: boolean;
	bytes: number;
	redirects: RedirectHop[];
	contentType: string;
}

export interface SafeFetchOptions {
	signal?: AbortSignal;
	timeoutMs: number;
	maxBytes: number;
	maxRedirects: number;
	allowlist: AllowlistOptions;
	/** Injectable for tests. */
	fetchImpl?: typeof fetch;
}

function combinedSignal(caller: AbortSignal | undefined, timeoutMs: number): AbortSignal {
	// AbortSignal.timeout cannot be cancelled early; the timeout simply fires
	// after the request completes (or the caller signal aborts first).
	const timeout = AbortSignal.timeout(timeoutMs);
	return caller ? AbortSignal.any([caller, timeout]) : timeout;
}

export async function readBodyCapped(res: Response, maxBytes: number): Promise<{ body: string; bytes: number; truncated: boolean }> {
	if (!res.body) return { body: "", bytes: 0, truncated: false };
	const reader = res.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	let truncated = false;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		if (value) {
			total += value.byteLength;
			chunks.push(value);
			if (total > maxBytes) {
				truncated = true;
				await reader.cancel().catch(() => {});
				break;
			}
		}
	}
	let merged = new Uint8Array(0);
	for (const c of chunks) {
		const room = maxBytes - merged.byteLength;
		if (room <= 0) break;
		const slice = c.byteLength <= room ? c : c.slice(0, room);
		const next = new Uint8Array(merged.byteLength + slice.byteLength);
		next.set(merged);
		next.set(slice, merged.byteLength);
		merged = next;
	}
	const body = new TextDecoder("utf-8", { fatal: false }).decode(merged);
	return { body, bytes: Math.min(total, maxBytes), truncated };
}

/**
 * Read a response body as text with a hard byte cap (for search-provider
 * responses, which never go through safeFetch).
 */
export async function readCappedText(res: Response, maxBytes: number): Promise<string> {
	const { body } = await readBodyCapped(res, maxBytes);
	return body;
}

/**
 * Fetch a URL, following redirects while re-validating the allowlist at
 * every hop. The initial URL must already be allowed by the caller; this is
 * re-checked here as a backstop.
 */
export async function safeFetch(url: string, opts: SafeFetchOptions): Promise<SafeFetchResult> {
	const doFetch = opts.fetchImpl ?? fetch;
	const redirects: RedirectHop[] = [];
	let current = url;

	for (let hop = 0; ; hop++) {
		const check = checkUrl(current, opts.allowlist);
		if (!check.allowed) throw new FetchBlockedError(current, check.reason ?? "not allowed");

		if (hop > opts.maxRedirects) {
			throw new FetchError(current, `too many redirects (max ${opts.maxRedirects})`);
		}

		const signal = combinedSignal(opts.signal, opts.timeoutMs);
		let res: Response;
		try {
			res = await doFetch(current, {
				method: "GET",
				redirect: "manual",
				signal,
				headers: {
					"User-Agent": "pi-web-search/0.1 (+https://github.com/earendil-works/pi-coding-agent)",
					Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
					"Accept-Language": "en-US,en;q=0.9",
				},
			});
		} catch (err) {
			if (opts.signal?.aborted) throw new FetchError(current, "cancelled");
			// AbortSignal.timeout rejects with name "TimeoutError"; plain aborts with "AbortError".
			if (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError")) {
				throw new FetchError(current, `timed out after ${opts.timeoutMs}ms`);
			}
			throw new FetchError(current, err instanceof Error ? err.message : String(err));
		}

		// Redirect?
		if (res.status >= 300 && res.status < 400) {
			const location = res.headers.get("location");
			res.body?.cancel().catch(() => {});
			if (!location) throw new FetchError(current, `redirect ${res.status} without Location header`);
			let next: string;
			try {
				next = new URL(location, current).toString();
			} catch {
				throw new FetchError(current, `invalid redirect Location: ${location}`);
			}
			redirects.push({ from: current, to: next });
			current = next;
			continue; // loop re-validates `current` at the top
		}

		if (res.status >= 400) {
			res.body?.cancel().catch(() => {});
			throw new FetchError(current, `HTTP ${res.status}`, res.status);
		}

		const { body, bytes, truncated } = await readBodyCapped(res, opts.maxBytes);
		return {
			finalUrl: current,
			status: res.status,
			body,
			bodyTruncated: truncated,
			bytes,
			redirects,
			contentType: res.headers.get("content-type") ?? "",
		};
	}
}
