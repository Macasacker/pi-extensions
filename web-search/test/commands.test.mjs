// Command modules: /web-search-domains (parse, apply, list summary) and
// /web-search-status (report). Pins the frozen user-facing strings and the
// parse/validation behavior of src/commands/domains.ts and
// src/commands/status.ts — the branches the e2e suite cannot reach because
// its mock hard-codes isProjectTrusted: () => true.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, finish } from "./harness.mjs";
import { BUILTIN_DEFAULTS } from "../src/config.ts";
import { parseDomainCommandArgs, applyDomainChange, buildDomainListSummary } from "../src/commands/domains.ts";
import { buildStatusReport } from "../src/commands/status.ts";
import { createSessionState } from "../src/session.ts";

// --- shared fixtures ---------------------------------------------------------

function makeEnvironment() {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "websearch-cmd-"));
	const home = path.join(tempDir, "home");
	const cwd = path.join(tempDir, "project");
	fs.mkdirSync(path.join(home, ".pi", "agent"), { recursive: true });
	fs.mkdirSync(path.join(cwd, ".pi"), { recursive: true });
	return {
		tempDir,
		home,
		cwd,
		writeGlobalSettings: (settings) => fs.writeFileSync(path.join(home, ".pi", "agent", "settings.json"), JSON.stringify(settings)),
		writeProjectSettings: (settings) => fs.writeFileSync(path.join(cwd, ".pi", "settings.json"), JSON.stringify(settings)),
		readGlobalSettings: () => JSON.parse(fs.readFileSync(path.join(home, ".pi", "agent", "settings.json"), "utf8")),
		readProjectSettings: () => JSON.parse(fs.readFileSync(path.join(cwd, ".pi", "settings.json"), "utf8")),
		cleanup: () => fs.rmSync(tempDir, { recursive: true, force: true }),
	};
}

/**
 * Runs `body` with process.env.HOME pointed at a fresh temp home.
 * globalSettingsPath() — and the drift-baseline refresh inside
 * applyDomainChange, which calls loadConfig() without a homeDir override —
 * resolve the global settings through os.homedir(), which honors $HOME on
 * Linux. The original HOME is restored in `finally` so the temp home never
 * leaks into the other test files: run.mjs imports every file into one Node
 * process, and e2e.test.mjs snapshots HOME at module scope.
 */
async function withTempHome(body) {
	const environment = makeEnvironment();
	const savedHome = process.env.HOME;
	process.env.HOME = environment.home;
	try {
		await body(environment);
	} finally {
		process.env.HOME = savedHome;
		environment.cleanup();
	}
}

function makeContext(environment, { projectTrusted, notifications }) {
	return {
		cwd: environment.cwd,
		isProjectTrusted: () => projectTrusted,
		ui: {
			notify: (message, kind) => notifications.push({ message, kind }),
		},
	};
}

// --- parseDomainCommandArgs ---------------------------------------------------

await test("should return the list command when the token list is empty", () => {
	assert.deepEqual(parseDomainCommandArgs([]), { action: "list", projectScope: false });
});

await test("should return the list command when the only token is whitespace", () => {
	assert.deepEqual(parseDomainCommandArgs([" "]), { action: "list", projectScope: false });
});

await test("should return the list command when the action word is unknown", () => {
	assert.deepEqual(parseDomainCommandArgs(["frobnicate", "x.example"]), { action: "list", projectScope: false });
});

await test("should return the list command when the action word has no domain token", () => {
	assert.deepEqual(parseDomainCommandArgs(["add"]), { action: "list", projectScope: false });
});

await test("should return the add change command when a single domain token follows add", () => {
	assert.deepEqual(parseDomainCommandArgs(["add", "x.example"]), { action: "add", domainTokens: ["x.example"], projectScope: false });
});

await test("should return the remove change command when a single domain token follows remove", () => {
	assert.deepEqual(parseDomainCommandArgs(["remove", "x.example"]), { action: "remove", domainTokens: ["x.example"], projectScope: false });
});

await test("should set the project scope when --project precedes the action word", () => {
	// A leading flag is consumed as the (unknown) action word, so the command
	// degrades to the list view even though the project scope is recorded.
	assert.deepEqual(parseDomainCommandArgs(["--project", "add", "x.example"]), { action: "list", projectScope: true });
});

await test("should set the project scope when --project follows the domain token", () => {
	assert.deepEqual(parseDomainCommandArgs(["add", "x.example", "--project"]), { action: "add", domainTokens: ["x.example"], projectScope: true });
});

await test("should set the project scope when --project sits between the action word and the domain token", () => {
	assert.deepEqual(parseDomainCommandArgs(["add", "--project", "x.example"]), { action: "add", domainTokens: ["x.example"], projectScope: true });
});

await test("should keep every non-flag token after the action word as a domain token when several domains are given", () => {
	assert.deepEqual(parseDomainCommandArgs(["add", "a.example", "b.example"]), { action: "add", domainTokens: ["a.example", "b.example"], projectScope: false });
});

await test("should ignore unknown flags when collecting the domain tokens", () => {
	assert.deepEqual(parseDomainCommandArgs(["add", "x.example", "--bogus"]), { action: "add", domainTokens: ["x.example"], projectScope: false });
});

// --- applyDomainChange ---------------------------------------------------------

await test("should add the domain to the global settings and notify the user when the global-scope add succeeds", () =>
	withTempHome((environment) => {
		const notifications = [];
		const context = makeContext(environment, { projectTrusted: true, notifications });
		const session = createSessionState();
		const command = { action: "add", domainTokens: ["example.com"], projectScope: false };

		applyDomainChange(command, { ctx: context, session });

		assert.deepEqual(notifications, [{ message: "Added example.com to global allowlist — effective immediately", kind: "info" }]);
		assert.deepEqual(environment.readGlobalSettings().webSearch.allowedDomains, ["example.com"]);
	}));

await test("should keep exactly one entry when the same domain is added twice in global scope", () =>
	withTempHome((environment) => {
		const notifications = [];
		const context = makeContext(environment, { projectTrusted: true, notifications });
		const session = createSessionState();
		const command = { action: "add", domainTokens: ["example.com"], projectScope: false };

		applyDomainChange(command, { ctx: context, session });
		applyDomainChange(command, { ctx: context, session });

		const globalSettings = environment.readGlobalSettings();
		assert.equal(globalSettings.webSearch.allowedDomains.filter((domain) => domain === "example.com").length, 1, "duplicate add is a no-op");
		assert.equal(notifications.length, 2, "both adds notify");
	}));

await test("should remove the domain from the global settings, preserve the other keys, and notify the user when the global-scope remove succeeds", () =>
	withTempHome((environment) => {
		environment.writeGlobalSettings({ webSearch: { allowedDomains: ["example.com", "keep.example"] }, theme: "dark" });
		const notifications = [];
		const context = makeContext(environment, { projectTrusted: true, notifications });
		const session = createSessionState();
		const command = { action: "remove", domainTokens: ["example.com"], projectScope: false };

		applyDomainChange(command, { ctx: context, session });

		assert.deepEqual(notifications, [{ message: "Removed example.com from global allowlist — effective immediately", kind: "info" }]);
		const globalSettings = environment.readGlobalSettings();
		assert.deepEqual(globalSettings.webSearch.allowedDomains, ["keep.example"]);
		assert.equal(globalSettings.theme, "dark", "keys outside webSearch are preserved");
	}));

await test("should reject a multi-token add with the exact usage hint and leave the settings file untouched", () =>
	withTempHome((environment) => {
		const originalGlobalSettings = { webSearch: { allowedDomains: ["keep.example"] } };
		environment.writeGlobalSettings(originalGlobalSettings);
		const notifications = [];
		const context = makeContext(environment, { projectTrusted: true, notifications });
		const session = createSessionState();
		const command = { action: "add", domainTokens: ["a.example", "b.example"], projectScope: false };

		applyDomainChange(command, { ctx: context, session });

		assert.deepEqual(notifications, [{ message: "Domains can't contain spaces. Did you mean: /web-search-domains add a.example?", kind: "error" }]);
		assert.deepEqual(environment.readGlobalSettings(), originalGlobalSettings, "settings file untouched");
		assert.equal(session.lastAllowlist, null, "a failed command must not refresh the drift baseline");
	}));

await test("should reject a multi-token remove with the exact usage hint and leave the settings file untouched", () =>
	withTempHome((environment) => {
		const originalGlobalSettings = { webSearch: { allowedDomains: ["keep.example"] } };
		environment.writeGlobalSettings(originalGlobalSettings);
		const notifications = [];
		const context = makeContext(environment, { projectTrusted: true, notifications });
		const session = createSessionState();
		const command = { action: "remove", domainTokens: ["a.example", "b.example"], projectScope: false };

		applyDomainChange(command, { ctx: context, session });

		assert.deepEqual(notifications, [{ message: "Domains can't contain spaces. Did you mean: /web-search-domains remove a.example?", kind: "error" }]);
		assert.deepEqual(environment.readGlobalSettings(), originalGlobalSettings, "settings file untouched");
		assert.equal(session.lastAllowlist, null, "a failed command must not refresh the drift baseline");
	}));

await test("should reject an invalid domain with the exact error and leave the settings file untouched", () =>
	withTempHome((environment) => {
		const originalGlobalSettings = { webSearch: { allowedDomains: ["keep.example"] } };
		environment.writeGlobalSettings(originalGlobalSettings);
		const notifications = [];
		const context = makeContext(environment, { projectTrusted: true, notifications });
		const session = createSessionState();
		// A bare port: sanitizeDomainEntry strips the ":8080" suffix and is left with nothing.
		const invalidDomainToken = ":8080";
		const command = { action: "add", domainTokens: [invalidDomainToken], projectScope: false };

		applyDomainChange(command, { ctx: context, session });

		assert.deepEqual(notifications, [{ message: `Invalid domain: ${invalidDomainToken}`, kind: "error" }]);
		assert.deepEqual(environment.readGlobalSettings(), originalGlobalSettings, "settings file untouched");
		assert.equal(session.lastAllowlist, null, "a failed command must not refresh the drift baseline");
	}));

await test("should refuse a project-scope add on an untrusted project with the exact error and leave the project settings untouched", () =>
	withTempHome((environment) => {
		const originalProjectSettings = { webSearch: { allowedDomains: ["proj.example"] } };
		environment.writeProjectSettings(originalProjectSettings);
		const notifications = [];
		const context = makeContext(environment, { projectTrusted: false, notifications });
		const session = createSessionState();
		const command = { action: "add", domainTokens: ["example.com"], projectScope: true };

		applyDomainChange(command, { ctx: context, session });

		assert.deepEqual(notifications, [{ message: "Project is not trusted; cannot modify project settings. Use global scope (omit --project).", kind: "error" }]);
		assert.deepEqual(environment.readProjectSettings(), originalProjectSettings, "project settings untouched");
	}));

await test("should refuse a project-scope remove on an untrusted project with the suffix-free error, unlike the add message", () =>
	withTempHome((environment) => {
		const originalProjectSettings = { webSearch: { allowedDomains: ["proj.example"] } };
		environment.writeProjectSettings(originalProjectSettings);
		const notifications = [];
		const context = makeContext(environment, { projectTrusted: false, notifications });
		const session = createSessionState();
		const command = { action: "remove", domainTokens: ["example.com"], projectScope: true };

		applyDomainChange(command, { ctx: context, session });

		const removeMessage = "Project is not trusted; cannot modify project settings.";
		const addMessage = "Project is not trusted; cannot modify project settings. Use global scope (omit --project).";
		assert.notEqual(removeMessage, addMessage, "the frozen messages are deliberately asymmetric");
		assert.deepEqual(notifications, [{ message: removeMessage, kind: "error" }]);
		assert.deepEqual(environment.readProjectSettings(), originalProjectSettings, "project settings untouched");
	}));

await test("should write the change to the project settings, not the global settings, when the project is trusted", () =>
	withTempHome((environment) => {
		environment.writeGlobalSettings({ webSearch: { allowedDomains: ["global.example"] } });
		environment.writeProjectSettings({ webSearch: { allowedDomains: ["proj.example"] } });
		const notifications = [];
		const context = makeContext(environment, { projectTrusted: true, notifications });
		const session = createSessionState();
		const command = { action: "add", domainTokens: ["example.com"], projectScope: true };

		applyDomainChange(command, { ctx: context, session });

		assert.deepEqual(notifications, [{ message: "Added example.com to project allowlist — effective immediately", kind: "info" }]);
		assert.deepEqual(environment.readProjectSettings().webSearch.allowedDomains, ["proj.example", "example.com"]);
		assert.deepEqual(environment.readGlobalSettings().webSearch.allowedDomains, ["global.example"], "global settings untouched");
	}));

await test("should refresh the session drift baseline to the new sorted allowlist when the command succeeds", () =>
	withTempHome((environment) => {
		const notifications = [];
		const context = makeContext(environment, { projectTrusted: true, notifications });
		const session = createSessionState();
		const command = { action: "add", domainTokens: ["example.com"], projectScope: false };

		applyDomainChange(command, { ctx: context, session });

		assert.deepEqual(session.lastAllowlist, [...BUILTIN_DEFAULTS.allowedDomains, "example.com"].sort());
	}));

// --- buildDomainListSummary ------------------------------------------------------

function makeLoadedConfig(configOverrides, domainSources) {
	return {
		config: { ...BUILTIN_DEFAULTS, ...configOverrides },
		domainSources,
	};
}

await test("should label the built-in source and list the per-source domains in the exact format when the allowlist has multiple sources", () => {
	const loadedConfig = makeLoadedConfig(
		{},
		[
			{ path: "(built-in)", domains: ["example.com", "docs.example"] },
			{ path: "/home/user/.pi/agent/settings.json", domains: ["internal.example"] },
		],
	);

	const summary = buildDomainListSummary(loadedConfig);

	assert.equal(
		summary,
		[
			"web-search allowed domains:",
			"  built-in defaults:",
			"    example.com",
			"    docs.example",
			"  /home/user/.pi/agent/settings.json:",
			"    internal.example",
			"",
			"options: subdomains=true confirmOutsideAllowlist=false privateNetworks=blocked provider=duckduckgo",
			"",
			"usage: /web-search-domains add <domain> [--project] | remove <domain> [--project]",
		].join("\n"),
	);
});

await test("should show the blocked-everything note and the remaining option spellings when there are no domain sources", () => {
	const loadedConfig = makeLoadedConfig(
		{ useBuiltins: false, allowSubdomains: false, confirmOutsideAllowlist: true, blockPrivateNetworks: false, provider: "brave" },
		[],
	);

	const summary = buildDomainListSummary(loadedConfig);

	assert.equal(
		summary,
		[
			"web-search allowed domains:",
			"  (none — every fetch will be blocked)",
			"",
			"options: subdomains=false confirmOutsideAllowlist=true privateNetworks=allowed provider=brave",
			"",
			"usage: /web-search-domains add <domain> [--project] | remove <domain> [--project]",
		].join("\n"),
	);
});

// --- buildStatusReport -------------------------------------------------------------

const EIGHT_ALLOWLISTED_DOMAINS = [
	"alpha.example",
	"bravo.example",
	"charlie.example",
	"delta.example",
	"echo.example",
	"foxtrot.example",
	"golf.example",
	"hotel.example",
];

function makeStatusConfig(configOverrides) {
	return {
		...BUILTIN_DEFAULTS,
		provider: "duckduckgo",
		braveApiKey: "",
		allowedDomains: [...EIGHT_ALLOWLISTED_DOMAINS],
		...configOverrides,
	};
}

await test("should report the exact enabled/duckduckgo status with the full 8-domain preview when the session is empty", () => {
	const config = makeStatusConfig({});
	const session = createSessionState();

	const report = buildStatusReport(config, session);

	assert.equal(
		report,
		[
			"web-search: enabled",
			"provider: duckduckgo",
			`allowlist: 8 domain(s) [${EIGHT_ALLOWLISTED_DOMAINS.join(", ")}]`,
			"limits: 8 results, 20000 chars, 2048KB, 15s timeout, 5 redirects",
			"session: 0 call(s), 0 granted host(s)",
		].join("\n"),
	);
});

await test("should append the key-set suffix to the provider line when brave has a resolvable API key", () => {
	// A literal key (no "$" prefix) is returned as-is by expandEnvRef.
	const config = makeStatusConfig({ provider: "brave", braveApiKey: "literal-api-key" });
	const session = createSessionState();

	const report = buildStatusReport(config, session);

	assert.equal(
		report,
		[
			"web-search: enabled",
			"provider: brave (key set)",
			`allowlist: 8 domain(s) [${EIGHT_ALLOWLISTED_DOMAINS.join(", ")}]`,
			"limits: 8 results, 20000 chars, 2048KB, 15s timeout, 5 redirects",
			"session: 0 call(s), 0 granted host(s)",
		].join("\n"),
	);
});

await test("should append the no-key fallback suffix to the provider line when brave has no API key", () => {
	const config = makeStatusConfig({ provider: "brave", braveApiKey: "" });
	const session = createSessionState();

	const report = buildStatusReport(config, session);

	assert.equal(
		report,
		[
			"web-search: enabled",
			"provider: brave (NO KEY — falling back to duckduckgo)",
			`allowlist: 8 domain(s) [${EIGHT_ALLOWLISTED_DOMAINS.join(", ")}]`,
			"limits: 8 results, 20000 chars, 2048KB, 15s timeout, 5 redirects",
			"session: 0 call(s), 0 granted host(s)",
		].join("\n"),
	);
});

await test("should show the first 8 domains plus the overflow marker when the allowlist has more than 8 domains", () => {
	const config = makeStatusConfig({ allowedDomains: [...EIGHT_ALLOWLISTED_DOMAINS, "india.example"] });
	const session = createSessionState();

	const report = buildStatusReport(config, session);

	const allowlistLine = report.split("\n")[2];
	assert.equal(allowlistLine, `allowlist: 9 domain(s) [${EIGHT_ALLOWLISTED_DOMAINS.join(", ")}, …]`);
});

await test("should convert bytes to KB and milliseconds to seconds in the limits line", () => {
	const config = makeStatusConfig({ maxResults: 5, maxContentChars: 5000, maxDownloadBytes: 1536, timeoutMs: 12500, maxRedirects: 3 });
	const session = createSessionState();

	const report = buildStatusReport(config, session);

	const limitsLine = report.split("\n")[3];
	assert.equal(limitsLine, "limits: 5 results, 5000 chars, 2KB, 12.5s timeout, 3 redirects");
});

await test("should list the call count and the granted hosts in the session line when the session has usage", () => {
	const config = makeStatusConfig({});
	const session = createSessionState();
	session.callCount = 2;
	session.grants.add("example.com");

	const report = buildStatusReport(config, session);

	assert.ok(report.endsWith("session: 2 call(s), 1 granted host(s) (example.com)"));
});

await test("should report the disabled state in the first line when webSearch.enabled is false", () => {
	const config = makeStatusConfig({ enabled: false });
	const session = createSessionState();

	const report = buildStatusReport(config, session);

	assert.equal(report.split("\n")[0], "web-search: DISABLED");
});

finish();
