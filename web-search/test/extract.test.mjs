// HTML → readable text extraction + truncation.
import assert from "node:assert/strict";
import { test, finish } from "./harness.mjs";
import { extractReadableText, truncateText } from "../src/extract.ts";

const FIXTURE = `
<html>
  <head><title>  Test Page Title  </title><style>body{color:red}</style></head>
  <body>
    <nav><a href="/">Home</a><a href="/about">About</a></nav>
    <article>
      <h1>Main Heading</h1>
      <p>First   paragraph
         with extra spaces.</p>
      <p>Second paragraph.</p>
      <ul><li>item one</li><li>item two</li></ul>
      <script>var evil = "SHOULD_NOT_APPEAR";</script>
    </article>
    <footer><p>FOOTER_TEXT</p></footer>
  </body>
</html>`;

await test("extracts article text, drops script/style/nav/footer", () => {
	const { title, text } = extractReadableText(FIXTURE);
	assert.equal(title, "Test Page Title");
	assert.ok(text.includes("Main Heading"));
	assert.ok(text.includes("First paragraph with extra spaces."));
	assert.ok(text.includes("Second paragraph."));
	assert.ok(text.includes("item one"));
	assert.ok(!text.includes("SHOULD_NOT_APPEAR"), "script content must be dropped");
	assert.ok(!text.includes("color:red"), "style content must be dropped");
	assert.ok(!text.includes("FOOTER_TEXT"), "footer must be dropped");
	assert.ok(!text.includes("About"), "nav must be dropped");
});

await test("falls back to <body> when no <article>/<main>", () => {
	const { text } = extractReadableText("<html><body><p>plain body text</p></body></html>");
	assert.ok(text.includes("plain body text"));
});

await test("block boundaries become newlines", () => {
	const { text } = extractReadableText("<html><body><p>a</p><p>b</p></body></html>");
	assert.ok(text.includes("a\nb") || text.includes("a\n\nb"));
});

await test("handles empty/malformed HTML without throwing", () => {
	assert.equal(extractReadableText("").text, "");
	assert.equal(extractReadableText("<<<garbage>>>").text.length >= 0, true);
});

await test("truncateText keeps head and flags truncation", () => {
	const input = Array.from({ length: 100 }, (_, i) => `line${i}`).join("\n");
	const t = truncateText(input, 200, 5);
	assert.equal(t.truncated, true);
	assert.ok(t.content.startsWith("line0"));
	assert.ok(!t.content.includes("line99"));
	assert.ok(t.content.length <= 200);
});

await test("truncateText passes short text through", () => {
	const t = truncateText("short", 100);
	assert.equal(t.truncated, false);
	assert.equal(t.content, "short");
});

finish();
