/**
 * Render test for tui-footer: loads the extension with a mock ExtensionAPI,
 * fires agent_start with a mock session context, and asserts on the rendered
 * footer lines.
 */
import assert from "node:assert/strict";
import ext from "../index.ts";

const ANSI = /\x1b\[[0-9;]*m/g;
const strip = (s) => s.replace(ANSI, "");

// --- mock ExtensionAPI -----------------------------------------------------
const handlers = {};
const registered = {};
const pi = {
	on: (event, handler) => {
		(handlers[event] ??= []).push(handler);
	},
	registerCommand: (name, opts) => {
		registered[name] = opts;
	},
};
ext(pi);

// --- mock ExtensionContext --------------------------------------------------
const ctx = {
	mode: "tui",
	cwd: "/home/mac/workspace/local-llm-playground",
	home: "/home/mac",
	model: {
		id: "chat",
		provider: "local-llama",
		contextWindow: 262144,
		reasoning: true,
	},
	thinkingLevel: "xhigh",
	getContextUsage: () => ({ tokens: 55000, contextWindow: 262144, percent: 21.0 }),
	sessionManager: {
		getSessionName: () => undefined,
		getEntries: () => [
			{
				type: "message",
				message: {
					role: "assistant",
					usage: { input: 29000, output: 929, cacheRead: 49000, cacheWrite: 300, cost: { total: 0.0121 } },
				},
			},
			{ type: "message", message: { role: "toolResult", usage: { input: 100, output: 5, cacheRead: 0, cacheWrite: 0, cost: { total: 0 } } } },
		],
	},
	notifications: [],
	ui: {
		setFooter: null, // captured below
		notify: (msg, kind) => ctx.notifications.push(`${kind}: ${msg}`),
	},
};

let footerFactory;
ctx.ui.setFooter = (factory) => {
	footerFactory = factory;
};

// fire agent_start (the safety-net path) — this must install the footer
const agentStart = (handlers.agent_start ?? []).at(-1);
assert(agentStart, "agent_start handler registered");
await agentStart({}, ctx);
assert(footerFactory, "setFooter called with a factory");

const theme = {
	fg: (color, text) => {
		const code = { dim: 2, text: 39, warning: 33, error: 31 }[color] ?? 39;
		return `\x1b[${code}m${text}\x1b[0m`;
	},
};
const footerData = {
	getGitBranch: () => "master",
	getExtensionStatuses: () => new Map([["mcp", "MCP: 1 server enabled"]]),
	getAvailableProviderCount: () => 1,
	onBranchChange: () => () => {},
};

const component = footerFactory({ requestRender() {} }, theme, footerData);
const lines = component.render(120);
lines.forEach((l) => console.log(strip(l)));
console.log("---");

// --- assertions -------------------------------------------------------------
assert.equal(lines.length, 3, "three footer lines (pwd / stats / status)");

// Line 1: pwd, dim, ~-abbreviated, branch
assert.ok(strip(lines[0]).includes("~/workspace/local-llm-playground (master)"), "pwd line");
assert.ok(lines[0].includes("\x1b[2m"), "pwd line is dim");

// Line 2: labeled stats with glyphs, token-based ctx, right-aligned model
const stats = strip(lines[1]);
assert.ok(stats.includes("↑29k"), "input glyphs+amount");
assert.ok(stats.includes("↓934"), "output glyphs+amount");
assert.ok(stats.includes("cached 49k"), "cache-read label");
assert.ok(stats.includes("cache-write 300"), "cache-write label");
assert.ok(stats.includes("cache hit 62.6%"), "cache hit rate");
assert.ok(stats.includes("$0.012"), "cost");
assert.ok(stats.includes("ctx 55k/262k (auto)"), "context as token amounts");
assert.ok(stats.endsWith("chat • xhigh"), "model + thinking level on the right");
assert.ok(lines[1].includes("\x1b[39m"), "stats line uses text color");
// right-aligned: stats line fills the full width
assert.equal(strip(lines[1]).length, 120, "stats line padded to width");

// Line 3: extension status passthrough
assert.ok(strip(lines[2]).includes("MCP: 1 server enabled"), "status line passthrough");

// --- width shrink: sections drop from the left side, never overflow ----------
for (const w of [60, 40, 20]) {
	const narrow = footerFactory({ requestRender() {} }, theme, footerData).render(w);
	narrow.forEach((l) => assert.ok(strip(l).length <= w, `line fits ${w} cols`));
}

// --- context pressure coloring ----------------------------------------------
ctx.getContextUsage = () => ({ tokens: 200000, contextWindow: 262144, percent: 76.3 });
let pressured = footerFactory({ requestRender() {} }, theme, footerData).render(120)[1];
assert.ok(pressured.includes("\x1b[33m"), "warning color above 70%");
ctx.getContextUsage = () => ({ tokens: 240000, contextWindow: 262144, percent: 91.6 });
pressured = footerFactory({ requestRender() {} }, theme, footerData).render(120)[1];
assert.ok(pressured.includes("\x1b[31m"), "error color above 90%");

// --- post-compaction unknown tokens: shows ? instead of crashing -------------
ctx.getContextUsage = () => ({ tokens: null, contextWindow: 262144, percent: null });
const unknown = footerFactory({ requestRender() {} }, theme, footerData).render(120);
assert.ok(strip(unknown[1]).includes("ctx ?/262k"), "unknown context renders ?");

// --- commands ----------------------------------------------------------------
assert(registered["tui-footer"], "/tui-footer registered");
assert(registered["footer-default"], "/footer-default registered");
await registered["footer-default"].handler("", ctx);
assert.equal(footerFactory, undefined, "/footer-default clears the footer");
await registered["tui-footer"].handler("", ctx);
assert(footerFactory, "/tui-footer re-applies the footer");

// --- non-tui mode: never installs -------------------------------------------
let printModeSet = false;
const ctx2 = { ...ctx, mode: "print", ui: { setFooter: () => { printModeSet = true; }, notify() {} } };
const handlers2 = {};
const pi2 = { on: (e, h) => (handlers2[e] = h), registerCommand: () => {} };
ext(pi2);
await handlers2["agent_start"]({}, ctx2);
assert(!printModeSet, "print mode does not set the footer");

console.log("all tui-footer tests passed ✔");
