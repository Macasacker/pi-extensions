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
 * Normalize a hostname or allowlist entry for comparison.
 * IPv4-mapped IPv6 addresses are canonicalized to dotted form
 * (`::ffff:7f00:1` → `::ffff:127.0.0.1`) so URL hostnames (which Node's
 * URL parser emits in hex form) and user entries compare consistently.
 */
export function normalizeHost(host: string): string {
	let h = String(host ?? "").trim().toLowerCase();
	// Strip IPv6 brackets if present (URL.hostname already does, but entries may be raw).
	if (h.startsWith("[") && h.endsWith("]")) h = h.slice(1, -1);
	if (h.endsWith(".")) h = h.slice(0, -1);
	if (h.startsWith("www.")) h = h.slice(4);
	if (net.isIP(h) === 6) h = canonicalizeMappedIpv6(h);
	return h;
}

/** Convert `::ffff:XXYY:ZZWW` (hex) to `::ffff:a.b.c.d` (dotted). */
function canonicalizeMappedIpv6(host: string): string {
	const m = host.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
	if (!m) return host;
	const hi = parseInt(m[1], 16);
	const lo = parseInt(m[2], 16);
	return `::ffff:${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
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
	const h = normalizeHost(host);
	const family = net.isIP(h);
	if (family === 0) return false;

	if (family === 4) {
		const parts = h.split(".").map((n) => Number(n));
		if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return false;
		const [a, b] = parts;
		if (a === 0) return true; // 0.0.0.0/8 (unspecified)
		if (a === 10) return true; // RFC1918
		if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
		if (a === 127) return true; // loopback
		if (a === 169 && b === 254) return true; // link-local / cloud metadata
		if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
		if (a === 192 && b === 168) return true; // RFC1918
		if (a >= 224) return true; // multicast + reserved
		return false;
	}

	// IPv6
	let v6 = h;
	const zone = v6.indexOf("%");
	if (zone !== -1) v6 = v6.slice(0, zone);
	if (v6 === "::" || v6 === "::1") return true; // unspecified / loopback
	const mapped = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
	if (mapped) return isPrivateIp(mapped[1]); // IPv4-mapped (canonical dotted form)
	// fe80::/10 link-local: first hextet fe80..febf (4 hex digits: fe + [89ab] + [0-9a-f])
	const firstHextet = v6.split(":")[0];
	if (/^fe[89ab][0-9a-f]$/.test(firstHextet)) return true;
	if (v6.startsWith("fc") || v6.startsWith("fd")) return true; // ULA
	if (v6.startsWith("2001:db8:")) return true; // documentation range
	return false;
}

/**
 * Check a full URL against the allowlist.
 * Never throws: unparseable URLs and bad schemes come back as `allowed: false`.
 */
export function checkUrl(rawUrl: string, opts: AllowlistOptions): DomainCheck {
	let url: URL;
	try {
		url = new URL(rawUrl);
	} catch {
		return { allowed: false, reason: `Not a valid URL: ${rawUrl}` };
	}

	if (url.protocol !== "http:" && url.protocol !== "https:") {
		return { allowed: false, host: url.hostname, reason: `Blocked scheme: ${url.protocol}` };
	}

	const host = normalizeHost(url.hostname);
	if (!host) return { allowed: false, reason: "Empty host" };
	if (host.startsWith(".")) {
		return { allowed: false, host, reason: `Invalid host (leading dot): ${host}` };
	}

	// IP-literal hosts: never match domain entries.
	// A user-confirmed grant is the strongest signal and wins for IP hosts too.
	if (isIpLiteral(host)) {
		if (opts.grantedHosts?.has(host)) return { allowed: true, host, reason: "granted by user" };
		const explicit = opts.allowedDomains.some((e) => normalizeHost(e) === host);
		if (!explicit) {
			return { allowed: false, host, reason: `IP-literal host ${host} is not explicitly allowed` };
		}
		if (isPrivateIp(host) && (opts.blockPrivateNetworks ?? true)) {
			return { allowed: false, host, reason: `Private/reserved address ${host} is blocked (blockPrivateNetworks)` };
		}
		return { allowed: true, host };
	}

	// Runtime grants (user-confirmed) win.
	if (opts.grantedHosts?.has(host)) return { allowed: true, host, reason: "granted by user" };

	const allowSub = opts.allowSubdomains ?? true;
	for (const entry of opts.allowedDomains) {
		const e = normalizeHost(entry);
		if (!e) continue;
		if (isIpLiteral(e)) continue; // domain entries only, here
		if (host === e) return { allowed: true, host };
		if (allowSub && host.endsWith("." + e)) return { allowed: true, host };
	}

	return { allowed: false, host, reason: `Domain ${host} is not in the allowlist` };
}
