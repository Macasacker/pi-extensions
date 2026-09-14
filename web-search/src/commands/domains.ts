/**
 * /web-search-domains command: show the effective domain allowlist, and add
 * or remove domains in the global or (trusted-project) settings.
 *
 * Add and remove share one validation sequence — multi-token check →
 * sanitize → trust gate → settings write → drift-baseline refresh → notify.
 * The two actions differ only in the settings mutation and the final message,
 * which live in the per-action strategy below. A successful write also
 * refreshes the session's drift baseline (noteAllowlistChange), so the next
 * tool call does not flag the user's own change as out-of-band.
 */

import { Text, matchesKey } from "@earendil-works/pi-tui";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	globalSettingsPath,
	loadConfig,
	projectSettingsPath,
	sanitizeDomainEntry,
	updateSettingsDomains,
	type LoadedConfig,
} from "../config.ts";
import type { SessionState } from "../session.ts";

/** An add/remove invocation carrying its raw domain tokens. */
export interface DomainChangeCommand {
	action: "add" | "remove";
	/** Non-flag tokens after the action word; more than one is a usage error. */
	domainTokens: string[];
	projectScope: boolean;
}

/** A list invocation (no action, an unknown action, or add/remove without a domain). */
export interface DomainListCommand {
	action: "list";
	projectScope: boolean;
}

export type DomainCommand = DomainChangeCommand | DomainListCommand;

/**
 * Parse the raw command tokens. `--project` may appear anywhere and sets the
 * project scope; non-flag tokens after the action word form the domain.
 * `add`/`remove` without a domain token fall through to the list view.
 */
export function parseDomainCommandArgs(tokens: string[]): DomainCommand {
	const projectScope = tokens.includes("--project");
	const domainTokens = tokens.slice(1).filter((token) => !token.startsWith("--"));
	const actionWord = tokens[0];
	if ((actionWord === "add" || actionWord === "remove") && domainTokens.length > 0) {
		return { action: actionWord, domainTokens, projectScope };
	}
	return { action: "list", projectScope };
}

/**
 * The per-action difference between add and remove: the untrusted-project
 * message, the settings mutation, and the success message. Everything else
 * in the validation sequence is shared in applyDomainChange.
 */
interface DomainChangeStrategy {
	untrustedProjectMessage: string;
	mutateAllowlist: (allowlist: string[], domain: string) => string[];
	successMessage: (domain: string, scope: "project" | "global") => string;
}

const DOMAIN_CHANGE_STRATEGIES: Record<DomainChangeCommand["action"], DomainChangeStrategy> = {
	add: {
		untrustedProjectMessage: "Project is not trusted; cannot modify project settings. Use global scope (omit --project).",
		mutateAllowlist: (allowlist, domain) =>
			allowlist.some((existingDomain) => existingDomain.toLowerCase() === domain) ? allowlist : [...allowlist, domain],
		successMessage: (domain, scope) => `Added ${domain} to ${scope} allowlist — effective immediately`,
	},
	remove: {
		untrustedProjectMessage: "Project is not trusted; cannot modify project settings.",
		mutateAllowlist: (allowlist, domain) => allowlist.filter((existingDomain) => existingDomain.toLowerCase() !== domain),
		successMessage: (domain, scope) => `Removed ${domain} from ${scope} allowlist — effective immediately`,
	},
};

export interface DomainChangeDeps {
	ctx: ExtensionContext;
	session: SessionState;
}

/**
 * Run the shared add/remove validation sequence once: reject multi-token and
 * invalid domains, refuse project-scope changes on an untrusted project, then
 * apply the action's mutation to the target settings file, refresh the
 * session's drift baseline, and notify the user.
 */
export function applyDomainChange(command: DomainChangeCommand, deps: DomainChangeDeps): void {
	const { ctx, session } = deps;
	const { action, domainTokens, projectScope } = command;
	const strategy = DOMAIN_CHANGE_STRATEGIES[action];

	if (domainTokens.length > 1) {
		ctx.ui.notify(`Domains can't contain spaces. Did you mean: /web-search-domains ${action} ${domainTokens[0]}?`, "error");
		return;
	}
	const domain = sanitizeDomainEntry(domainTokens[0]);
	if (!domain) {
		ctx.ui.notify(`Invalid domain: ${domainTokens[0]}`, "error");
		return;
	}
	if (projectScope && !(ctx.isProjectTrusted?.() ?? false)) {
		ctx.ui.notify(strategy.untrustedProjectMessage, "error");
		return;
	}
	const targetFile = projectScope ? projectSettingsPath(ctx.cwd) : globalSettingsPath();
	updateSettingsDomains(targetFile, (allowlist) => strategy.mutateAllowlist(allowlist, domain));
	noteAllowlistChange(ctx, session);
	ctx.ui.notify(strategy.successMessage(domain, projectScope ? "project" : "global"), "info");
}

/**
 * Refresh the session's drift baseline after the command writes settings, so
 * a user-initiated change does not trigger the drift warning on the next
 * tool call.
 */
function noteAllowlistChange(ctx: ExtensionContext, session: SessionState): void {
	try {
		session.lastAllowlist = [...loadConfig({ cwd: ctx.cwd, projectTrusted: ctx.isProjectTrusted?.() ?? false }).config.allowedDomains].sort();
	} catch {
		session.lastAllowlist = null;
	}
}

/** Build the list-view summary: per-source domains, the active options, and the usage line. */
export function buildDomainListSummary(loadedConfig: LoadedConfig): string {
	const { config } = loadedConfig;
	const lines: string[] = ["web-search allowed domains:"];
	for (const source of loadedConfig.domainSources) {
		lines.push(`  ${source.path === "(built-in)" ? "built-in defaults" : source.path}:`);
		for (const domain of source.domains) lines.push(`    ${domain}`);
	}
	if (loadedConfig.domainSources.length === 0) lines.push("  (none — every fetch will be blocked)");
	lines.push("");
	lines.push(
		`options: subdomains=${config.allowSubdomains} confirmOutsideAllowlist=${config.confirmOutsideAllowlist} privateNetworks=${config.blockPrivateNetworks ? "blocked" : "allowed"} provider=${config.provider}`,
	);
	lines.push("");
	lines.push("usage: /web-search-domains add <domain> [--project] | remove <domain> [--project]");
	return lines.join("\n");
}

/**
 * Show the list view: a dismissable dialog in the TUI, a plain notification
 * in other modes with a UI (and nothing without one).
 */
export async function showDomainList(loadedConfig: LoadedConfig, ctx: ExtensionContext): Promise<void> {
	const summary = buildDomainListSummary(loadedConfig);
	if (ctx.mode === "tui") {
		await ctx.ui.custom<string | null>((_tui, _theme, _keybindings, done) => {
			return new DismissableText(summary, () => done(null));
		});
	} else if (ctx.hasUI) {
		ctx.ui.notify(summary, "info");
	}
}

// A Text component that dismisses itself on escape/enter/ctrl+c. pi-tui
// dispatches keyboard input via handleInput(data) on the focused component —
// the Component interface has no onKey property, so a plain Text would
// never receive keys and the dialog could not be dismissed.
export class DismissableText extends Text {
	private readonly onDismiss: () => void;

	constructor(text: string, onDismiss: () => void) {
		super(text, 1, 1);
		this.onDismiss = onDismiss;
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape") || matchesKey(data, "return") || matchesKey(data, "ctrl+c")) {
			this.onDismiss();
		}
	}
}
