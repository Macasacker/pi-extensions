// Resolves @earendil-works/pi-tui to the installed pi package's copy.
export async function resolve(specifier, context, next) {
	if (specifier === "@earendil-works/pi-tui" && process.env.PI_TUI_ENTRY) {
		return next(process.env.PI_TUI_ENTRY, context);
	}
	return next(specifier, context);
}
