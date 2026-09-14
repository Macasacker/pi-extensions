/** Search provider contract. */

export interface SearchResult {
	title: string;
	url: string;
	snippet: string;
}

export interface SearchProvider {
	id: "duckduckgo" | "brave";
	/**
	 * Search the web. Implementations must respect `signal` and throw a
	 * descriptive error when the backend is unusable (e.g. DDG challenge page).
	 */
	search(query: string, limit: number, signal: AbortSignal): Promise<SearchResult[]>;
}
