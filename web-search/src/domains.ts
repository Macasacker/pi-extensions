/**
 * Domain allowlist primitives — pure functions, no I/O.
 *
 * Security rules:
 * - Only http:/https: URLs are ever considered.
 * - Matching is done on the URL's *hostname* only (never the raw URL string,
 *   never the path, never userinfo). This defeats tricks like
 *   `http://allowed.com@evil.com/` and `http://evil.com/allowed.com`.
 * - Hostnames are normalized: lowercased, default port stripped (URL does this),
 *   trailing dot stripped, leading `www.` stripped. IDN input arrives as punycode
 *   from `new URL()`, so a lookalike IDN host can never match an ASCII entry.
 * - An entry `example.com` matches `example.com` and (when allowSubdomains)
 *   `a.b.example.com` — matched on a dot boundary, so `example.com.evil.com`
 *   never matches.
 * - IP-literal hosts (127.0.0.1, 10.x, ::1, …) never match a domain entry.
 *   They require an explicit IP entry AND blockPrivateNetworks: false.
 */

import net from "node:net";
import type { WebSearchConfig } from "./config.ts";
import type { SessionState } from "./session.ts";

export interface DomainCheck {
	allowed: boolean;
	/** Normalized hostname the check was performed against (when the URL parsed). */
	host?: string;
	/** Human-readable reason when not allowed. */
	reason?: string;
}

export interface AllowlistOptions {
	allowedDomains: string[];
	allowSubdomains?: boolean;
	blockPrivateNetworks?: boolean;
	/** Hosts granted at runtime (e.g. user confirmed a fetch outside the list). */
	grantedHosts?: ReadonlySet<string>;
}

/**
 * Build the allowlist options from the effective config and the session's
 * runtime grants. This is the single place the config + session state are
 * combined into the shape `checkUrl` / `safeFetch` consume.
 */
export function buildAllowlistOptions(config: WebSearchConfig, session: SessionState): AllowlistOptions {
	return {
		allowedDomains: config.allowedDomains,
		allowSubdomains: config.allowSubdomains,
		blockPrivateNetworks: config.blockPrivateNetworks,
		grantedHosts: session.grants,
	};
}

/**
 * Normalize a hostname or allowlist entry for comparison.
 * IPv4-mapped IPv6 addresses are canonicalized to dotted form
 * (`::ffff:7f00:1` → `::ffff:127.0.0.1`) so URL hostnames (which Node's
 * URL parser emits in hex form) and user entries compare consistently.
 */
export function normalizeHost(host: string): string {
	let normalizedHost = String(host ?? "").trim().toLowerCase();
	// Strip IPv6 brackets if present (URL.hostname already does, but entries may be raw).
	if (normalizedHost.startsWith("[") && normalizedHost.endsWith("]")) normalizedHost = normalizedHost.slice(1, -1);
	if (normalizedHost.endsWith(".")) normalizedHost = normalizedHost.slice(0, -1);
	if (normalizedHost.startsWith("www.")) normalizedHost = normalizedHost.slice(4);
	if (net.isIP(normalizedHost) === 6) normalizedHost = canonicalizeMappedIpv6(normalizedHost);
	return normalizedHost;
}

/** Convert `::ffff:XXYY:ZZWW` (hex) to `::ffff:a.b.c.d` (dotted). */
function canonicalizeMappedIpv6(host: string): string {
	const mappedMatch = host.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
	if (!mappedMatch) return host;
	const highWord = parseInt(mappedMatch[1], 16);
	const lowWord = parseInt(mappedMatch[2], 16);
	return `::ffff:${highWord >> 8}.${highWord & 0xff}.${lowWord >> 8}.${lowWord & 0xff}`;
}

/** True when the host is an IP literal (v4 or v6). */
export function isIpLiteral(host: string): boolean {
	return net.isIP(normalizeHost(host)) !== 0;
}

/**
 * True for addresses that must not be reachable by default: loopback,
 * RFC1918, link-local (incl. cloud metadata 169.254.169.254), ULA, CGNAT,
 * unspecified, multicast/reserved, and IPv4-mapped IPv6 forms.
 */
export function isPrivateIp(host: string): boolean {
	const normalizedHost = normalizeHost(host);
	const family = net.isIP(normalizedHost);
	if (family === 0) return false;

	if (family === 4) {
		const parts = normalizedHost.split(".").map((octetText) => Number(octetText));
		if (parts.length !== 4 || parts.some((octet) => Number.isNaN(octet) || octet < 0 || octet > 255)) return false;
		const [firstOctet, secondOctet] = parts;
		if (firstOctet === 0) return true; // 0.0.0.0/8 (unspecified)
		if (firstOctet === 10) return true; // RFC1918
		if (firstOctet === 100 && secondOctet >= 64 && secondOctet <= 127) return true; // CGNAT
		if (firstOctet === 127) return true; // loopback
		if (firstOctet === 169 && secondOctet === 254) return true; // link-local / cloud metadata
		if (firstOctet === 172 && secondOctet >= 16 && secondOctet <= 31) return true; // RFC1918
		if (firstOctet === 192 && secondOctet === 168) return true; // RFC1918
		if (firstOctet >= 224) return true; // multicast + reserved
		return false;
	}

	// IPv6
	let ipv6Address = normalizedHost;
	const zone = ipv6Address.indexOf("%");
	if (zone !== -1) ipv6Address = ipv6Address.slice(0, zone);
	if (ipv6Address === "::" || ipv6Address === "::1") return true; // unspecified / loopback
	const mapped = ipv6Address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
	if (mapped) return isPrivateIp(mapped[1]); // IPv4-mapped (canonical dotted form)
	// fe80::/10 link-local: first hextet fe80..febf (4 hex digits: fe + [89ab] + [0-9a-f])
	const firstHextet = ipv6Address.split(":")[0];
	if (/^fe[89ab][0-9a-f]$/.test(firstHextet)) return true;
	if (ipv6Address.startsWith("fc") || ipv6Address.startsWith("fd")) return true; // ULA
	if (ipv6Address.startsWith("2001:db8:")) return true; // documentation range
	return false;
}

/**
 * Check a full URL against the allowlist.
 * Never throws: unparseable URLs and bad schemes come back as `allowed: false`.
 *
 * The check runs in three stages: URL parsing, scheme validation (http/https
 * only), and host matching — the IP-literal or the domain regime, chosen by
 * the normalized host.
 */
export function checkUrl(rawUrl: string, allowlistOptions: AllowlistOptions): DomainCheck {
	let parsedUrl: URL;
	try {
		parsedUrl = new URL(rawUrl);
	} catch {
		return { allowed: false, reason: `Not a valid URL: ${rawUrl}` };
	}

	const schemeViolation = checkUrlScheme(parsedUrl);
	if (schemeViolation) return schemeViolation;

	const host = normalizeHost(parsedUrl.hostname);
	if (!host) return { allowed: false, reason: "Empty host" };
	if (host.startsWith(".")) {
		return { allowed: false, host, reason: `Invalid host (leading dot): ${host}` };
	}

	if (isIpLiteral(host)) return checkIpLiteralHost(host, allowlistOptions);
	return checkDomainHost(host, allowlistOptions);
}

/**
 * Only http:/https: URLs are ever considered; every other protocol
 * (file://, ftp://, data:, …) is blocked.
 *
 * @returns the block result for a non-http(s) scheme, or `null` when the
 *   scheme is acceptable and host matching should proceed.
 */
function checkUrlScheme(parsedUrl: URL): DomainCheck | null {
	if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
		return { allowed: false, host: parsedUrl.hostname, reason: `Blocked scheme: ${parsedUrl.protocol}` };
	}
	return null;
}

/**
 * IP-literal host regime: IP hosts never match domain entries.
 * A user-confirmed grant is the strongest signal and wins for IP hosts too;
 * otherwise an explicit IP entry is required, and private/reserved addresses
 * stay blocked unless blockPrivateNetworks is turned off.
 */
function checkIpLiteralHost(host: string, allowlistOptions: AllowlistOptions): DomainCheck {
	if (allowlistOptions.grantedHosts?.has(host)) return { allowed: true, host, reason: "granted by user" };
	const explicitlyAllowed = allowlistOptions.allowedDomains.some((entry) => normalizeHost(entry) === host);
	if (!explicitlyAllowed) {
		return { allowed: false, host, reason: `IP-literal host ${host} is not explicitly allowed` };
	}
	if (isPrivateIp(host) && (allowlistOptions.blockPrivateNetworks ?? true)) {
		return { allowed: false, host, reason: `Private/reserved address ${host} is blocked (blockPrivateNetworks)` };
	}
	return { allowed: true, host };
}

/**
 * Domain host regime: runtime grants (user-confirmed) win, then the
 * allowlist entries — exact match first, then a subdomain match when
 * allowSubdomains is set. IP-literal entries are skipped: they can only
 * match IP-literal hosts.
 */
function checkDomainHost(host: string, allowlistOptions: AllowlistOptions): DomainCheck {
	if (allowlistOptions.grantedHosts?.has(host)) return { allowed: true, host, reason: "granted by user" };

	const subdomainsAllowed = allowlistOptions.allowSubdomains ?? true;
	for (const entry of allowlistOptions.allowedDomains) {
		const normalizedEntry = normalizeHost(entry);
		if (!normalizedEntry) continue;
		if (isIpLiteral(normalizedEntry)) continue; // domain entries only, here
		if (host === normalizedEntry) return { allowed: true, host };
		if (subdomainsAllowed && host.endsWith("." + normalizedEntry)) return { allowed: true, host };
	}

	return { allowed: false, host, reason: `Domain ${host} is not in the allowlist` };
}

/**
 * Diff two allowlists (drift detection).
 *
 * Contract: both inputs are sorted copies of the live allowlists — the caller
 * sorts before comparing, so this function is order-independent and never
 * re-sorts. `previous` is `null` on the first call (no baseline recorded yet),
 * in which case there is nothing to compare and `null` is returned.
 *
 * @param previous allowlist recorded at the previous check, or `null` (first call)
 * @param current  the allowlist as it is now (sorted)
 * @returns `null` when there is no baseline, otherwise `{ added, removed }` (both possibly empty)
 */
export function diffAllowlists(previous: string[] | null, current: string[]): { added: string[]; removed: string[] } | null {
	if (previous === null) return null;
	const added = current.filter((domain) => !previous.includes(domain));
	const removed = previous.filter((domain) => !current.includes(domain));
	return { added, removed };
}
