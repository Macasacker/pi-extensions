// End-to-end: load the real extension with a mock ExtensionAPI and exercise
// the registered tools against a local HTTP server and a fake search provider.
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { test, finish } from "./harness.mjs";

const extensionModule = await import("../index.ts");
const extension = extensionModule.default;
const { setTestProvider } = extensionModule;
const { FetchBlockedError } = await import("../src/fetch.ts");

// --- local server (reachable as both 127.0.0.1 and localhost) ---------------
const server = http.createServer((request, response) => {
	if (request.url === "/shell") {
		// JS-shell page: large HTML (fake JS bundle) but almost no readable text
		response.writeHead(200, { "Content-Type": "text/html" });
		response.end(`<html><head><title></title></head><body><script>${"var x=1;".repeat(2000)}</script><div id=\"app\"></div></body></html>`);
		return;
	}
	if (request.url === "/long") {
		// Long page: enough readable text to truncate at the 1000-char schema minimum
		response.writeHead(200, { "Content-Type": "text/html" });
		response.end(`<html><head><title>Long Page</title></head><body><article><h1>Long Heading</h1><p>${"lorem ipsum dolor sit amet ".repeat(100)}</p></article></body></html>`);
		return;
	}
	if (request.url === "/redirect") {
		// Redirects to the allowed /page so the fetch follows one hop inside the allowlist
		response.writeHead(302, { Location: "/page" });
		response.end();
		return;
	}
	response.writeHead(200, { "Content-Type": "text/html" });
	response.end("<html><head><title>E2E Page</title></head><body><article><h1>E2E Heading</h1><p>e2e body text</p></article></body></html>");
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;

// --- temp home with a restrictive allowlist ---------------------------------
const root = fs.mkdtempSync(path.join(os.tmpdir(), "websearch-e2e-"));
const home = path.join(root, "home");
const cwd = path.join(root, "project");
fs.mkdirSync(path.join(home, ".pi", "agent"), { recursive: true });
fs.mkdirSync(cwd, { recursive: true });
const savedHome = process.env.HOME;
process.env.HOME = home; // os.homedir() on Linux honors $HOME

function writeGlobalConfig(settings) {
	fs.writeFileSync(path.join(home, ".pi", "agent", "settings.json"), JSON.stringify(settings));
}
writeGlobalConfig({
	webSearch: {
		useBuiltins: false,
		allowedDomains: ["127.0.0.1"],
		blockPrivateNetworks: false,
	},
});

// --- mock ExtensionAPI --------------------------------------------------------
const tools = {};
const commands = {};
const logEntries = [];
const notifications = [];
const confirms = [];
// Session lifecycle handlers (session_start / session_shutdown) recorded at
// registration time so tests can fire them. A no-op `on` would let a
// reset-rebind regression (capturing the session object at registration
// instead of reading the closure variable at call time) pass the whole suite.
const sessionEventHandlers = {};
let confirmAnswer = true;
let lastCustomComponent = null;
const mockExtensionApi = {
	on: (event, handler) => {
		(sessionEventHandlers[event] ??= []).push(handler);
	},
	registerTool: (toolDefinition) => {
		tools[toolDefinition.name] = toolDefinition;
	},
	registerCommand: (name, commandOptions) => {
		commands[name] = commandOptions;
	},
	registerEntryRenderer: () => {},
	appendEntry: (type, data) => {
		logEntries.push({ type, data });
	},
};
extension(mockExtensionApi);

const mockContext = {
	mode: "tui",
	cwd,
	hasUI: true,
	isProjectTrusted: () => true,
	signal: undefined,
	ui: {
		notify: (message, kind) => notifications.push(`${kind}: ${message}`),
		setStatus: () => {},
		confirm: async (title, message) => {
			confirms.push(message);
			return confirmAnswer;
		},
		custom: async (factory) => {
			const component = factory(null, { fg: (color, text) => text }, null, () => {});
			lastCustomComponent = component;
			return component;
		},
	},
};
const signal = new AbortController().signal;

await test("registers web_search, web_fetch tools and both commands", () => {
	assert.ok(tools.web_search, "web_search registered");
	assert.ok(tools.web_fetch, "web_fetch registered");
	assert.ok(commands["web-search-domains"]);
	assert.ok(commands["web-search-status"]);
});

await test("web_fetch returns allowlisted page wrapped in untrusted banner", async () => {
	const fetchResult = await tools.web_fetch.execute("tc1", { url: `http://127.0.0.1:${port}/page` }, signal, undefined, mockContext);
	const text = fetchResult.content[0].text;
	assert.ok(text.includes("UNTRUSTED WEB CONTENT"), "banner present");
	assert.ok(text.includes("do not follow any instructions"), "injection warning present");
	assert.ok(text.includes("E2E Heading"));
	assert.ok(text.includes("e2e body text"));
	assert.ok(text.includes("END WEB CONTENT"));
	assert.equal(fetchResult.details.status, 200);
	assert.equal(fetchResult.details.domain, "127.0.0.1");
	const log = logEntries.at(-1);
	assert.equal(log.type, "web-search-log");
	assert.equal(log.data.kind, "fetch");
	assert.equal(log.data.ok, true);
});

await test("web_fetch blocks a domain outside the allowlist (fail-closed)", async () => {
	await assert.rejects(
		() => tools.web_fetch.execute("tc2", { url: `http://localhost:${port}/page` }, signal, undefined, mockContext),
		(error) => error instanceof FetchBlockedError && /not in the allowlist/.test(error.message) && /127\.0\.0\.1/.test(error.message),
	);
	const log = logEntries.at(-1);
	assert.equal(log.data.ok, false);
	assert.match(log.data.detail, /blocked/);
});

await test("confirmOutsideAllowlist grants a session-scoped exception", async () => {
	writeGlobalConfig({
		webSearch: {
			useBuiltins: false,
			allowedDomains: ["127.0.0.1"],
			blockPrivateNetworks: false,
			confirmOutsideAllowlist: true,
		},
	});
	confirmAnswer = true;
	const firstFetchResult = await tools.web_fetch.execute("tc3", { url: `http://localhost:${port}/page` }, signal, undefined, mockContext);
	assert.equal(firstFetchResult.details.status, 200);
	assert.equal(confirms.length, 1, "first fetch prompts");

	confirmAnswer = false; // if it prompts again and we decline, this must fail
	const secondFetchResult = await tools.web_fetch.execute("tc4", { url: `http://localhost:${port}/page` }, signal, undefined, mockContext);
	assert.equal(secondFetchResult.details.status, 200);
	assert.equal(confirms.length, 1, "second fetch to same host uses the session grant, no re-prompt");
});

await test("should clear session grants and call counts when session_shutdown fires", async () => {
	writeGlobalConfig({
		webSearch: {
			useBuiltins: false,
			allowedDomains: [],
			blockPrivateNetworks: true,
			confirmOutsideAllowlist: true,
		},
	});
	const resetUrl = `http://127.0.0.1:${port}/page`; // ungranted at this point in the suite
	const confirmsBefore = confirms.length;
	confirmAnswer = true;

	const firstFetchResult = await tools.web_fetch.execute("tc20", { url: resetUrl }, signal, undefined, mockContext);
	assert.equal(firstFetchResult.details.status, 200);
	assert.equal(confirms.length, confirmsBefore + 1, "first fetch to an ungranted host prompts");

	for (const handler of sessionEventHandlers["session_shutdown"]) handler();

	const confirmsBeforeSecond = confirms.length;
	confirmAnswer = false; // a leaked grant would skip the prompt and succeed
	await assert.rejects(
		() => tools.web_fetch.execute("tc21", { url: resetUrl }, signal, undefined, mockContext),
		(error) => error instanceof FetchBlockedError && /declined/.test(error.message),
	);
	assert.equal(confirms.length, confirmsBeforeSecond + 1, "second fetch after the reset re-prompts (the grant is gone)");

	const notificationsBefore = notifications.length;
	await commands["web-search-status"].handler("", mockContext);
	const statusNotification = notifications.slice(notificationsBefore).at(-1);
	assert.match(statusNotification, /session: 0 call\(s\), 0 granted host\(s\)/, "status after the reset reports a fresh session");
});

await test("declined confirmation blocks the fetch", async () => {
	confirmAnswer = false;
	await assert.rejects(
		() => tools.web_fetch.execute("tc5", { url: "http://ungranted.example/" }, signal, undefined, mockContext),
		(error) => error instanceof FetchBlockedError && /declined/.test(error.message),
	);
});

await test("non-interactive mode blocks without prompting (fail-closed)", async () => {
	// config from the previous test has confirmOutsideAllowlist: true — in print mode
	// that must be irrelevant: no UI, no prompt, just a block.
	const printModeContext = { ...mockContext, mode: "print", hasUI: false, ui: { notify: () => {}, setStatus: () => {} } };
	const confirmsBefore = confirms.length;
	await assert.rejects(
		() => tools.web_fetch.execute("tc10", { url: "http://ungranted2.example/" }, signal, undefined, printModeContext),
		(error) => error instanceof FetchBlockedError && /not in the allowlist/.test(error.message),
	);
	assert.equal(confirms.length, confirmsBefore, "no confirmation may be attempted without UI");
});

await test("confirm grant works for IP-literal hosts (grant overrides blockPrivateNetworks)", async () => {
	writeGlobalConfig({
		webSearch: {
			useBuiltins: false,
			allowedDomains: [],
			blockPrivateNetworks: true,
			confirmOutsideAllowlist: true,
		},
	});
	confirmAnswer = true;
	const fetchResult = await tools.web_fetch.execute("tc11", { url: `http://127.0.0.1:${port}/page` }, signal, undefined, mockContext);
	assert.equal(fetchResult.details.status, 200, "user-confirmed private IP fetch must succeed");
	assert.equal(fetchResult.details.domain, "127.0.0.1");
});

await test("scheme-blocked URL (ftp://) never prompts, even with confirmOutsideAllowlist", async () => {
	const confirmsBefore = confirms.length;
	await assert.rejects(
		() => tools.web_fetch.execute("tc12", { url: `ftp://127.0.0.1:${port}/x` }, signal, undefined, mockContext),
		(error) => error instanceof FetchBlockedError && /scheme/i.test(error.message),
	);
	assert.equal(confirms.length, confirmsBefore, "scheme blocks must not enter the confirm flow");
});

await test("escape-bearing URL: no terminal escapes reach the TUI (error render + confirm dialog)", async () => {
	const { renderFetchResult, renderSearchResult } = await import("../src/render.ts");
	const theme = { fg: (_color, text) => text };
	const evilUrl = "http://blocked.example/\x1b]52;c;CLIPBOARD-PWNED\x07";

	// 1) default config (no confirm): blocked → pi-shaped error result → rendered error line
	writeGlobalConfig({ webSearch: { useBuiltins: false, allowedDomains: ["127.0.0.1"], blockPrivateNetworks: false } });
	let thrown;
	try {
		await tools.web_fetch.execute("tc13", { url: evilUrl }, signal, undefined, mockContext);
	} catch (error) {
		thrown = error;
	}
	assert.ok(thrown instanceof FetchBlockedError, "blocked fetch must throw");
	assert.ok(!thrown.message.includes("\x1b"), "error message itself must be escape-free");
	const errorResult = { content: [{ type: "text", text: thrown.message }], isError: true };
	const rendered = renderFetchResult(errorResult, { expanded: false, isPartial: false }, theme);
	const renderedLines = rendered.render(200).join("\n");
	assert.ok(!renderedLines.includes("\x1b"), `rendered error line must not carry escapes: ${JSON.stringify(renderedLines)}`);
	assert.ok(!renderedLines.includes("CLIPBOARD-PWNED"));

	// search renderer error branch (same sink class)
	const renderedSearch = renderSearchResult(errorResult, { expanded: false, isPartial: false }, theme);
	const searchRenderedLines = renderedSearch.render(200).join("\n");
	assert.ok(!searchRenderedLines.includes("\x1b"));

	// 2) confirm dialog: message shown to the user must be escape-free
	writeGlobalConfig({ webSearch: { useBuiltins: false, allowedDomains: ["127.0.0.1"], blockPrivateNetworks: false, confirmOutsideAllowlist: true } });
	confirmAnswer = false; // decline — we only care about the dialog text
	const confirmsBefore = confirms.length;
	await assert.rejects(() => tools.web_fetch.execute("tc14", { url: evilUrl }, signal, undefined, mockContext), FetchBlockedError);
	assert.equal(confirms.length, confirmsBefore + 1, "confirm dialog must have been shown");
	const dialog = confirms[confirms.length - 1];
	assert.ok(!dialog.includes("\x1b"), `confirm dialog must not carry escapes: ${JSON.stringify(dialog)}`);
	assert.ok(!dialog.includes("CLIPBOARD-PWNED"));
});

await test("web_search filters results to allowed domains (fake provider)", async () => {
	writeGlobalConfig({ webSearch: { useBuiltins: false, allowedDomains: ["127.0.0.1"], blockPrivateNetworks: false } });
	setTestProvider({
		id: "fake",
		search: async () => [
			{ title: "Allowed Doc", url: `http://127.0.0.1:${port}/doc`, snippet: "allowed snippet" },
			{ title: "Evil Result", url: "https://evil.example/page", snippet: "evil snippet" },
			{ title: "Also Evil", url: "https://evil.example/other", snippet: "more evil" },
		],
	});
	const searchResult = await tools.web_search.execute("tc6", { query: "test query" }, signal, undefined, mockContext);
	const text = searchResult.content[0].text;
	assert.ok(text.includes("Allowed Doc"));
	assert.ok(text.includes("http://127.0.0.1"));
	assert.ok(!text.includes("Evil Result"), "hidden results must never reach the LLM");
	assert.ok(!text.includes("evil.example"));
	assert.match(text, /2 result\(s\) hidden/);
	assert.equal(searchResult.details.hiddenCount, 2);
	assert.equal(searchResult.details.results.length, 1);
	setTestProvider(undefined);
});

await test("web_search reports when nothing is allowed", async () => {
	setTestProvider({
		id: "fake",
		search: async () => [{ title: "Evil", url: "https://evil.example/x", snippet: "s" }],
	});
	const searchResult = await tools.web_search.execute("tc7", { query: "only evil" }, signal, undefined, mockContext);
	assert.match(searchResult.content[0].text, /No results from allowed domains/);
	assert.match(searchResult.content[0].text, /web-search-domains/);
	setTestProvider(undefined);
});

await test("should report Cancelled and log a cancelled entry when the signal aborts before the provider search settles", async () => {
	writeGlobalConfig({ webSearch: { useBuiltins: false, allowedDomains: ["127.0.0.1"], blockPrivateNetworks: false } });
	let searchInvoked = false;
	setTestProvider({
		id: "fake",
		search: async () => {
			searchInvoked = true; // the provider must be called even when the signal is already aborted
			return [{ title: "Allowed Doc", url: `http://127.0.0.1:${port}/doc`, snippet: "allowed snippet" }];
		},
	});

	const abortController = new AbortController();
	abortController.abort(); // the user pressed Esc before the provider settled
	const searchResult = await tools.web_search.execute("tc30", { query: "test query" }, abortController.signal, undefined, mockContext);
	setTestProvider(undefined);

	assert.ok(searchInvoked, "the provider was invoked — the abort is checked after the search settles, not before the call");
	assert.equal(searchResult.content[0].text, "Cancelled");
	const logEntry = logEntries.at(-1);
	assert.equal(logEntry.type, "web-search-log");
	assert.equal(logEntry.data.kind, "search");
	assert.equal(logEntry.data.target, "test query");
	assert.equal(logEntry.data.ok, false);
	assert.equal(logEntry.data.detail, "cancelled");
});

await test("should log the provider error and rethrow when the search provider rejects", async () => {
	writeGlobalConfig({ webSearch: { useBuiltins: false, allowedDomains: ["127.0.0.1"], blockPrivateNetworks: false } });
	const providerFailureMessage = "provider exploded";
	setTestProvider({
		id: "fake",
		search: async () => {
			throw new Error(providerFailureMessage);
		},
	});

	await assert.rejects(
		() => tools.web_search.execute("tc31", { query: "test query" }, signal, undefined, mockContext),
		(error) => error instanceof Error && error.message === providerFailureMessage,
	);
	setTestProvider(undefined);

	const logEntry = logEntries.at(-1);
	assert.equal(logEntry.type, "web-search-log");
	assert.equal(logEntry.data.kind, "search");
	assert.equal(logEntry.data.target, "test query");
	assert.equal(logEntry.data.ok, false);
	assert.equal(logEntry.data.detail, providerFailureMessage);
});

await test("/web-search-domains add/remove updates the settings file", async () => {
	writeGlobalConfig({ webSearch: { useBuiltins: false, allowedDomains: ["127.0.0.1"], blockPrivateNetworks: false } });
	const file = path.join(home, ".pi", "agent", "settings.json");

	await commands["web-search-domains"].handler("add docs.example", mockContext);
	let settings = JSON.parse(fs.readFileSync(file, "utf8"));
	assert.ok(settings.webSearch.allowedDomains.includes("docs.example"));
	assert.ok(settings.webSearch.allowedDomains.includes("127.0.0.1"), "existing entries preserved");

	// duplicate add is a no-op
	await commands["web-search-domains"].handler("add docs.example", mockContext);
	settings = JSON.parse(fs.readFileSync(file, "utf8"));
	assert.equal(settings.webSearch.allowedDomains.filter((domain) => domain === "docs.example").length, 1);

	await commands["web-search-domains"].handler("remove docs.example", mockContext);
	settings = JSON.parse(fs.readFileSync(file, "utf8"));
	assert.ok(!settings.webSearch.allowedDomains.includes("docs.example"));
	assert.ok(settings.webSearch.allowedDomains.includes("127.0.0.1"));

	// multi-word domain is rejected, file untouched
	await commands["web-search-domains"].handler("add not a domain", mockContext);
	settings = JSON.parse(fs.readFileSync(file, "utf8"));
	assert.ok(!settings.webSearch.allowedDomains.includes("not"));
	assert.ok(notifications.some((notification) => notification.includes("can't contain spaces")));

	// bare "add" with no domain falls through to the list view, file untouched
	await commands["web-search-domains"].handler("add", mockContext);
	settings = JSON.parse(fs.readFileSync(file, "utf8"));
	assert.ok(!settings.webSearch.allowedDomains.includes("add"));
});

await test("/web-search-domains with no args shows the list without throwing", async () => {
	await commands["web-search-domains"].handler("", mockContext); // TUI path uses ui.custom
	await commands["web-search-status"].handler("", mockContext);
});

await test("TUI /web-search-domains dialog implements handleInput and dismisses on escape/enter/ctrl+c", async () => {
	// Regression: the dialog used to assign a non-existent `onKey` property,
	// which pi-tui never calls — the dialog could not be dismissed at all.
	// pi-tui dispatches keys via handleInput(data) on the focused component.
	let doneValue = undefined;
	let doneCalled = false;
	const originalCustom = mockContext.ui.custom;
	mockContext.ui.custom = async (factory) => {
		const component = factory(null, { fg: (color, text) => text }, null, (value) => {
			doneCalled = true;
			doneValue = value;
		});
		lastCustomComponent = component;
		return component;
	};
	try {
		await commands["web-search-domains"].handler("", mockContext);
		assert.ok(lastCustomComponent, "custom dialog component was created");
		assert.equal(typeof lastCustomComponent.handleInput, "function", "component implements the Component input contract");

		lastCustomComponent.handleInput("\u001b"); // escape
		assert.ok(doneCalled, "escape dismisses the dialog");
		assert.equal(doneValue, null);

		doneCalled = false;
		lastCustomComponent.handleInput("\r"); // enter
		assert.ok(doneCalled, "enter dismisses the dialog");

		doneCalled = false;
		lastCustomComponent.handleInput("\u0003"); // ctrl+c
		assert.ok(doneCalled, "ctrl+c dismisses the dialog");
	} finally {
		mockContext.ui.custom = originalCustom;
	}
});

await test("JS-shell / login-wall page is flagged as low-content; normal page is not", async () => {
	writeGlobalConfig({ webSearch: { useBuiltins: false, allowedDomains: ["127.0.0.1"], blockPrivateNetworks: false } });
	const shell = await tools.web_fetch.execute("tc15", { url: `http://127.0.0.1:${port}/shell` }, signal, undefined, mockContext);
	assert.match(shell.content[0].text, /little readable text/);
	assert.match(shell.content[0].text, /alternate endpoint/);
	assert.equal(shell.details.lowContent, true);

	const normal = await tools.web_fetch.execute("tc16", { url: `http://127.0.0.1:${port}/page` }, signal, undefined, mockContext);
	assert.equal(normal.details.lowContent, false);
	assert.doesNotMatch(normal.content[0].text, /little readable text/);
});

await test("should append the truncation note with the temp file path when the page exceeds max_chars", async () => {
	writeGlobalConfig({ webSearch: { useBuiltins: false, allowedDomains: ["127.0.0.1"], blockPrivateNetworks: false } });
	const minMaxChars = 1000; // the schema minimum for web_fetch's max_chars

	const fetchResult = await tools.web_fetch.execute("tc40", { url: `http://127.0.0.1:${port}/long`, max_chars: minMaxChars }, signal, undefined, mockContext);
	const text = fetchResult.content[0].text;

	assert.equal(fetchResult.details.truncated, true);
	const truncationNote = text.match(/\[Content truncated: (\d+) of (\d+) chars\. Full text saved to: (.+)\]/);
	assert.ok(truncationNote, `truncation note missing: ${JSON.stringify(text)}`);
	assert.equal(Number(truncationNote[1]), minMaxChars, "output is capped at max_chars");
	assert.ok(Number(truncationNote[2]) > minMaxChars, "the page was longer than the cap");
	const fullTextFile = truncationNote[3];
	assert.equal(fullTextFile, path.join(os.tmpdir(), "pi-web-search-tc40.txt"));
	assert.ok(fs.existsSync(fullTextFile), "full text file was written");
	assert.equal(fs.readFileSync(fullTextFile, "utf8").length, Number(truncationNote[2]), "the temp file holds the full pre-truncation text");
	assert.ok(text.includes("Long Heading"), "the kept head of the page is present");
});

await test("should append the redirect note when the server redirects to an allowed page", async () => {
	writeGlobalConfig({ webSearch: { useBuiltins: false, allowedDomains: ["127.0.0.1"], blockPrivateNetworks: false } });

	const fetchResult = await tools.web_fetch.execute("tc41", { url: `http://127.0.0.1:${port}/redirect` }, signal, undefined, mockContext);
	const text = fetchResult.content[0].text;

	assert.ok(
		text.includes(`[Redirects: http://127.0.0.1:${port}/redirect → http://127.0.0.1:${port}/page]`),
		`redirect note missing: ${JSON.stringify(text)}`,
	);
	assert.equal(fetchResult.details.redirectCount, 1);
	assert.equal(fetchResult.details.finalUrl, `http://127.0.0.1:${port}/page`);
	assert.equal(fetchResult.details.status, 200);
});

await test("out-of-band allowlist change (e.g. agent editing settings.json) is detected and surfaced", async () => {
	writeGlobalConfig({ webSearch: { useBuiltins: false, allowedDomains: ["127.0.0.1"], blockPrivateNetworks: false } });
	await tools.web_fetch.execute("tc17", { url: `http://127.0.0.1:${port}/page` }, signal, undefined, mockContext); // baseline
	const notificationsBefore = notifications.length;
	// simulate the agent editing settings.json directly (not via /web-search-domains)
	writeGlobalConfig({ webSearch: { useBuiltins: false, allowedDomains: ["127.0.0.1", "sneaky.example"], blockPrivateNetworks: false } });
	const logStartIndex = logEntries.length;
	await tools.web_fetch.execute("tc18", { url: `http://127.0.0.1:${port}/page` }, signal, undefined, mockContext);
	const newNotifications = notifications.slice(notificationsBefore);
	assert.ok(
		newNotifications.some((notification) => notification.includes("allowlist changed") && notification.includes("sneaky.example")),
		`expected a drift warning, got: ${JSON.stringify(newNotifications)}`,
	);
	const newLogs = logEntries.slice(logStartIndex);
	assert.ok(
		newLogs.some((logEntry) => logEntry.type === "web-search-log" && logEntry.data.kind === "config"),
		`expected a config log entry, got: ${JSON.stringify(newLogs)}`,
	);
});

await test("allowlist change via /web-search-domains (user-initiated) does NOT trigger the drift warning", async () => {
	const notificationsBefore = notifications.length;
	await commands["web-search-domains"].handler("add cmdadded.example", mockContext);
	await tools.web_fetch.execute("tc19", { url: `http://127.0.0.1:${port}/page` }, signal, undefined, mockContext);
	assert.ok(
		!notifications.slice(notificationsBefore).some((notification) => notification.includes("allowlist changed")),
		"user-initiated command changes must not warn",
	);
});

await test("disabled config blocks both tools and logs the disabled entry for each", async () => {
	writeGlobalConfig({ webSearch: { enabled: false, useBuiltins: false, allowedDomains: ["127.0.0.1"], blockPrivateNetworks: false } });

	const fetchTarget = `http://127.0.0.1:${port}/`;
	await assert.rejects(() => tools.web_fetch.execute("tc8", { url: fetchTarget }, signal, undefined, mockContext), /disabled/i);
	const fetchLogEntry = logEntries.at(-1);
	assert.equal(fetchLogEntry.type, "web-search-log");
	assert.equal(fetchLogEntry.data.kind, "fetch");
	assert.equal(fetchLogEntry.data.target, fetchTarget);
	assert.equal(fetchLogEntry.data.ok, false);
	assert.equal(fetchLogEntry.data.detail, "disabled (webSearch.enabled: false)");

	const searchTarget = "q";
	await assert.rejects(() => tools.web_search.execute("tc9", { query: searchTarget }, signal, undefined, mockContext), /disabled/i);
	const searchLogEntry = logEntries.at(-1);
	assert.equal(searchLogEntry.type, "web-search-log");
	assert.equal(searchLogEntry.data.kind, "search");
	assert.equal(searchLogEntry.data.target, searchTarget);
	assert.equal(searchLogEntry.data.ok, false);
	assert.equal(searchLogEntry.data.detail, "disabled (webSearch.enabled: false)");
});

await test("should surface config warnings once per session when the settings file has a problem", async () => {
	// sneaky.example and cmdadded.example are in the allowlist of the previous
	// tests, so keeping them here avoids an unrelated drift warning in the
	// notification assertions.
	writeGlobalConfig({ webSearch: { useBuiltins: false, allowedDomains: ["127.0.0.1", "sneaky.example", "cmdadded.example"], blockPrivateNetworks: false, bogusKey: 1 } });
	setTestProvider({
		id: "fake",
		search: async () => [{ title: "Allowed Doc", url: `http://127.0.0.1:${port}/doc`, snippet: "allowed snippet" }],
	});
	const notificationsBefore = notifications.length;

	await tools.web_search.execute("tc50", { query: "test query" }, signal, undefined, mockContext);
	const firstSearchNotifications = notifications.slice(notificationsBefore);

	assert.equal(firstSearchNotifications.length, 1, "exactly one notification on the first call");
	assert.ok(firstSearchNotifications[0].startsWith("warning:"), "the config warning is a warning notification");
	assert.ok(firstSearchNotifications[0].includes("unknown webSearch key"), "the warning names the unknown-key problem");
	assert.ok(firstSearchNotifications[0].includes("bogusKey"), "the warning lists the unknown key");

	const notificationsBeforeSecond = notifications.length;

	await tools.web_search.execute("tc51", { query: "test query" }, signal, undefined, mockContext);
	const secondSearchNotifications = notifications.slice(notificationsBeforeSecond);

	assert.equal(secondSearchNotifications.length, 0, "the one-shot flag suppresses the repeat in the same session");
	setTestProvider(undefined);
});

await test("should re-surface config warnings when a fresh session starts after session_shutdown", async () => {
	// The settings file from the previous test still carries the unknown key,
	// and the one-shot flag was set in that session.
	setTestProvider({
		id: "fake",
		search: async () => [{ title: "Allowed Doc", url: `http://127.0.0.1:${port}/doc`, snippet: "allowed snippet" }],
	});

	for (const handler of sessionEventHandlers["session_shutdown"]) handler();

	const notificationsBefore = notifications.length;
	await tools.web_search.execute("tc52", { query: "test query" }, signal, undefined, mockContext);
	const freshSessionNotifications = notifications.slice(notificationsBefore);

	assert.equal(freshSessionNotifications.length, 1, "the config warning re-surfaces in a fresh session");
	assert.ok(freshSessionNotifications[0].startsWith("warning:"), "the re-surfaced warning is a warning notification");
	assert.ok(freshSessionNotifications[0].includes("unknown webSearch key"), "the re-surfaced warning names the unknown-key problem");
	setTestProvider(undefined);
});

server.close();
process.env.HOME = savedHome;
fs.rmSync(root, { recursive: true, force: true });
finish();
