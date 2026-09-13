/**
 * TUI rendering for web_search / web_fetch tool calls and results.
 * Compact by default; `expanded` shows the full result list / page meta.
 */

import { Text } from "@earendil-works/pi-tui";
import { sanitizeForTui } from "./sanitize.ts";

// Every string rendered below is either web-derived or LLM-supplied; sanitize
// so terminal escape sequences (OSC 52 clipboard writes, CSI repaints, …)
// from fetched pages or prompt-injected models can't reach the TUI.
const s = sanitizeForTui;

type Theme = { fg(color: string, text: string): string };

export interface SearchDetails {
	query?: string;
	provider?: string;
	results?: Array<{ title: string; url: string; snippet: string; domain?: string }>;
	hiddenCount?: number;
}

export interface FetchDetails {
	url?: string;
	finalUrl?: string;
	status?: number;
	domain?: string;
	bytes?: number;
	truncated?: boolean;
	lowContent?: boolean;
	title?: string;
	redirectCount?: number;
}

function firstText(result: { content?: Array<{ type: string; text?: string }> }): string {
	for (const c of result.content ?? []) {
		if (c.type === "text" && c.text) return c.text;
	}
	return "";
}

export function renderSearchCall(args: { query: string; max_results?: number }, theme: Theme): Text {
	let text = theme.fg("muted", `search: ${s(args.query)}`);
	if (args.max_results) text += ` ${theme.fg("dim", `(${args.max_results})`)}`;
	return new Text(text, 0, 0);
}

export function renderSearchResult(
	result: { content?: Array<{ type: string; text?: string }>; details?: unknown; isError?: boolean },
	{ expanded, isPartial }: { expanded: boolean; isPartial: boolean },
	theme: Theme,
): Text {
	if (isPartial) return new Text(theme.fg("warning", "Searching…"), 0, 0);
	if (result.isError) {
		// Error text may embed LLM-supplied URLs (e.g. FetchBlockedError echoes
		// the raw url) — sanitize before it reaches the TUI.
		return new Text(theme.fg("error", `web_search: ${s(firstText(result).split("\n")[0])}`), 0, 0);
	}
	const d = (result.details ?? {}) as SearchDetails;
	const results = d.results ?? [];
	const shown = expanded ? results : results.slice(0, 3);
	let text = theme.fg("success", `✓ ${results.length} result(s) from ${s(d.provider ?? "web")}`);
	if (d.hiddenCount) text += ` ${theme.fg("dim", `· ${d.hiddenCount} hidden by allowlist`)}`;
	for (const r of shown) {
		text += `\n  ${s(r.title)}`;
		text += `\n  ${theme.fg("muted", s(r.url))}`;
	}
	if (!expanded && results.length > 3) text += `\n  ${theme.fg("dim", `… ${results.length - 3} more (expand for all)`)}`;
	return new Text(text, 0, 0);
}

export function renderFetchCall(args: { url: string }, theme: Theme): Text {
	return new Text(theme.fg("muted", `fetch: ${s(args.url)}`), 0, 0);
}

export function renderFetchResult(
	result: { content?: Array<{ type: string; text?: string }>; details?: unknown; isError?: boolean },
	{ expanded, isPartial }: { expanded: boolean; isPartial: boolean },
	theme: Theme,
): Text {
	if (isPartial) return new Text(theme.fg("warning", "Fetching…"), 0, 0);
	if (result.isError) {
		// Error text may embed LLM-supplied URLs (e.g. FetchBlockedError echoes
		// the raw url) — sanitize before it reaches the TUI.
		return new Text(theme.fg("error", `web_fetch: ${s(firstText(result).split("\n")[0])}`), 0, 0);
	}
	const d = (result.details ?? {}) as FetchDetails;
	let text = theme.fg("success", `✓ ${d.status ?? "?"} ${s(d.finalUrl ?? d.url ?? "")}`);
	if (d.title) text += ` ${theme.fg("dim", `· ${s(d.title)}`)}`;
	text += ` ${theme.fg("dim", `· ${Math.round((d.bytes ?? 0) / 1024)}KB${d.truncated ? " (truncated)" : ""}${d.redirectCount ? ` · ${d.redirectCount} redirect(s)` : ""}`)}`;
	if (d.lowContent) text += ` ${theme.fg("warning", "· little readable text (JS page or login wall?)")}`;
	if (expanded && d.domain) text += `\n  ${theme.fg("dim", `domain: ${d.domain}`)}`;
	return new Text(text, 0, 0);
}
