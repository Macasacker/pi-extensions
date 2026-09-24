/**
 * tui-footer — a readable replacement for pi's built-in TUI footer.
 *
 * Replaces the built-in footer with a labeled, human-readable version:
 *
 *   ~/workspace/local-llm-playground (master)
 *   ↑451k ↓39k cached 1.3M cache hit 64.1% ctx 85k/262k (auto)     chat • xhigh
 *   MCP: 1 server enabled
 *
 * Reading the stats line (left to right):
 *   ↑N          tokens sent to the model this session (prompt tokens, session total)
 *   ↓N          tokens received from the model this session (completion tokens)
 *   cached N    tokens served from the prompt cache (cheap input)
 *   cache-write N  tokens written to the prompt cache
 *   cache hit X%   cache-read share of the latest prompt
 *   $X.XXX      total session cost (only shown when > $0)
 *   ctx N/M     current context tokens / model context window — token amounts,
 *               not a percentage. Yellow above 70%, red above 90%.
 *   (auto)      auto-compaction is enabled
 *
 * Right side: model id + thinking level (+ provider when several are configured).
 * Working-directory line and extension status lines (e.g. MCP) keep their own styling;
 * the stats line is rendered in the normal text color so it stands out from the dim
 * working-directory line.
 *
 * Enable via ~/.pi/agent/settings.json:
 *   "extensions": ["~/workspace/pi-extensions/tui-footer/index.ts"]
 *
 * Commands:
 *   /tui-footer       re-apply this footer (after /footer-default)
 *   /footer-default   restore pi's built-in footer
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** Format a token count the way pi's built-in footer does (k/M suffixes). */
function fmt(n: number): string {
	if (n < 1000) return n.toString();
	if (n < 10000) return `${(n / 1000).toFixed(1)}k`;
	if (n < 1000000) return `${Math.round(n / 1000)}k`;
	if (n < 10000000) return `${(n / 1000000).toFixed(1)}M`;
	return `${Math.round(n / 1000000)}M`;
}

/**
 * Read compaction.enabled the way pi does: project .pi/settings.json overrides
 * the global one; default true.
 */
function autoCompactEnabled(cwd: string): boolean {
	const files = [path.join(os.homedir(), ".pi", "agent", "settings.json"), path.join(cwd, ".pi", "settings.json")];
	for (const file of files) {
		try {
			const s = JSON.parse(fs.readFileSync(file, "utf8"));
			if (typeof s?.compaction?.enabled === "boolean") return s.compaction.enabled;
		} catch {
			// missing or unreadable — try next
		}
	}
	return true;
}

/** Session usage totals, mirroring pi's built-in footer accounting. */
function computeTotals(ctx: ExtensionContext) {
	const t = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, hit: undefined as number | undefined };
	const add = (u: any) => {
		if (!u) return;
		t.input += u.input ?? 0;
		t.output += u.output ?? 0;
		t.cacheRead += u.cacheRead ?? 0;
		t.cacheWrite += u.cacheWrite ?? 0;
		t.cost += u.cost?.total ?? 0;
	};
	try {
		for (const e of ctx.sessionManager.getEntries() as any[]) {
			if (e.type === "message" && e.message?.role === "assistant") {
				add(e.message.usage);
				const prompt = (e.message.usage?.input ?? 0) + (e.message.usage?.cacheRead ?? 0) + (e.message.usage?.cacheWrite ?? 0);
				if (prompt > 0) t.hit = ((e.message.usage.cacheRead ?? 0) / prompt) * 100;
			} else if (e.type === "message" && e.message?.role === "toolResult" && e.message.usage) {
				add(e.message.usage);
			} else if ((e.type === "branch_summary" || e.type === "compaction") && e.usage) {
				add(e.usage);
			}
		}
	} catch {
		// footer must never crash rendering
	}
	return t;
}

/** Working directory, ~-abbreviated, with git branch and session name. */
function pwdDisplay(ctx: ExtensionContext, branch: string | null | undefined, sessionName: string | undefined): string {
	const cwd = ctx.cwd ?? process.cwd();
	let pwd = cwd;
	try {
		const rel = path.relative(os.homedir(), cwd);
		if (rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel)) pwd = `~${path.sep}${rel}`;
	} catch {
		// keep cwd as-is
	}
	if (branch) pwd = `${pwd} (${branch})`;
	if (sessionName) pwd = `${pwd} • ${sessionName}`;
	return pwd;
}

// ---------------------------------------------------------------------------
// rendering
// ---------------------------------------------------------------------------

type Theme = { fg(color: string, text: string): string };
type FooterData = {
	getGitBranch(): string | null;
	getExtensionStatuses(): ReadonlyMap<string, string>;
	getAvailableProviderCount(): number;
	onBranchChange(cb: () => void): () => void;
};

/**
 * Build the stats line: session token totals on the left, model id on the
 * right. Stats are the normal text color so they stand out from the dim pwd
 * line; the right-side model stays dim. Colored spans inside (context
 * pressure) keep their own codes.
 */
function buildStatsLine(width: number, theme: Theme, footerData: FooterData, ctx: ExtensionContext): string {
	// Session token totals (same accounting as the built-in footer), with the
	// context gauge last so narrow terminals truncate it first, like pi does.
	const spans: { text: string; color?: string }[] = [];
	const t = computeTotals(ctx);
	if (t.input > 0) spans.push({ text: `↑${fmt(t.input)}` });
	if (t.output > 0) spans.push({ text: `↓${fmt(t.output)}` });
	if (t.cacheRead > 0) spans.push({ text: `cached ${fmt(t.cacheRead)}` });
	if (t.cacheWrite > 0) spans.push({ text: `cache-write ${fmt(t.cacheWrite)}` });
	if (t.hit !== undefined) spans.push({ text: `cache hit ${t.hit.toFixed(1)}%` });
	if (t.cost > 0.0005) spans.push({ text: `$${t.cost.toFixed(3)}` });

	// Context usage: token amounts, colored by pressure (>70% warning, >90% error)
	const cu = ctx.getContextUsage?.();
	const model = ctx.model;
	const window = cu?.contextWindow ?? model?.contextWindow ?? 0;
	const pct = cu?.percent;
	const ctxUsed = cu?.tokens ?? null;
	if (window > 0 || ctxUsed !== null) {
		const auto = autoCompactEnabled(ctx.cwd ?? process.cwd()) ? " (auto)" : "";
		const color = pct !== null && pct !== undefined && pct > 90 ? "error" : pct !== null && pct !== undefined && pct > 70 ? "warning" : undefined;
		spans.push({ text: `ctx ${ctxUsed === null ? "?" : fmt(ctxUsed)}/${fmt(window)}${auto}`, color });
	}

	// Right side: model id + thinking level (+ provider when ambiguous)
	let right = model?.id ?? "no-model";
	if (model?.reasoning) {
		const level = ctx.thinkingLevel ?? "off";
		right = level === "off" ? `${right} • thinking off` : `${right} • ${level}`;
	}
	if (footerData.getAvailableProviderCount?.() > 1 && model) right = `(${model.provider}) ${right}`;

	// Compose the line, dropping least-essential sections if too narrow.
	const minPadding = 2;
	const rightWidth = visibleWidth(right);
	const available = Math.max(1, width - rightWidth - minPadding);
	const colored = (s: { text: string; color?: string }) => (s.color ? theme.fg(s.color, s.text) : theme.fg("text", s.text));

	let left = spans.map(colored).join(" ");
	while (visibleWidth(left) > available && spans.length > 1) {
		spans.pop();
		left = spans.map(colored).join(" ");
	}
	if (visibleWidth(left) > available) left = truncateToWidth(left, available, theme.fg("dim", "…"));
	const pad = " ".repeat(Math.max(0, width - visibleWidth(left) - rightWidth));
	return truncateToWidth(left + pad + theme.fg("dim", right), width);
}

function renderFooter(width: number, theme: Theme, footerData: FooterData, ctx: ExtensionContext | undefined): string[] {
	if (!ctx || width < 10) return [];
	try {
		// Line 1: working directory (dim)
		const line1 = truncateToWidth(
			theme.fg("dim", pwdDisplay(ctx, footerData.getGitBranch?.(), ctx.sessionManager?.getSessionName?.())),
			width,
			theme.fg("dim", "..."),
		);

		// Line 2: session stats (left) + model (right)
		const line2 = buildStatsLine(width, theme, footerData, ctx);

		// Line 3: extension status lines (e.g. MCP) — kept as-is, including any
		// ANSI colors the setting extension chose.
		const lines = [line1, line2];
		const statuses = footerData.getExtensionStatuses?.();
		if (statuses && statuses.size > 0) {
			const statusLine = Array.from(statuses.entries())
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([, text]) => String(text).replace(/[\r\n\t]/g, " ").replace(/ +/g, " ").trim())
				.join(" ");
			lines.push(truncateToWidth(statusLine, width, theme.fg("dim", "...")));
		}
		return lines;
	} catch {
		return [];
	}
}

// ---------------------------------------------------------------------------
// extension
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
	let installedCtx: ExtensionContext | undefined;
	let currentCtx: ExtensionContext | undefined;

	const install = (ctx: ExtensionContext) => {
		if (ctx.mode !== "tui" || installedCtx === ctx) return;
		installedCtx = ctx;
		currentCtx = ctx;
		try {
			ctx.ui.setFooter((tui, theme, footerData) => {
				const unsub = footerData.onBranchChange?.(() => tui.requestRender());
				return {
					invalidate() {},
					dispose: unsub,
					render: (width: number) => renderFooter(width, theme as Theme, footerData, currentCtx),
				};
			});
		} catch {
			installedCtx = undefined;
		}
	};

	const restore = (ctx: ExtensionContext) => {
		installedCtx = undefined;
		currentCtx = undefined;
		try {
			ctx.ui.setFooter(undefined);
		} catch {
			// ignore
		}
	};

	pi.on("session_start", (_event, ctx) => install(ctx));
	pi.on("agent_start", (_event, ctx) => install(ctx)); // safety net
	pi.on("session_shutdown", () => {
		installedCtx = undefined;
	});

	pi.registerCommand("tui-footer", {
		description: "Apply the tui-footer readable footer",
		handler: async (_args, ctx) => {
			if (ctx.mode !== "tui") return;
			install(ctx);
			ctx.ui.notify?.(installedCtx ? "tui-footer applied" : "tui-footer failed to apply", installedCtx ? "info" : "error");
		},
	});

	pi.registerCommand("footer-default", {
		description: "Restore pi's built-in footer",
		handler: async (_args, ctx) => {
			if (ctx.mode !== "tui") return;
			restore(ctx);
			ctx.ui.notify?.("Built-in footer restored", "info");
		},
	});
}
