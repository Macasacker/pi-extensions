/**
 * HTML → readable text extraction and output truncation.
 *
 * Extraction is deliberately conservative: scripts/styles/nav chrome are
 * dropped, block boundaries become newlines, and the result is plain text.
 * Fetched content is untrusted — this module only shapes it, never executes it.
 */

import { parse, HTMLElement, type Node } from "node-html-parser";
import { sanitizeForTui } from "./sanitize.ts";

const DROP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "SVG", "IFRAME", "OBJECT", "EMBED", "TEMPLATE", "HEAD", "NAV", "FOOTER", "ASIDE"]);
const BLOCK_TAGS = new Set(["P", "DIV", "LI", "UL", "OL", "H1", "H2", "H3", "H4", "H5", "H6", "TR", "TABLE", "SECTION", "ARTICLE", "BLOCKQUOTE", "PRE", "HEADER", "MAIN", "FIGCAPTION", "DT", "DD", "BR", "HR"]);

export interface ExtractedPage {
	title?: string;
	text: string;
}

function dropTags(root: HTMLElement): void {
	for (const el of [...root.querySelectorAll("*")]) {
		if (DROP_TAGS.has(el.tagName)) el.remove();
	}
}

function collectText(el: Node, out: string[]): void {
	for (const child of el.childNodes) {
		if (child.nodeType === 3) {
			// Collapse ALL whitespace inside a text node: real line breaks come
			// from block boundaries, so embedded newlines are just soft wrapping.
			out.push(child.text.replace(/\s+/g, " "));
		} else if (child instanceof HTMLElement) {
			const block = BLOCK_TAGS.has(child.tagName);
			if (block) out.push("\n");
			collectText(child, out);
			if (block) out.push("\n");
		}
	}
}

/** Extract readable text from an HTML document. */
export function extractReadableText(html: string): ExtractedPage {
	const root = parse(html);

	// Title must be read before <head> is dropped.
	const title = sanitizeForTui(
		root.querySelector("title")?.text?.trim() ||
		root.querySelector("h1")?.text?.trim() ||
		"",
	) || undefined;

	dropTags(root);

	// Prefer the main content subtree when the page marks one.
	const main =
		root.querySelector("article") ||
		root.querySelector("main") ||
		root.querySelector('[role="main"]') ||
		root.querySelector("body") ||
		root;

	const out: string[] = [];
	collectText(main, out);

	// Normalize whitespace: collapse blank-line runs, trim line ends.
	// Then strip terminal escape sequences / control chars: this text is
	// rendered in the TUI and sent to the LLM, both of which would otherwise
	// be sinks for OSC/CSI injection from the fetched page.
	const text = sanitizeForTui(
		out
			.join("")
			.replace(/[ \t]+\n/g, "\n")
			.replace(/\n{3,}/g, "\n\n")
			.split("\n")
			.map((l) => l.trim())
			.join("\n")
			.replace(/\n{3,}/g, "\n\n")
			.trim(),
	);

	return { title, text };
}

export interface Truncation {
	content: string;
	truncated: boolean;
	totalChars: number;
	outputChars: number;
}

/**
 * Truncate text to maxChars (and maxLines). Keeps the head — search/fetch
 * content is front-loaded. Mirrors pi's built-in tool truncation contract:
 * callers append a note telling the LLM where the full output went.
 */
export function truncateText(text: string, maxChars: number, maxLines = 2000): Truncation {
	let content = text;
	let truncated = false;

	const lines = content.split("\n");
	if (lines.length > maxLines) {
		content = lines.slice(0, maxLines).join("\n");
		truncated = true;
	}
	if (content.length > maxChars) {
		content = content.slice(0, maxChars);
		truncated = true;
	}
	return { content, truncated, totalChars: text.length, outputChars: content.length };
}
