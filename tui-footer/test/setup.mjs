// Registers an import alias so the extension's @earendil-works/pi-tui import
// resolves to the copy bundled with the installed pi package. (Inside pi, the
// extension loader provides this alias itself; standalone tests need it too.)
import { execSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { register } from "node:module";
import path from "node:path";

function piPkgRoot() {
	// 1. Explicit override
	if (process.env.PI_PKG_DIR) return process.env.PI_PKG_DIR;
	// 2. Derive from the pi binary on PATH (pi -> .../pi-coding-agent/dist/bundle/cli.js)
	try {
		const bin = execSync("command -v pi", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
		if (bin) return path.dirname(path.dirname(path.dirname(realpathSync(bin))));
	} catch {
		// no pi on PATH
	}
	throw new Error("Cannot locate the pi package. Set PI_PKG_DIR to its install directory.");
}

const entry = path.join(piPkgRoot(), "node_modules/@earendil-works/pi-tui/dist/index.js");
if (!existsSync(entry)) throw new Error(`pi-tui entry not found at ${entry}`);

// process.env is shared with the loader-hooks thread; globalThis is not.
process.env.PI_TUI_ENTRY = `file://${entry}`;
register("./hooks.mjs", import.meta.url);
