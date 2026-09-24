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
 *
 * Problems found while reading a settings file (malformed JSON, a non-object
 * `webSearch` key, unknown keys) are collected in `LoadedConfig.configWarnings`.
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
	/** Problems found while loading settings (malformed JSON, ignored keys). */
	configWarnings: string[];
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

/**
 * Per-key bounds for the numeric settings — the single source of truth for
 * the min/max values applied by `clampInt` in `loadConfig`'s merge.
 */
const NUMERIC_LIMITS = {
	maxResults: { min: 1, max: 20 },
	maxContentChars: { min: 1000, max: 100000 },
	maxDownloadBytes: { min: 1024, max: 10 * 1024 * 1024 },
	timeoutMs: { min: 1000, max: 120000 },
	maxRedirects: { min: 0, max: 10 },
} as const;

type NumericConfigKey = keyof typeof NUMERIC_LIMITS;

/**
 * The recognized `webSearch` settings keys — the single source of truth for
 * what `mergeSettingsFile` reads; any other key is ignored (with a warning).
 */
const KNOWN_WEBSEARCH_KEYS: ReadonlySet<string> = new Set([
	"enabled",
	"provider",
	"braveApiKey",
	"useBuiltins",
	"allowSubdomains",
	"confirmOutsideAllowlist",
	"maxResults",
	"maxContentChars",
	"maxDownloadBytes",
	"timeoutMs",
	"maxRedirects",
	"blockPrivateNetworks",
	"allowedDomains",
]);

const CONFIG_DIR = ".pi";

export function globalSettingsPath(): string {
	return path.join(os.homedir(), CONFIG_DIR, "agent", "settings.json");
}

export function projectSettingsPath(cwd: string): string {
	return path.join(cwd, CONFIG_DIR, "settings.json");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

type SettingsFileReadResult =
	| { status: "missing" }
	| { status: "malformed", reason: "invalid-json" | "not-an-object" }
	| { status: "ok", settings: Record<string, unknown> };

function readSettingsJson(file: string): SettingsFileReadResult {
	let fileContents: string;
	try {
		fileContents = fs.readFileSync(file, "utf8");
	} catch {
		return { status: "missing" }; // absent or unreadable — the normal case
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(fileContents);
	} catch {
		return { status: "malformed", reason: "invalid-json" };
	}
	if (!isPlainObject(parsed)) return { status: "malformed", reason: "not-an-object" };
	return { status: "ok", settings: parsed };
}

function clampInt(value: unknown, bounds: { min: number; max: number; fallback: number }): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return bounds.fallback;
	return Math.min(bounds.max, Math.max(bounds.min, Math.round(value)));
}

function asBool(value: unknown, fallback: boolean): boolean {
	return typeof value === "boolean" ? value : fallback;
}

function asString(value: unknown, fallback: string): string {
	return typeof value === "string" ? value : fallback;
}

/** Normalize a user-supplied domain entry; returns "" if unusable. */
export function sanitizeDomainEntry(entry: unknown): string {
	if (typeof entry !== "string") return "";
	const normalizedEntry = entry.trim().toLowerCase();
	if (!normalizedEntry) return "";
	// Strip any scheme a user might have pasted.
	const noScheme = normalizedEntry.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
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

interface ConfigLoadState {
	config: WebSearchConfig;
	domainSources: DomainSource[];
	configWarnings: string[];
}

/**
 * Sanitize a raw settings `allowedDomains` array and merge it into the
 * existing list (case-insensitive dedup, existing entries keep their order).
 * Returns the sanitized entries and the merged list.
 */
function mergeDomainEntries(existingDomains: string[], rawEntries: unknown[]): { fresh: string[]; merged: string[] } {
	const fresh: string[] = [];
	for (const entry of rawEntries) {
		const sanitizedDomain = sanitizeDomainEntry(entry);
		if (sanitizedDomain) fresh.push(sanitizedDomain);
	}

	if (fresh.length === 0) return { fresh, merged: existingDomains };

	const seen = new Set(existingDomains.map((domain) => domain.toLowerCase()));
	const merged: string[] = [...existingDomains];
	for (const domain of fresh) {
		if (!seen.has(domain.toLowerCase())) {
			seen.add(domain.toLowerCase());
			merged.push(domain);
		}
	}
	return { fresh, merged };
}

function applyWebSearchSettings(config: WebSearchConfig, webSearchSettings: Record<string, unknown>): WebSearchConfig {
	const mergedConfig: WebSearchConfig = {
		...config,
		enabled: asBool(webSearchSettings.enabled, config.enabled),
		braveApiKey: asString(webSearchSettings.braveApiKey, config.braveApiKey),
		useBuiltins: asBool(webSearchSettings.useBuiltins, config.useBuiltins),
		allowSubdomains: asBool(webSearchSettings.allowSubdomains, config.allowSubdomains),
		confirmOutsideAllowlist: asBool(webSearchSettings.confirmOutsideAllowlist, config.confirmOutsideAllowlist),
		blockPrivateNetworks: asBool(webSearchSettings.blockPrivateNetworks, config.blockPrivateNetworks),
	};
	if (webSearchSettings.provider === "duckduckgo" || webSearchSettings.provider === "brave") mergedConfig.provider = webSearchSettings.provider;
	for (const key of Object.keys(NUMERIC_LIMITS) as NumericConfigKey[]) {
		const limits = NUMERIC_LIMITS[key];
		mergedConfig[key] = clampInt(webSearchSettings[key], { min: limits.min, max: limits.max, fallback: mergedConfig[key] });
	}
	if (webSearchSettings.useBuiltins === false) {
		// Drop built-in domains but keep user-provided ones.
		const builtinSet = new Set(BUILTIN_DEFAULTS.allowedDomains.map((domain) => domain.toLowerCase()));
		mergedConfig.allowedDomains = mergedConfig.allowedDomains.filter((domain) => !builtinSet.has(domain.toLowerCase()));
	}
	return mergedConfig;
}

function mergeSettingsFile(state: ConfigLoadState, file: string): void {
	const readResult = readSettingsJson(file);
	if (readResult.status === "missing") return;
	if (readResult.status === "malformed") {
		const warningMessage =
			readResult.reason === "not-an-object"
				? `web-search: ${file} is not a JSON object — its webSearch settings are being ignored.`
				: `web-search: ${file} is not valid JSON — its webSearch settings are being ignored.`;
		state.configWarnings.push(warningMessage);
		return;
	}
	const webSearchSection = readResult.settings.webSearch;
	if (webSearchSection === undefined) return;
	if (!isPlainObject(webSearchSection)) {
		state.configWarnings.push(`web-search: the "webSearch" key in ${file} is not an object — it is being ignored.`);
		return;
	}
	const unknownKeys = Object.keys(webSearchSection).filter((key) => !KNOWN_WEBSEARCH_KEYS.has(key));
	if (unknownKeys.length > 0) {
		state.configWarnings.push(`web-search: unknown webSearch key(s) in ${file} are being ignored: ${unknownKeys.join(", ")}.`);
	}
	state.config = applyWebSearchSettings(state.config, webSearchSection);

	if (Array.isArray(webSearchSection.allowedDomains)) {
		const { fresh, merged } = mergeDomainEntries(state.config.allowedDomains, webSearchSection.allowedDomains);
		if (fresh.length > 0) {
			state.config.allowedDomains = merged;
			state.domainSources.push({ path: file, domains: fresh });
		}
	}
}

/**
 * Load and merge configuration for a session.
 *
 * @param options.cwd            current working directory (project settings source)
 * @param options.projectTrusted whether project-local settings may be honored
 * @param options.homeDir        override for tests (defaults to os.homedir())
 */
export function loadConfig({ cwd, projectTrusted, homeDir = os.homedir() }: { cwd: string; projectTrusted: boolean; homeDir?: string }): LoadedConfig {
	const state: ConfigLoadState = {
		config: { ...BUILTIN_DEFAULTS, allowedDomains: [...BUILTIN_DEFAULTS.allowedDomains] },
		domainSources: [],
		configWarnings: [],
	};
	if (state.config.useBuiltins) {
		state.domainSources.push({ path: "(built-in)", domains: [...state.config.allowedDomains] });
	}

	const globalPath = path.join(homeDir, CONFIG_DIR, "agent", "settings.json");
	mergeSettingsFile(state, globalPath);
	if (projectTrusted) mergeSettingsFile(state, projectSettingsPath(cwd));

	return { config: state.config, domainSources: state.domainSources, configWarnings: state.configWarnings };
}

/**
 * Add or remove domains in a settings file (preserving all other keys).
 * `mutate` receives the current list from the file and returns the next one.
 * Returns the path written.
 */
export function updateSettingsDomains(
	file: string,
	mutate: (list: string[]) => string[],
): string {
	const readResult = readSettingsJson(file);
	const settings = readResult.status === "ok" ? readResult.settings : {};
	const webSearchSection = (settings.webSearch ?? {}) as Record<string, unknown>;
	const current = Array.isArray(webSearchSection.allowedDomains)
		? (webSearchSection.allowedDomains as unknown[]).map(sanitizeDomainEntry).filter(Boolean)
		: [];
	const nextDomains = mutate(current);
	const nextWebSearchSection = { ...webSearchSection, allowedDomains: nextDomains };
	const nextSettings = { ...settings, webSearch: nextWebSearchSection };
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, JSON.stringify(nextSettings, null, 2) + "\n", "utf8");
	return file;
}
