// Tiny test harness shared by all test files (no framework dependency).
let passes = 0;
let failures = 0;
const failuresList = [];

export async function test(name, fn) {
	try {
		await fn();
		passes += 1;
		console.log(`  ok   - ${name}`);
	} catch (err) {
		failures += 1;
		failuresList.push({ name, err });
		console.error(`  FAIL - ${name}\n         ${String(err.message).split("\n").join("\n         ")}`);
	}
}

export function finish() {
	console.log(`\n${passes} passed, ${failures} failed`);
	if (failures > 0) {
		process.exitCode = 1;
	}
}
