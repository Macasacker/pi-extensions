// Config loading: precedence, trust gating, validation, settings mutation.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, finish } from "./harness.mjs";
import { loadConfig, BUILTIN_DEFAULTS, sanitizeDomainEntry, updateSettingsDomains } from "../src/config.ts";

function makeEnv() {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "websearch-cfg-"));
	const home = path.join(root, "home");
	const cwd = path.join(root, "project");
	fs.mkdirSync(path.join(home, ".pi", "agent"), { recursive: true });
	fs.mkdirSync(path.join(cwd, ".pi"), { recursive: true });
	return {
		root,
		home,
		cwd,
		writeGlobal: (obj) => fs.writeFileSync(path.join(home, ".pi", "agent", "settings.json"), JSON.stringify(obj)),
		writeProject: (obj) => fs.writeFileSync(path.join(cwd, ".pi", "settings.json"), JSON.stringify(obj)),
		readGlobal: () => JSON.parse(fs.readFileSync(path.join(home, ".pi", "agent", "settings.json"), "utf8")),
		readProject: () => JSON.parse(fs.readFileSync(path.join(cwd, ".pi", "settings.json"), "utf8")),
		cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
	};
}

await test("built-in defaults only when no settings exist", () => {
	const env = makeEnv();
	try {
		const { config, domainSources } = loadConfig(env.cwd, true, env.home);
		assert.deepEqual(config.allowedDomains, BUILTIN_DEFAULTS.allowedDomains);
		assert.equal(config.provider, "duckduckgo");
		assert.equal(config.enabled, true);
		assert.equal(domainSources.length, 1);
		assert.equal(domainSources[0].path, "(built-in)");
	} finally {
		env.cleanup();
	}
});

await test("global settings extend the allowlist (union, not replace)", () => {
	const env = makeEnv();
	try {
		env.writeGlobal({ webSearch: { allowedDomains: ["internal.docs.io"] }, otherKey: 42 });
		const { config, domainSources } = loadConfig(env.cwd, true, env.home);
		assert.ok(config.allowedDomains.includes("internal.docs.io"));
		assert.ok(config.allowedDomains.includes("github.com"), "built-ins preserved");
		assert.equal(domainSources.length, 2);
	} finally {
		env.cleanup();
	}
});

await test("project settings honored only when trusted", () => {
	const env = makeEnv();
	try {
		env.writeProject({ webSearch: { allowedDomains: ["proj.example"] } });
		const trusted = loadConfig(env.cwd, true, env.home);
		assert.ok(trusted.config.allowedDomains.includes("proj.example"));
		const untrusted = loadConfig(env.cwd, false, env.home);
		assert.ok(!untrusted.config.allowedDomains.includes("proj.example"));
		assert.ok(!untrusted.domainSources.some((s) => s.path.includes("settings.json") && s.path.startsWith(env.cwd)));
	} finally {
		env.cleanup();
	}
});

await test("useBuiltins: false drops built-in domains, keeps user domains", () => {
	const env = makeEnv();
	try {
		env.writeGlobal({ webSearch: { useBuiltins: false, allowedDomains: ["only.this"] } });
		const { config } = loadConfig(env.cwd, true, env.home);
		assert.ok(!config.allowedDomains.includes("github.com"));
		assert.deepEqual(config.allowedDomains, ["only.this"]);
	} finally {
		env.cleanup();
	}
});

await test("numeric settings are clamped, bad types fall back", () => {
	const env = makeEnv();
	try {
		env.writeGlobal({
			webSearch: {
				maxResults: 999,
				timeoutMs: 100,
				maxRedirects: "lots",
				enabled: "yes",
				provider: "bing",
			},
		});
		const { config } = loadConfig(env.cwd, true, env.home);
		assert.equal(config.maxResults, 20); // clamped to max
		assert.equal(config.timeoutMs, 1000); // clamped to min
		assert.equal(config.maxRedirects, BUILTIN_DEFAULTS.maxRedirects); // bad type → fallback
		assert.equal(config.enabled, true); // bad type → fallback (default true)
		assert.equal(config.provider, "duckduckgo"); // unknown provider ignored
	} finally {
		env.cleanup();
	}
});

await test("malformed settings file is treated as absent", () => {
	const env = makeEnv();
	try {
		fs.writeFileSync(path.join(env.home, ".pi", "agent", "settings.json"), "{not json");
		const { config } = loadConfig(env.cwd, true, env.home);
		assert.deepEqual(config.allowedDomains, BUILTIN_DEFAULTS.allowedDomains);
	} finally {
		env.cleanup();
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
	const env = makeEnv();
	try {
		env.writeGlobal({ webSearch: { allowedDomains: ["WWW.Example.COM", "example.com", "docs.python.org"] } });
		const { config } = loadConfig(env.cwd, true, env.home);
		const lower = config.allowedDomains.map((d) => d.toLowerCase());
		assert.equal(lower.filter((d) => d === "example.com").length, 1);
		assert.equal(lower.filter((d) => d === "docs.python.org").length, 1);
	} finally {
		env.cleanup();
	}
});

await test("updateSettingsDomains adds/removes and preserves other keys", () => {
	const env = makeEnv();
	try {
		const file = path.join(env.home, ".pi", "agent", "settings.json");
		fs.writeFileSync(file, JSON.stringify({ webSearch: { allowedDomains: ["a.io"] }, theme: "dark" }));
		updateSettingsDomains(file, ["b.io"], (list) => [...list, "b.io"]);
		let s = env.readGlobal();
		assert.deepEqual(s.webSearch.allowedDomains, ["a.io", "b.io"]);
		assert.equal(s.theme, "dark");
		updateSettingsDomains(file, ["a.io"], (list) => list.filter((d) => d !== "a.io"));
		s = env.readGlobal();
		assert.deepEqual(s.webSearch.allowedDomains, ["b.io"]);
		assert.equal(s.theme, "dark");
	} finally {
		env.cleanup();
	}
});

finish();
