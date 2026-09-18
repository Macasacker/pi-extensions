// Config loading: precedence, trust gating, validation, settings mutation.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, finish } from "./harness.mjs";
import { loadConfig, BUILTIN_DEFAULTS, sanitizeDomainEntry, updateSettingsDomains } from "../src/config.ts";

function makeEnvironment() {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "websearch-cfg-"));
	const home = path.join(tempDir, "home");
	const cwd = path.join(tempDir, "project");
	fs.mkdirSync(path.join(home, ".pi", "agent"), { recursive: true });
	fs.mkdirSync(path.join(cwd, ".pi"), { recursive: true });
	return {
		tempDir,
		home,
		cwd,
		writeGlobal: (settings) => fs.writeFileSync(path.join(home, ".pi", "agent", "settings.json"), JSON.stringify(settings)),
		writeProject: (settings) => fs.writeFileSync(path.join(cwd, ".pi", "settings.json"), JSON.stringify(settings)),
		readGlobal: () => JSON.parse(fs.readFileSync(path.join(home, ".pi", "agent", "settings.json"), "utf8")),
		readProject: () => JSON.parse(fs.readFileSync(path.join(cwd, ".pi", "settings.json"), "utf8")),
		cleanup: () => fs.rmSync(tempDir, { recursive: true, force: true }),
	};
}

await test("built-in defaults only when no settings exist", () => {
	const environment = makeEnvironment();
	try {
		const { config, domainSources } = loadConfig({ cwd: environment.cwd, projectTrusted: true, homeDir: environment.home });
		assert.deepEqual(config.allowedDomains, BUILTIN_DEFAULTS.allowedDomains);
		assert.equal(config.provider, "duckduckgo");
		assert.equal(config.enabled, true);
		assert.equal(domainSources.length, 1);
		assert.equal(domainSources[0].path, "(built-in)");
	} finally {
		environment.cleanup();
	}
});

await test("global settings extend the allowlist (union, not replace)", () => {
	const environment = makeEnvironment();
	try {
		environment.writeGlobal({ webSearch: { allowedDomains: ["internal.docs.io"] }, otherKey: 42 });
		const { config, domainSources } = loadConfig({ cwd: environment.cwd, projectTrusted: true, homeDir: environment.home });
		assert.ok(config.allowedDomains.includes("internal.docs.io"));
		assert.ok(config.allowedDomains.includes("github.com"), "built-ins preserved");
		assert.equal(domainSources.length, 2);
	} finally {
		environment.cleanup();
	}
});

await test("project settings honored only when trusted", () => {
	const environment = makeEnvironment();
	try {
		environment.writeProject({ webSearch: { allowedDomains: ["proj.example"] } });
		const trustedConfig = loadConfig({ cwd: environment.cwd, projectTrusted: true, homeDir: environment.home });
		assert.ok(trustedConfig.config.allowedDomains.includes("proj.example"));
		const untrustedConfig = loadConfig({ cwd: environment.cwd, projectTrusted: false, homeDir: environment.home });
		assert.ok(!untrustedConfig.config.allowedDomains.includes("proj.example"));
		assert.ok(!untrustedConfig.domainSources.some((domainSource) => domainSource.path.includes("settings.json") && domainSource.path.startsWith(environment.cwd)));
	} finally {
		environment.cleanup();
	}
});

await test("useBuiltins: false drops built-in domains, keeps user domains", () => {
	const environment = makeEnvironment();
	try {
		environment.writeGlobal({ webSearch: { useBuiltins: false, allowedDomains: ["only.this"] } });
		const { config } = loadConfig({ cwd: environment.cwd, projectTrusted: true, homeDir: environment.home });
		assert.ok(!config.allowedDomains.includes("github.com"));
		assert.deepEqual(config.allowedDomains, ["only.this"]);
	} finally {
		environment.cleanup();
	}
});

await test("numeric settings are clamped, bad types fall back", () => {
	const environment = makeEnvironment();
	try {
		environment.writeGlobal({
			webSearch: {
				maxResults: 999,
				timeoutMs: 100,
				maxRedirects: "lots",
				enabled: "yes",
				provider: "bing",
			},
		});
		const { config } = loadConfig({ cwd: environment.cwd, projectTrusted: true, homeDir: environment.home });
		assert.equal(config.maxResults, 20); // clamped to max
		assert.equal(config.timeoutMs, 1000); // clamped to min
		assert.equal(config.maxRedirects, BUILTIN_DEFAULTS.maxRedirects); // bad type → fallback
		assert.equal(config.enabled, true); // bad type → fallback (default true)
		assert.equal(config.provider, "duckduckgo"); // unknown provider ignored
	} finally {
		environment.cleanup();
	}
});

await test("malformed settings file is treated as absent", () => {
	const environment = makeEnvironment();
	try {
		fs.writeFileSync(path.join(environment.home, ".pi", "agent", "settings.json"), "{not json");
		const { config } = loadConfig({ cwd: environment.cwd, projectTrusted: true, homeDir: environment.home });
		assert.deepEqual(config.allowedDomains, BUILTIN_DEFAULTS.allowedDomains);
	} finally {
		environment.cleanup();
	}
});

await test("should warn when the global settings file is malformed JSON", () => {
	const environment = makeEnvironment();
	const globalSettingsFile = path.join(environment.home, ".pi", "agent", "settings.json");
	try {
		fs.writeFileSync(globalSettingsFile, "{not json");

		const { config, configWarnings } = loadConfig({ cwd: environment.cwd, projectTrusted: true, homeDir: environment.home });

		assert.equal(configWarnings.length, 1);
		assert.ok(configWarnings[0].includes(globalSettingsFile), "warning names the file");
		assert.ok(configWarnings[0].includes("webSearch"), "warning mentions the webSearch settings");
		assert.deepEqual(config.allowedDomains, BUILTIN_DEFAULTS.allowedDomains);
	} finally {
		environment.cleanup();
	}
});

await test("should warn when the webSearch key is not an object", () => {
	const environment = makeEnvironment();
	const globalSettingsFile = path.join(environment.home, ".pi", "agent", "settings.json");
	try {
		environment.writeGlobal({ webSearch: "duckduckgo" });

		const { config, configWarnings } = loadConfig({ cwd: environment.cwd, projectTrusted: true, homeDir: environment.home });

		assert.equal(configWarnings.length, 1);
		assert.ok(configWarnings[0].includes(globalSettingsFile), "warning names the file");
		assert.ok(configWarnings[0].includes("webSearch"), "warning mentions the webSearch key");
		assert.deepEqual(config.allowedDomains, BUILTIN_DEFAULTS.allowedDomains);
	} finally {
		environment.cleanup();
	}
});

await test("should warn listing every unknown key when the webSearch section has unrecognized keys", () => {
	const environment = makeEnvironment();
	const globalSettingsFile = path.join(environment.home, ".pi", "agent", "settings.json");
	try {
		environment.writeGlobal({ webSearch: { maxResults: 5, bogusKey: 1, alsoBogus: 2 } });

		const { config, configWarnings } = loadConfig({ cwd: environment.cwd, projectTrusted: true, homeDir: environment.home });

		assert.equal(configWarnings.length, 1);
		assert.ok(configWarnings[0].includes(globalSettingsFile), "warning names the file");
		assert.ok(configWarnings[0].includes("bogusKey"), "warning lists the first unknown key");
		assert.ok(configWarnings[0].includes("alsoBogus"), "warning lists the second unknown key");
		assert.equal(config.maxResults, 5, "known keys are still applied");
	} finally {
		environment.cleanup();
	}
});

await test("should not warn when the settings file contains only known webSearch keys", () => {
	const environment = makeEnvironment();
	try {
		environment.writeGlobal({ webSearch: { maxResults: 5, allowedDomains: ["known.example"] }, otherKey: 42 });

		const { configWarnings } = loadConfig({ cwd: environment.cwd, projectTrusted: true, homeDir: environment.home });

		assert.deepEqual(configWarnings, []);
	} finally {
		environment.cleanup();
	}
});

await test("should not warn when no settings files exist", () => {
	const environment = makeEnvironment();
	try {
		const { configWarnings } = loadConfig({ cwd: environment.cwd, projectTrusted: true, homeDir: environment.home });

		assert.deepEqual(configWarnings, []);
	} finally {
		environment.cleanup();
	}
});

await test("should accumulate a warning per file when both the global and project settings files are problematic", () => {
	const environment = makeEnvironment();
	const globalSettingsFile = path.join(environment.home, ".pi", "agent", "settings.json");
	const projectSettingsFile = path.join(environment.cwd, ".pi", "settings.json");
	try {
		fs.writeFileSync(globalSettingsFile, "{not json");
		environment.writeProject({ webSearch: 42 });

		const { configWarnings } = loadConfig({ cwd: environment.cwd, projectTrusted: true, homeDir: environment.home });

		assert.equal(configWarnings.length, 2);
		assert.ok(configWarnings[0].includes(globalSettingsFile), "first warning names the global file");
		assert.ok(configWarnings[1].includes(projectSettingsFile), "second warning names the project file");
	} finally {
		environment.cleanup();
	}
});

await test("sanitizeDomainEntry strips scheme/path and normalizes", () => {
	assert.equal(sanitizeDomainEntry("https://docs.python.org/guide/"), "docs.python.org");
	assert.equal(sanitizeDomainEntry("  Example.COM "), "example.com");
	assert.equal(sanitizeDomainEntry("http://sub.example.com:8080/x?q=1"), "sub.example.com");
	assert.equal(sanitizeDomainEntry("not a domain"), "");
	assert.equal(sanitizeDomainEntry(42), "");
	assert.equal(sanitizeDomainEntry(""), "");
});

await test("sanitizeDomainEntry handles IPv6 entries without mangling", () => {
	assert.equal(sanitizeDomainEntry("[::1]"), "::1");
	assert.equal(sanitizeDomainEntry("::1"), "::1");
	assert.equal(sanitizeDomainEntry("[::ffff:7f00:1]"), "::ffff:7f00:1");
	assert.equal(sanitizeDomainEntry("::ffff:7f00:1"), "::ffff:7f00:1");
});

await test("duplicate/aliased domains are not double-added", () => {
	const environment = makeEnvironment();
	try {
		environment.writeGlobal({ webSearch: { allowedDomains: ["WWW.Example.COM", "example.com", "docs.python.org"] } });
		const { config } = loadConfig({ cwd: environment.cwd, projectTrusted: true, homeDir: environment.home });
		const lowercasedDomains = config.allowedDomains.map((domain) => domain.toLowerCase());
		assert.equal(lowercasedDomains.filter((domain) => domain === "example.com").length, 1);
		assert.equal(lowercasedDomains.filter((domain) => domain === "docs.python.org").length, 1);
	} finally {
		environment.cleanup();
	}
});

await test("updateSettingsDomains adds/removes and preserves other keys", () => {
	const environment = makeEnvironment();
	try {
		const settingsFile = path.join(environment.home, ".pi", "agent", "settings.json");
		fs.writeFileSync(settingsFile, JSON.stringify({ webSearch: { allowedDomains: ["a.io"] }, theme: "dark" }));
		updateSettingsDomains(settingsFile, (allowedDomains) => [...allowedDomains, "b.io"]);
		let globalSettings = environment.readGlobal();
		assert.deepEqual(globalSettings.webSearch.allowedDomains, ["a.io", "b.io"]);
		assert.equal(globalSettings.theme, "dark");
		updateSettingsDomains(settingsFile, (allowedDomains) => allowedDomains.filter((domain) => domain !== "a.io"));
		globalSettings = environment.readGlobal();
		assert.deepEqual(globalSettings.webSearch.allowedDomains, ["b.io"]);
		assert.equal(globalSettings.theme, "dark");
	} finally {
		environment.cleanup();
	}
});

finish();
