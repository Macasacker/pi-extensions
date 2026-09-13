// safeFetch integration tests against local HTTP servers:
// redirect re-validation, loops, byte caps, timeouts, errors, cancellation.
import assert from "node:assert/strict";
import http from "node:http";
import { test, finish } from "./harness.mjs";
import { safeFetch, FetchBlockedError, FetchError } from "../src/fetch.ts";

function startServer(handler) {
	return new Promise((resolve) => {
		const server = http.createServer(handler);
		server.listen(0, "127.0.0.1", () => resolve(server));
	});
}

const port = (server) => server.address().port;

// A: 127.0.0.1 (explicitly allowed below). B: localhost (NOT in allowlist).
const serverA = await startServer((req, res) => {
	if (req.url === "/page") {
		res.writeHead(200, { "Content-Type": "text/html" });
		res.end("<html><body><h1>Page A</h1><p>hello from A</p></body></html>");
	} else if (req.url === "/to-b") {
		res.writeHead(302, { Location: `http://localhost:${serverBPort}/secret` });
		res.end();
	} else if (req.url === "/to-file") {
		res.writeHead(302, { Location: "file:///etc/passwd" });
		res.end();
	} else if (req.url === "/to-userinfo") {
		res.writeHead(302, { Location: `http://user@localhost:${serverBPort}/secret` });
		res.end();
	} else if (req.url === "/to-protorel") {
		res.writeHead(302, { Location: `//localhost:${serverBPort}/secret` });
		res.end();
	} else if (req.url === "/big") {
		res.writeHead(200, { "Content-Type": "text/plain" });
		const chunk = "x".repeat(4096);
		for (let i = 0; i < 32; i++) res.write(chunk); // 128KB
		res.end();
	} else if (req.url === "/slow") {
		// never responds
	} else if (req.url === "/notfound") {
		res.writeHead(404, { "Content-Type": "text/plain" });
		res.end("nope");
	} else {
		res.writeHead(200, { "Content-Type": "text/html" });
		res.end("<p>root A</p>");
	}
});

const serverB = await startServer((req, res) => {
	res.writeHead(200, { "Content-Type": "text/html" });
	res.end("<p>you should never see me</p>");
});

const serverAPort = port(serverA);
const serverBPort = port(serverB);

const allowlist = {
	allowedDomains: ["127.0.0.1"],
	allowSubdomains: true,
	blockPrivateNetworks: false,
};

const base = {
	timeoutMs: 5000,
	maxBytes: 1024 * 1024,
	maxRedirects: 5,
	allowlist,
};

await test("fetches an allowed host", async () => {
	const res = await safeFetch(`http://127.0.0.1:${serverAPort}/page`, base);
	assert.equal(res.status, 200);
	assert.ok(res.body.includes("hello from A"));
	assert.equal(res.redirects.length, 0);
	assert.ok(res.finalUrl.includes("/page"));
});

await test("redirect to a non-allowed host aborts at the hop", async () => {
	try {
		await safeFetch(`http://127.0.0.1:${serverAPort}/to-b`, base);
		assert.fail("should have thrown");
	} catch (err) {
		assert.ok(err instanceof FetchBlockedError, `expected FetchBlockedError, got ${err.constructor.name}: ${err.message}`);
		assert.match(err.message, /localhost/);
	}
});

await test("redirect to a non-http scheme (file://) aborts", async () => {
	try {
		await safeFetch(`http://127.0.0.1:${serverAPort}/to-file`, base);
		assert.fail("should have thrown");
	} catch (err) {
		assert.ok(err instanceof FetchBlockedError, `expected FetchBlockedError, got ${err.constructor.name}`);
		assert.match(err.message, /scheme/i);
	}
});

await test("redirect with userinfo in Location is validated on the real host", async () => {
	try {
		await safeFetch(`http://127.0.0.1:${serverAPort}/to-userinfo`, base);
		assert.fail("should have thrown");
	} catch (err) {
		assert.ok(err instanceof FetchBlockedError, `expected FetchBlockedError, got ${err.constructor.name}`);
		assert.match(err.message, /localhost/);
	}
});

await test("protocol-relative redirect Location is resolved and re-validated", async () => {
	try {
		await safeFetch(`http://127.0.0.1:${serverAPort}/to-protorel`, base);
		assert.fail("should have thrown");
	} catch (err) {
		assert.ok(err instanceof FetchBlockedError, `expected FetchBlockedError, got ${err.constructor.name}`);
		assert.match(err.message, /localhost/);
	}
});

await test("redirect loop is cut off by maxRedirects", async () => {
	// point /loop at itself via a dedicated handler
	const loopServer = await startServer((req, res) => {
		res.writeHead(302, { Location: `http://127.0.0.1:${port(loopServer)}/loop` });
		res.end();
	});
	try {
		await safeFetch(`http://127.0.0.1:${port(loopServer)}/loop`, { ...base, maxRedirects: 3 });
		assert.fail("should have thrown");
	} catch (err) {
		assert.ok(err instanceof FetchError, `expected FetchError, got ${err.constructor.name}`);
		assert.match(err.message, /too many redirects/);
	} finally {
		loopServer.close();
	}
});

await test("body is capped at maxBytes and marked truncated", async () => {
	const res = await safeFetch(`http://127.0.0.1:${serverAPort}/big`, { ...base, maxBytes: 8192 });
	assert.equal(res.bodyTruncated, true);
	assert.ok(res.body.length <= 8192);
	assert.equal(res.bytes, 8192);
});

await test("timeout produces a FetchError", async () => {
	try {
		await safeFetch(`http://127.0.0.1:${serverAPort}/slow`, { ...base, timeoutMs: 300 });
		assert.fail("should have thrown");
	} catch (err) {
		assert.ok(err instanceof FetchError);
		assert.match(err.message, /timed out/);
	}
});

await test("HTTP 404 surfaces as FetchError with status", async () => {
	try {
		await safeFetch(`http://127.0.0.1:${serverAPort}/notfound`, base);
		assert.fail("should have thrown");
	} catch (err) {
		assert.ok(err instanceof FetchError);
		assert.equal(err.status, 404);
	}
});

await test("initial URL outside allowlist is blocked before any request", async () => {
	let requests = 0;
	const spyServer = await startServer((req, res) => {
		requests += 1;
		res.writeHead(200);
		res.end("x");
	});
	try {
		try {
			await safeFetch(`http://localhost:${port(spyServer)}/`, base);
			assert.fail("should have thrown");
		} catch (err) {
			assert.ok(err instanceof FetchBlockedError);
		}
		assert.equal(requests, 0, "no request should reach a non-allowed host");
	} finally {
		spyServer.close();
	}
});

await test("non-http scheme is blocked", async () => {
	try {
		await safeFetch("file:///etc/passwd", base);
		assert.fail("should have thrown");
	} catch (err) {
		assert.ok(err instanceof FetchBlockedError);
		assert.match(err.message, /scheme/i);
	}
});

await test("caller abort cancels the fetch", async () => {
	const controller = new AbortController();
	const p = safeFetch(`http://127.0.0.1:${serverAPort}/slow`, { ...base, timeoutMs: 10000, signal: controller.signal });
	setTimeout(() => controller.abort(), 50);
	try {
		await p;
		assert.fail("should have thrown");
	} catch (err) {
		assert.ok(err instanceof FetchError);
		assert.match(err.message, /cancelled/);
	}
});

serverA.close();
serverB.close();
finish();
