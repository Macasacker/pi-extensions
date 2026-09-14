// Domain allowlist matcher — the security-critical bypass matrix.
import assert from "node:assert/strict";
import { test, finish } from "./harness.mjs";
import { checkUrl, normalizeHost, isPrivateIp, diffAllowlists } from "../src/domains.ts";

const baseSettings = { allowedDomains: ["example.com", "docs.python.org"], allowSubdomains: true, blockPrivateNetworks: true };

await test("exact host matches entry", () => {
	assert.equal(checkUrl("https://example.com", baseSettings).allowed, true);
});

await test("www. prefix is stripped (host)", () => {
	assert.equal(checkUrl("https://www.example.com/x", baseSettings).allowed, true);
});

await test("uppercase + default port normalize", () => {
	assert.equal(checkUrl("https://EXAMPLE.com:443/", baseSettings).allowed, true);
	assert.equal(normalizeHost("WWW.Example.COM."), "example.com");
});

await test("subdomain matches when allowSubdomains", () => {
	assert.equal(checkUrl("https://a.b.example.com/", baseSettings).allowed, true);
});

await test("subdomain denied when allowSubdomains: false", () => {
	assert.equal(checkUrl("https://sub.example.com/", { ...baseSettings, allowSubdomains: false }).allowed, false);
});

await test("sneaky suffix host does NOT match (example.com.evil.com)", () => {
	const checkResult = checkUrl("https://example.com.evil.com/", baseSettings);
	assert.equal(checkResult.allowed, false);
	assert.match(checkResult.reason ?? "", /not in the allowlist/);
});

await test("path is never matched against entries (evil.com/example.com)", () => {
	assert.equal(checkUrl("https://evil.com/example.com", baseSettings).allowed, false);
});

await test("userinfo is ignored; host is what matters (x@allowed.com)", () => {
	assert.equal(checkUrl("http://x@example.com/", baseSettings).allowed, true);
});

await test("userinfo trick does not smuggle in a bad host (allowed.com@evil.com)", () => {
	assert.equal(checkUrl("http://allowed.com@evil.com/", baseSettings).allowed, false);
});

await test("lookalike IDN host (punycode) does not match ASCII entry", () => {
	// "exämple.com" — IDNA-punycode lookalike of example.com
	const testUrl = new URL("https://exämple.com/");
	const checkResult = checkUrl(testUrl.toString(), baseSettings);
	assert.equal(checkResult.allowed, false, `expected deny for ${testUrl.hostname}`);
});

await test("file:// scheme blocked", () => {
	const checkResult = checkUrl("file:///etc/passwd", baseSettings);
	assert.equal(checkResult.allowed, false);
	assert.match(checkResult.reason ?? "", /scheme/i);
});

await test("ftp:// scheme blocked", () => {
	assert.equal(checkUrl("ftp://example.com/file", baseSettings).allowed, false);
});

await test("unparseable URL is denied, not thrown", () => {
	assert.equal(checkUrl("not a url", baseSettings).allowed, false);
});

await test("loopback IPv4 blocked (private)", () => {
	assert.equal(checkUrl("http://127.0.0.1/", baseSettings).allowed, false);
});

await test("RFC1918 blocked", () => {
	assert.equal(checkUrl("http://10.0.0.5/", baseSettings).allowed, false);
	assert.equal(checkUrl("http://192.168.1.1/", baseSettings).allowed, false);
	assert.equal(checkUrl("http://172.16.0.1/", baseSettings).allowed, false);
});

await test("link-local / cloud metadata blocked", () => {
	assert.equal(checkUrl("http://169.254.169.254/latest/meta-data/", baseSettings).allowed, false);
});

await test("IPv6 loopback blocked", () => {
	assert.equal(checkUrl("http://[::1]/", baseSettings).allowed, false);
});

await test("IPv4-mapped IPv6 loopback blocked", () => {
	assert.equal(checkUrl("http://[::ffff:127.0.0.1]/", baseSettings).allowed, false);
});

await test("public IP literal denied without explicit entry", () => {
	assert.equal(checkUrl("http://93.184.216.34/", baseSettings).allowed, false);
});

await test("explicit IP entry works when blockPrivateNetworks: false", () => {
	const settings = { allowedDomains: ["127.0.0.1"], allowSubdomains: true, blockPrivateNetworks: false };
	assert.equal(checkUrl("http://127.0.0.1:8080/", settings).allowed, true);
});

await test("explicit private IP still blocked when blockPrivateNetworks: true", () => {
	const settings = { allowedDomains: ["127.0.0.1"], allowSubdomains: true, blockPrivateNetworks: true };
	const checkResult = checkUrl("http://127.0.0.1/", settings);
	assert.equal(checkResult.allowed, false);
	assert.match(checkResult.reason ?? "", /Private|reserved/);
});

await test("runtime grant allows a host outside the list", () => {
	const settings = { ...baseSettings, grantedHosts: new Set(["granted.org"]) };
	assert.equal(checkUrl("https://granted.org/page", settings).allowed, true);
	assert.equal(checkUrl("https://notgranted.org/", settings).allowed, false);
});

await test("decimal/octal IP notations normalize to dotted form and are blocked", () => {
	assert.equal(checkUrl("http://2130706433/", baseSettings).allowed, false); // 127.0.0.1
	assert.equal(checkUrl("http://0177.0.0.1/", baseSettings).allowed, false);
});

await test("percent-encoded host decodes to the real host (same host → same verdict)", () => {
	assert.equal(checkUrl("http://ex%61mple.com/", baseSettings).allowed, true); // decodes to example.com
});

await test("null byte / IPvFuture hosts are unparseable → denied", () => {
	assert.equal(checkUrl("http://example.com%00.evil.com/", baseSettings).allowed, false);
	assert.equal(checkUrl("http://[tfe80::1]/", baseSettings).allowed, false);
});

await test("userinfo with port still matches on the real host only", () => {
	assert.equal(checkUrl("http://example.com:443@evil.com/", baseSettings).allowed, false);
	assert.equal(checkUrl("http://x@example.com:8080/", baseSettings).allowed, true);
});

await test("underscore host is a domain, never matches", () => {
	assert.equal(checkUrl("http://_example.com/", baseSettings).allowed, false);
});

await test("hex-form IPv4-mapped IPv6 is recognized as private (the URL parser emits hex)", () => {
	// new URL("http://[::ffff:127.0.0.1]/").hostname === "::ffff:7f00:1"
	assert.equal(isPrivateIp("::ffff:7f00:1"), true); // 127.0.0.1
	assert.equal(isPrivateIp("::ffff:a9fe:a9fe"), true); // 169.254.169.254 (cloud metadata)
	assert.equal(isPrivateIp("::ffff:a00:a"), true); // 10.0.0.10
	assert.equal(isPrivateIp("::ffff:c0a8:aa"), true); // 192.168.1.10
	assert.equal(isPrivateIp("::ffff:8888:8888"), false); // 8.8.8.8
	assert.equal(checkUrl("http://[::ffff:127.0.0.1]/", baseSettings).allowed, false);
	assert.equal(checkUrl("http://[::ffff:169.254.169.254]/latest/meta-data/", baseSettings).allowed, false);
});

await test("explicit hex-mapped entry cannot disable blockPrivateNetworks (reviewer's Critical case)", () => {
	const obfuscatedSettings = { allowedDomains: ["::ffff:a9fe:a9fe"], allowSubdomains: true, blockPrivateNetworks: true };
	const checkResult = checkUrl("http://[::ffff:169.254.169.254]/latest/meta-data/iam/security-credentials/", obfuscatedSettings);
	assert.equal(checkResult.allowed, false, `must be blocked, got: ${JSON.stringify(checkResult)}`);
	const explicitOptInSettings = { allowedDomains: ["::ffff:a9fe:a9fe"], allowSubdomains: true, blockPrivateNetworks: false };
	assert.equal(checkUrl("http://[::ffff:169.254.169.254]/", explicitOptInSettings).allowed, true, "explicit entry + blockPrivateNetworks:false must work");
});

await test("fe80::/10 link-local range fully covered (fe80..febf)", () => {
	assert.equal(isPrivateIp("fe80::1"), true);
	assert.equal(isPrivateIp("fe81::1"), true);
	assert.equal(isPrivateIp("febf:ffff::1"), true);
	assert.equal(isPrivateIp("fec0::1"), false); // outside fe80::/10
	assert.equal(isPrivateIp("fe7f::1"), false);
});

await test("user-confirmed grant overrides blockPrivateNetworks for IP-literal hosts", () => {
	const settings = { allowedDomains: [], allowSubdomains: true, blockPrivateNetworks: true, grantedHosts: new Set(["10.0.0.5"]) };
	assert.equal(checkUrl("http://10.0.0.5/", settings).allowed, true);
	assert.equal(checkUrl("http://10.0.0.6/", settings).allowed, false);
});

await test("leading-dot hostname is rejected (resolver search-domain risk)", () => {
	const checkResult = checkUrl("http://.example.com/", baseSettings);
	assert.equal(checkResult.allowed, false);
	assert.match(checkResult.reason ?? "", /leading dot/i);
});

await test("isPrivateIp unit checks", () => {
	assert.equal(isPrivateIp("0.0.0.0"), true);
	assert.equal(isPrivateIp("100.64.0.1"), true); // CGNAT
	assert.equal(isPrivateIp("224.0.0.1"), true); // multicast
	assert.equal(isPrivateIp("8.8.8.8"), false);
	assert.equal(isPrivateIp("::"), true);
	assert.equal(isPrivateIp("fe80::1"), true);
	assert.equal(isPrivateIp("fd12:3456::1"), true); // ULA
	assert.equal(isPrivateIp("2606:4700:4700::1111"), false);
	assert.equal(isPrivateIp("example.com"), false);
});

// diffAllowlists — pure allowlist drift diff (drift detection).
// Contract: the caller passes sorted copies; `previous` is null on the first call.

await test("should return null when previous is null (first call records a baseline, nothing to compare)", () => {
	const previousAllowlist = null;
	const currentAllowlist = ["example.com", "docs.python.org"];

	const diffResult = diffAllowlists(previousAllowlist, currentAllowlist);

	assert.equal(diffResult, null);
});

await test("should return empty added and removed lists when both allowlists are identical", () => {
	const previousAllowlist = ["example.com", "docs.python.org"];
	const currentAllowlist = ["example.com", "docs.python.org"];

	const diffResult = diffAllowlists(previousAllowlist, currentAllowlist);

	assert.deepEqual(diffResult, { added: [], removed: [] });
});

await test("should list the new domains as added when the allowlist only grows", () => {
	const previousAllowlist = ["example.com"];
	const currentAllowlist = ["example.com", "docs.python.org", "news.ycombinator.com"];

	const diffResult = diffAllowlists(previousAllowlist, currentAllowlist);

	assert.deepEqual(diffResult, { added: ["docs.python.org", "news.ycombinator.com"], removed: [] });
});

await test("should list the dropped domains as removed when the allowlist only shrinks", () => {
	const previousAllowlist = ["example.com", "docs.python.org"];
	const currentAllowlist = ["example.com"];

	const diffResult = diffAllowlists(previousAllowlist, currentAllowlist);

	assert.deepEqual(diffResult, { added: [], removed: ["docs.python.org"] });
});

await test("should list both added and removed domains when the allowlist changed in both directions", () => {
	const previousAllowlist = ["example.com", "docs.python.org"];
	const currentAllowlist = ["example.com", "news.ycombinator.com"];

	const diffResult = diffAllowlists(previousAllowlist, currentAllowlist);

	assert.deepEqual(diffResult, { added: ["news.ycombinator.com"], removed: ["docs.python.org"] });
});

await test("should report the same set of added and removed domains when inputs are unsorted (membership, not position, determines the diff)", () => {
	// Both inputs are deliberately out of order, and added and removed each
	// span multiple domains whose relative order differs from the sorted
	// inputs — a position-sensitive diff would not survive this comparison.
	const unsortedPrevious = ["example.com", "docs.python.org", "old.example.org"];
	const unsortedCurrent = ["news.ycombinator.com", "example.com", "fresh.example.net"];
	const sortedPrevious = [...unsortedPrevious].sort();
	const sortedCurrent = [...unsortedCurrent].sort();

	const unsortedDiff = diffAllowlists(unsortedPrevious, unsortedCurrent);
	const sortedDiff = diffAllowlists(sortedPrevious, sortedCurrent);

	const expectedAdded = ["fresh.example.net", "news.ycombinator.com"];
	const expectedRemoved = ["docs.python.org", "old.example.org"];
	assert.deepEqual([...unsortedDiff.added].sort(), expectedAdded);
	assert.deepEqual([...unsortedDiff.removed].sort(), expectedRemoved);
	assert.deepEqual([...sortedDiff.added].sort(), expectedAdded);
	assert.deepEqual([...sortedDiff.removed].sort(), expectedRemoved);
});

await test("should not report a domain as added or removed when it appears in both allowlists, even if duplicated", () => {
	const previousAllowlist = ["example.com", "example.com"];
	const currentAllowlist = ["example.com", "example.com"];

	const diffResult = diffAllowlists(previousAllowlist, currentAllowlist);

	assert.deepEqual(diffResult, { added: [], removed: [] });
});

finish();
