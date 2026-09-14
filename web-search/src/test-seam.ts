/**
 * Documented test seam: substitute the search provider so tests run without
 * network.
 *
 * Pi extensions are singletons per process, and the tool-registration API
 * offers no dependency-injection hook, so the provider override is module
 * state. It lives in its own module so production code (index.ts) only
 * imports a getter/setter pair, never test machinery.
 *
 * `index.ts` re-exports `setTestProvider` so the e2e surface
 * (`test/e2e.test.mjs` imports it from `../index.ts`) is unchanged.
 */

import type { SearchProvider } from "./providers/types.ts";

let providerOverride: SearchProvider | undefined;

export function setTestProvider(provider: SearchProvider | undefined): void {
	providerOverride = provider;
}

export function getTestProvider(): SearchProvider | undefined {
	return providerOverride;
}
