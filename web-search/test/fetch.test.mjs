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

// allowedServer: 127.0.0.1 (explicitly allowed below). disallowedServer: localhost (NOT in allowlist).
const allowedServer = await startServer((request, response) => {
	if (request.url === "/page") {
		response.writeHead(200, { "Content-Type": "text/html" });
		response.end("<html><body><h1>Page A</h1><p>hello from A</p></body></html>");
	} else if (request.url === "/to-b") {
		response.writeHead(302, { Location: `http://localhost:${disallowedServerPort}/secret` });
		response.end();
	} else if (request.url === "/to-file") {
		response.writeHead(302, { Location: "file:///etc/passwd" });
		response.end();
	} else if (request.url === "/to-userinfo") {
		response.writeHead(302, { Location: `http://user@localhost:${disallowedServerPort}/secret` });
		response.end();
	} else if (request.url === "/to-protorel") {
		response.writeHead(302, { Location: `//localhost:${disallowedServerPort}/secret` });
		response.end();
	} else if (request.url === "/big") {
		response.writeHead(200, { "Content-Type": "text/plain" });
		const chunk = "x".repeat(4096);
		for (let chunkIndex = 0; chunkIndex < 32; chunkIndex++) response.write(chunk); // 128KB
		response.end();
	} else if (request.url === "/slow") {
		// never responds
	} else if (request.url === "/notfound") {
		response.writeHead(404, { "Content-Type": "text/plain" });
		response.end("nope");
	} else {
		response.writeHead(200, { "Content-Type": "text/html" });
		response.end("<p>root A</p>");
	}
});

const disallowedServer = await startServer((request, response) => {
	response.writeHead(200, { "Content-Type": "text/html" });
	response.end("<p>you should never see me</p>");
});

const allowedServerPort = port(allowedServer);
const disallowedServerPort = port(disallowedServer);

const allowlist = {
	allowedDomains: ["127.0.0.1"],
	allowSubdomains: true,
	blockPrivateNetworks: false,
};

const defaultFetchOptions = {
	timeoutMs: 5000,
	maxBytes: 1024 * 1024,
	maxRedirects: 5,
	allowlist,
};

await test("fetches an allowed host", async () => {
	const fetchResult = await safeFetch(`http://127.0.0.1:${allowedServerPort}/page`, defaultFetchOptions);
	assert.equal(fetchResult.status, 200);
	assert.ok(fetchResult.body.includes("hello from A"));
	assert.equal(fetchResult.redirects.length, 0);
	assert.ok(fetchResult.finalUrl.includes("/page"));
});

await test("redirect to a non-allowed host aborts at the hop", async () => {
	try {
		await safeFetch(`http://127.0.0.1:${allowedServerPort}/to-b`, defaultFetchOptions);
		assert.fail("should have thrown");
	} catch (error) {
		assert.ok(error instanceof FetchBlockedError, `expected FetchBlockedError, got ${error.constructor.name}: ${error.message}`);
		assert.match(error.message, /localhost/);
	}
});

await test("redirect to a non-http scheme (file://) aborts", async () => {
	try {
		await safeFetch(`http://127.0.0.1:${allowedServerPort}/to-file`, defaultFetchOptions);
		assert.fail("should have thrown");
	} catch (error) {
		assert.ok(error instanceof FetchBlockedError, `expected FetchBlockedError, got ${error.constructor.name}`);
		assert.match(error.message, /scheme/i);
	}
});

await test("redirect with userinfo in Location is validated on the real host", async () => {
	try {
		await safeFetch(`http://127.0.0.1:${allowedServerPort}/to-userinfo`, defaultFetchOptions);
		assert.fail("should have thrown");
	} catch (error) {
		assert.ok(error instanceof FetchBlockedError, `expected FetchBlockedError, got ${error.constructor.name}`);
		assert.match(error.message, /localhost/);
	}
});

await test("protocol-relative redirect Location is resolved and re-validated", async () => {
	try {
		await safeFetch(`http://127.0.0.1:${allowedServerPort}/to-protorel`, defaultFetchOptions);
		assert.fail("should have thrown");
	} catch (error) {
		assert.ok(error instanceof FetchBlockedError, `expected FetchBlockedError, got ${error.constructor.name}`);
		assert.match(error.message, /localhost/);
	}
});

await test("redirect loop is cut off by maxRedirects", async () => {
	// point /loop at itself via a dedicated handler
	const loopServer = await startServer((request, response) => {
		response.writeHead(302, { Location: `http://127.0.0.1:${port(loopServer)}/loop` });
		response.end();
	});
	try {
		await safeFetch(`http://127.0.0.1:${port(loopServer)}/loop`, { ...defaultFetchOptions, maxRedirects: 3 });
		assert.fail("should have thrown");
	} catch (error) {
		assert.ok(error instanceof FetchError, `expected FetchError, got ${error.constructor.name}`);
		assert.match(error.message, /too many redirects/);
	} finally {
		loopServer.close();
	}
});

await test("body is capped at maxBytes and marked truncated", async () => {
	const fetchResult = await safeFetch(`http://127.0.0.1:${allowedServerPort}/big`, { ...defaultFetchOptions, maxBytes: 8192 });
	assert.equal(fetchResult.bodyTruncated, true);
	assert.ok(fetchResult.body.length <= 8192);
	assert.equal(fetchResult.bytes, 8192);
});

await test("timeout produces a FetchError", async () => {
	try {
		await safeFetch(`http://127.0.0.1:${allowedServerPort}/slow`, { ...defaultFetchOptions, timeoutMs: 300 });
		assert.fail("should have thrown");
	} catch (error) {
		assert.ok(error instanceof FetchError);
		assert.match(error.message, /timed out/);
	}
});

await test("HTTP 404 surfaces as FetchError with status", async () => {
	try {
		await safeFetch(`http://127.0.0.1:${allowedServerPort}/notfound`, defaultFetchOptions);
		assert.fail("should have thrown");
	} catch (error) {
		assert.ok(error instanceof FetchError);
		assert.equal(error.status, 404);
	}
});

await test("initial URL outside allowlist is blocked before any request", async () => {
	let requests = 0;
	const spyServer = await startServer((request, response) => {
		requests += 1;
		response.writeHead(200);
		response.end("x");
	});
	try {
		try {
			await safeFetch(`http://localhost:${port(spyServer)}/`, defaultFetchOptions);
			assert.fail("should have thrown");
		} catch (error) {
			assert.ok(error instanceof FetchBlockedError);
		}
		assert.equal(requests, 0, "no request should reach a non-allowed host");
	} finally {
		spyServer.close();
	}
});

await test("non-http scheme is blocked", async () => {
	try {
		await safeFetch("file:///etc/passwd", defaultFetchOptions);
		assert.fail("should have thrown");
	} catch (error) {
		assert.ok(error instanceof FetchBlockedError);
		assert.match(error.message, /scheme/i);
	}
});

await test("caller abort cancels the fetch", async () => {
	const controller = new AbortController();
	const fetchPromise = safeFetch(`http://127.0.0.1:${allowedServerPort}/slow`, { ...defaultFetchOptions, timeoutMs: 10000, signal: controller.signal });
	setTimeout(() => controller.abort(), 50);
	try {
		await fetchPromise;
		assert.fail("should have thrown");
	} catch (error) {
		assert.ok(error instanceof FetchError);
		assert.match(error.message, /cancelled/);
	}
});

allowedServer.close();
disallowedServer.close();
finish();
