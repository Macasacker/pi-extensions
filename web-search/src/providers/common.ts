/**
 * Shared helpers for the search providers (DuckDuckGo and Brave).
 *
 * The providers never go through `safeFetch` (their endpoints are fixed,
 * not user-supplied URLs); they share only the fetch + abort +
 * request-failure preamble.
 */

export interface FetchProviderResponseDeps {
	doFetch: typeof fetch;
	signal: AbortSignal;
	headers: Record<string, string>;
	providerName: string;
}

/**
 * Shared fetch + abort + request-failure preamble for the search providers
 * (which never go through `safeFetch`).
 */
export async function fetchProviderResponse(url: string, deps: FetchProviderResponseDeps): Promise<Response> {
	try {
		return await deps.doFetch(url, {
			method: "GET",
			signal: deps.signal,
			headers: deps.headers,
		});
	} catch (error) {
		if (deps.signal.aborted) throw new Error("Search cancelled");
		throw new Error(`${deps.providerName} request failed: ${error instanceof Error ? error.message : String(error)}`);
	}
}
