// Terminal-escape sanitization: untrusted web content and LLM-supplied
// strings must not carry OSC/CSI/escape sequences into the TUI.
import assert from "node:assert/strict";
import { test, finish } from "./harness.mjs";
import { sanitizeForTui } from "../src/sanitize.ts";
import { extractReadableText } from "../src/extract.ts";

await test("OSC 52 clipboard-write sequence is fully stripped", () => {
	assert.equal(sanitizeForTui("A\x1b]52;c;PAYLOAD\x07B"), "AB");
});

await test("OSC sequence terminated by ST (ESC \\) is stripped", () => {
	assert.equal(sanitizeForTui("A\x1b]0;fake title\x1b\\B"), "AB");
});

await test("unterminated OSC drops the remainder (fail closed)", () => {
	assert.equal(sanitizeForTui("A\x1b]52;c;PAYLOAD"), "A");
});

await test("CSI color sequence is stripped", () => {
	assert.equal(sanitizeForTui("A\x1b[31mB\x1b[0mC"), "ABC");
});

await test("CSI cursor movement is stripped", () => {
	assert.equal(sanitizeForTui("A\x1b[2J\x1b[H B"), "A B");
});

await test("CSI with intermediate byte and high final byte (\x1b[?25l) is stripped", () => {
	assert.equal(sanitizeForTui("cursor\x1b[?25lhidden"), "cursorhidden");
});

await test("plain two-char escape is stripped", () => {
	assert.equal(sanitizeForTui("A\x1b(B"), "AB");
});

await test("C0 controls dropped except \\n and \\t", () => {
	assert.equal(sanitizeForTui("A\x01B\nC\tD\x1bE"), "AB\nC\tD");
});

await test("DEL is dropped", () => {
	assert.equal(sanitizeForTui("A\x7fB"), "AB");
});

await test("plain text (incl. unicode) passes through unchanged", () => {
	const plainText = "héllo wörld — ✓ 100% <b>bold</b>";
	assert.equal(sanitizeForTui(plainText), plainText);
});

await test("extraction sanitizes escape bytes from page title and text", () => {
	const html = `<html><head><title>Clean\x1b]52;c;EVIL\x07Title</title></head><body><article><h1>H\x1b[2J\x1b[Heading</h1><p>p\x01ara</p></article></body></html>`;
	const { title, text } = extractReadableText(html);
	assert.equal(title, "CleanTitle");
	assert.ok(!title.includes("\x1b"));
	assert.ok(!text.includes("\x1b"));
	assert.ok(!text.includes("\x01"));
	assert.ok(text.includes("Heading"));
	assert.ok(text.includes("para"));
});

finish();
