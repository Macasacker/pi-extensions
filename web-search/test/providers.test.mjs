// Search provider parsing: DuckDuckGo HTML (uddg decode, challenge detection)
// and Brave JSON. Uses injected fake fetch — no network.
import assert from "node:assert/strict";
import { test, finish } from "./harness.mjs";
import { duckduckgoProvider } from "../src/providers/duckduckgo.ts";
import { createBraveProvider, expandEnvRef } from "../src/providers/brave.ts";

function fakeFetch(body, { status = 200, json = false } = {}) {
	return async () =>
		new Response(json ? JSON.stringify(body) : body, {
			status,
			headers: { "Content-Type": json ? "application/json" : "text/html" },
		});
}

const DUCKDUCKGO_HTML_FIXTURE = `
<html><body>
  <div class="result">
    <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fdeveloper.mozilla.org%2Fen-US%2Fdocs%2FWeb&rut=abc">MDN Docs</a>
    <a class="result__snippet">The Mozilla Documentation Network.</a>
  </div>
  <div class="result">
    <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fpage&rut=xyz">Example Page</a>
    <a class="result__snippet">An example result.</a>
  </div>
  <div class="result">
    <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fgithub.com%2Ffoo%2Fbar&rut=1">GitHub Repo</a>
    <a class="result__snippet">A repository.</a>
  </div>
  <div class="result">
    <a class="result__a" href="//duckduckgo.com/?q=more">More results</a>
  </div>
</body></html>`;

await test("duckduckgo: decodes uddg redirect wrappers to real URLs", async () => {
	const results = await duckduckgoProvider.search("mdn", 10, new AbortController().signal, fakeFetch(DUCKDUCKGO_HTML_FIXTURE));
	assert.equal(results.length, 3, "the 'more results' link must not count as a result");
	assert.equal(results[0].url, "https://developer.mozilla.org/en-US/docs/Web");
	assert.equal(results[0].title, "MDN Docs");
	assert.equal(results[0].snippet, "The Mozilla Documentation Network.");
	assert.equal(results[1].url, "https://example.com/page");
	assert.equal(results[2].url, "https://github.com/foo/bar");
});

await test("duckduckgo: respects the result limit", async () => {
	const results = await duckduckgoProvider.search("mdn", 2, new AbortController().signal, fakeFetch(DUCKDUCKGO_HTML_FIXTURE));
	assert.equal(results.length, 2);
});

await test("duckduckgo: detects challenge pages and suggests Brave", async () => {
	const challenge = `<html><body><form id="challenge-form"><p>Please try again later. Not A Robot check.</p></form></body></html>`;
	await assert.rejects(
		() => duckduckgoProvider.search("x", 5, new AbortController().signal, fakeFetch(challenge)),
		/Brave|challenge/i,
	);
});

await test("duckduckgo: non-OK status throws a helpful error", async () => {
	await assert.rejects(
		() => duckduckgoProvider.search("x", 5, new AbortController().signal, fakeFetch("blocked", { status: 403 })),
		/HTTP 403|Brave/,
	);
});

await test("brave: parses web.results JSON", async () => {
	const body = {
		web: {
			results: [
				{ title: "R1", url: "https://a.example/1", description: "desc1" },
				{ title: "R2", url: "https://b.example/2", description: "desc2" },
				{ title: "R3", url: "https://c.example/3", description: "desc3" },
			],
		},
	};
	const provider = createBraveProvider("test-key");
	const results = await provider.search("q", 2, new AbortController().signal, fakeFetch(body, { json: true }));
	assert.equal(results.length, 2);
	assert.equal(results[0].url, "https://a.example/1");
	assert.equal(results[0].snippet, "desc1");
});

await test("brave: missing key throws", async () => {
	const provider = createBraveProvider("");
	await assert.rejects(() => provider.search("q", 5, new AbortController().signal), /API key/i);
});

await test("brave: bad key surfaces 401", async () => {
	const provider = createBraveProvider("bad-key");
	await assert.rejects(
		() => provider.search("q", 5, new AbortController().signal, fakeFetch("unauthorized", { status: 401, json: true })),
		/rejected the key/i,
	);
});

await test("expandEnvRef resolves $ENV and ${ENV} forms", () => {
	process.env.PI_TEST_WEBSEARCH_KEY = "secret-value";
	assert.equal(expandEnvRef("$PI_TEST_WEBSEARCH_KEY"), "secret-value");
	assert.equal(expandEnvRef("${PI_TEST_WEBSEARCH_KEY}"), "secret-value");
	assert.equal(expandEnvRef("literal-key"), "literal-key");
	assert.equal(expandEnvRef("$PI_TEST_UNSET_VAR_XYZ"), "");
});

finish();
