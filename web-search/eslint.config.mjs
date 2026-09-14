// Flat ESLint config for the web-search package.
// TypeScript via typescript-eslint (recommended rules); test files get a few
// test-appropriate relaxations.
import tseslint from "typescript-eslint";

export default tseslint.config(
	{
		ignores: ["node_modules/**"],
	},
	...tseslint.configs.recommended,
	{
		files: ["**/*.ts"],
		languageOptions: {
			parserOptions: {
				project: "./tsconfig.json",
				tsconfigRootDir: import.meta.dirname,
			},
		},
		rules: {
			// The extension entry takes (pi: ExtensionAPI) — pi's own API shape.
			"@typescript-eslint/no-unused-vars": [
				"error",
				{ argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
			],
		},
	},
	{
		files: ["test/**"],
		rules: {
			// Tests intentionally use short local names for fixtures and assert
			// on raw values; keep the gate about real defects, not style.
			"@typescript-eslint/no-unsafe-argument": "off",
			"@typescript-eslint/no-unsafe-assignment": "off",
			"@typescript-eslint/no-unsafe-call": "off",
		},
	},
);
