/**
 * web-search configuration: built-in defaults, global settings, project
 * settings (only when the project is trusted), merged and validated.
 *
 * Precedence (later wins per key):
 *   1. BUILTIN_DEFAULTS
 *   2. ~/.pi/agent/settings.json  -> webSearch
 *   3. <cwd>/.pi/settings.json    -> webSearch   (only if projectTrusted)
 *
 * `allowedDomains` is UNIONED across sources so a project can add domains
 * without clobbering the global list. `useBuiltins: false` in user settings
 * disables the built-in default list.
 */

import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

export interface WebSearchConfig {
	enabled: boolean;
	provider: "duckduckgo" | "brave";
	braveApiKey: string;
	allowedDomains: string[];
	useBuiltins: boolean;
	allowSubdomains: boolean;
	confirmOutsideAllowlist: boolean;
	maxResults: number;
	maxContentChars: number;
	maxDownloadBytes: number;
	timeoutMs: number;
	maxRedirects: number;
	blockPrivateNetworks: boolean;
}

export interface DomainSource {
	path: string;
	domains: string[];
}

export interface LoadedConfig {
	config: WebSearchConfig;
	/** Where each batch of allowed domains came from (for /web-search-domains). */
	domainSources: DomainSource[];
}

export const BUILTIN_DEFAULTS: WebSearchConfig = {
	enabled: true,
	provider: "duckduckgo",
	braveApiKey: "",
	allowedDomains: [
		"developer.mozilla.org",
		"docs.python.org",
		"docs.nodejs.org",
		"nodejs.org",
		"typescriptlang.org",
		"github.com",
		"stackoverflow.com",
		"en.wikipedia.org",
		"crates.io",
		"pypi.org",
		"npmjs.com",
		"kubernetes.io",
		"docs.docker.com",
	],
	useBuiltins: true,
	allowSubdomains: true,
	confirmOutsideAllowlist: false,
	maxResults: 8,
	maxContentChars: 20000,
	maxDownloadBytes: 2 * 1024 * 1024,
	timeoutMs: 15000,
	maxRedirects: 5,
	blockPrivateNetworks: true,
};

const CONFIG_DIR = ".pi";

export function globalSettingsPath(): string {
	return path.join(os.homedir(), CONFIG_DIR, "agent", "settings.json");
}

export function projectSettingsPath(cwd: string): string {
	return path.join(cwd, CONFIG_DIR, "settings.json");
}

function readSettingsJson(file: string): Record<string, unknown> | null {
	try {
		const raw = fs.readFileSync(file, "utf8");
		const parsed = JSON.parse(raw);
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
		return null;
	} catch {
		return null; // missing or unreadable — treat as absent
	}
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
	if (typeof v !== "number" || !Number.isFinite(v)) return fallback;
	return Math.min(max, Math.max(min, Math.round(v)));
}

function asBool(v: unknown, fallback: boolean): boolean {
	return typeof v === "boolean" ? v : fallback;
}

function asString(v: unknown, fallback: string): string {
	return typeof v === "string" ? v : fallback;
}

/** Normalize a user-supplied domain entry; returns "" if unusable. */
export function sanitizeDomainEntry(entry: unknown): string {
	if (typeof entry !== "string") return "";
	const e = entry.trim().toLowerCase();
	if (!e) return "";
	// Strip any scheme a user might have pasted.
	const noScheme = e.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
	let host = noScheme.split("/")[0].split("?")[0].split("#")[0];
	// Unbracket IPv6 literals so entries and URL hostnames compare consistently.
	if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
	if (!host) return "";
	if (host.includes(" ")) return "";
	// IP-literal entries: keep as-is (no port stripping — it would mangle IPv6).
	if (net.isIP(host) !== 0) return host;
	// Strip a port: URL hostname never includes one, so a ported entry could never match.
	host = host.replace(/:\d+$/, "");
	if (!host) return "";
	return host;
}

/**
 * Load and merge configuration for a session.
 *
 * @param cwd            current working directory (project settings source)
 * @param projectTrusted whether project-local settings may be honored
 * @param home           override for tests
 */
export function loadConfig(
	cwd: string,
	projectTrusted: boolean,
	home: string = os.homedir(),
): LoadedConfig {
	const config: WebSearchConfig = { ...BUILTIN_DEFAULTS, allowedDomains: [...BUILTIN_DEFAULTS.allowedDomains] };
	const domainSources: DomainSource[] = [];
	if (config.useBuiltins) {
		domainSources.push({ path: "(built-in)", domains: [...config.allowedDomains] });
	}

	const merge = (file: string) => {
		const settings = readSettingsJson(file);
		const ws = settings?.webSearch;
		if (!ws || typeof ws !== "object" || Array.isArray(ws)) return;
		const w = ws as Record<string, unknown>;

		config.enabled = asBool(w.enabled, config.enabled);
		if (w.provider === "duckduckgo" || w.provider === "brave") config.provider = w.provider;
		config.braveApiKey = asString(w.braveApiKey, config.braveApiKey);
		config.useBuiltins = asBool(w.useBuiltins, config.useBuiltins);
		config.allowSubdomains = asBool(w.allowSubdomains, config.allowSubdomains);
		config.confirmOutsideAllowlist = asBool(w.confirmOutsideAllowlist, config.confirmOutsideAllowlist);
		config.maxResults = clampInt(w.maxResults, 1, 20, config.maxResults);
		config.maxContentChars = clampInt(w.maxContentChars, 1000, 100000, config.maxContentChars);
		config.maxDownloadBytes = clampInt(w.maxDownloadBytes, 1024, 10 * 1024 * 1024, config.maxDownloadBytes);
		config.timeoutMs = clampInt(w.timeoutMs, 1000, 120000, config.timeoutMs);
		config.maxRedirects = clampInt(w.maxRedirects, 0, 10, config.maxRedirects);
		config.blockPrivateNetworks = asBool(w.blockPrivateNetworks, config.blockPrivateNetworks);

		if (w.useBuiltins === false) {
			// Drop built-in domains but keep user-provided ones.
			const builtinSet = new Set(BUILTIN_DEFAULTS.allowedDomains.map((d) => d.toLowerCase()));
			config.allowedDomains = config.allowedDomains.filter((d) => !builtinSet.has(d.toLowerCase()));
		}

		if (Array.isArray(w.allowedDomains)) {
			const fresh: string[] = [];
			for (const entry of w.allowedDomains) {
				const d = sanitizeDomainEntry(entry);
				if (d) fresh.push(d);
			}
			if (fresh.length > 0) {
				const seen = new Set(config.allowedDomains.map((d) => d.toLowerCase()));
				for (const d of fresh) {
					if (!seen.has(d.toLowerCase())) {
						seen.add(d.toLowerCase());
						config.allowedDomains.push(d);
					}
				}
				domainSources.push({ path: file, domains: fresh });
			}
		}
	};

	const globalPath = path.join(home, CONFIG_DIR, "agent", "settings.json");
	merge(globalPath);
	if (projectTrusted) merge(projectSettingsPath(cwd));

	return { config, domainSources };
}

/**
 * Add or remove domains in a settings file (preserving all other keys).
 * Returns the path written.
 */
export function updateSettingsDomains(
	file: string,
	domains: string[],
	mutate: (list: string[]) => string[],
): string {
	const settings = readSettingsJson(file) ?? {};
	const ws = (settings.webSearch ?? {}) as Record<string, unknown>;
	const current = Array.isArray(ws.allowedDomains)
		? (ws.allowedDomains as unknown[]).map(sanitizeDomainEntry).filter(Boolean)
		: [];
	const next = mutate(current);
	const nextWs = { ...ws, allowedDomains: next };
	const nextSettings = { ...settings, webSearch: nextWs };
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, JSON.stringify(nextSettings, null, 2) + "\n", "utf8");
	return file;
}
