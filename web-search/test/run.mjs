// Test runner: executes each test file in order (they self-run on import).
const files = [
	"domains.test.mjs",
	"config.test.mjs",
	"sanitize.test.mjs",
	"extract.test.mjs",
	"providers.test.mjs",
	"fetch.test.mjs",
	"e2e.test.mjs",
];

for (const f of files) {
	console.log(`\n# ${f}`);
	await import(`./${f}`);
}

const { finish } = await import("./harness.mjs");
finish();
