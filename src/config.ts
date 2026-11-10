import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Configuration comes from environment variables, optionally loaded from a
// .env file. Variables already set in the environment (for example in an MCP
// client's "env" block) take precedence over the file.
//
// The .env file is TRUELAYER_ENV_FILE if set, otherwise .env in the project
// root (next to package.json), so it is found no matter which directory the
// MCP client starts the server from.

const ENVIRONMENTS = {
	sandbox: {
		authUri: "https://auth.truelayer-sandbox.com/connect/token",
		apiUri: "https://api.truelayer-sandbox.com",
	},
	production: {
		authUri: "https://auth.truelayer.com/connect/token",
		apiUri: "https://api.truelayer.com",
	},
} as const;

type Environment = keyof typeof ENVIRONMENTS;

export interface Config {
	environment: Environment;
	authUri: string;
	apiUri: string;
	clientId: string;
	clientSecret: string;
	kid: string;
	privateKeyPem: string;
	merchantAccountId: string;
	tokenScope: string;
}

export class ConfigError extends Error {
	constructor(problems: string[]) {
		super(
			`Invalid TrueLayer MCP configuration:\n${problems.map((p) => `  - ${p}`).join("\n")}\nSee .env.example for the available settings.`,
		);
		this.name = "ConfigError";
	}
}

function loadEnvFile(): void {
	const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
	const explicit = process.env.TRUELAYER_ENV_FILE;
	const path = explicit ? expandHome(explicit) : resolve(projectRoot, ".env");
	if (existsSync(path)) {
		process.loadEnvFile(path);
	} else if (explicit) {
		throw new ConfigError([`TRUELAYER_ENV_FILE points to ${path}, which does not exist`]);
	}
}

function expandHome(path: string): string {
	return path === "~" || path.startsWith("~/") ? homedir() + path.slice(1) : path;
}

function env(name: string): string | undefined {
	const value = process.env[name]?.trim();
	return value ? value : undefined;
}

// Reads a value given either inline (NAME) or as a path to a file (NAME_FILE).
// Returns null when a problem was already recorded, so it isn't also reported
// as missing.
function valueOrFile(name: string, problems: string[]): string | undefined | null {
	const inline = env(name);
	const file = env(`${name}_FILE`);
	if (inline && file) {
		problems.push(`set only one of ${name} and ${name}_FILE`);
		return null;
	}
	if (file) {
		try {
			return readFileSync(expandHome(file), "utf8").trim();
		} catch (error) {
			problems.push(`${name}_FILE: cannot read ${file} (${(error as NodeJS.ErrnoException).code ?? error})`);
			return null;
		}
	}
	// Inline PEMs in .env files are often written on one line with literal \n.
	return inline?.replace(/\\n/g, "\n");
}

export function loadConfig(): Config {
	loadEnvFile();
	const problems: string[] = [];

	const environment = (env("TRUELAYER_ENV") ?? "sandbox").toLowerCase();
	if (!(environment in ENVIRONMENTS)) {
		problems.push(`TRUELAYER_ENV must be "sandbox" or "production", got "${environment}"`);
	}
	const defaults = ENVIRONMENTS[environment as Environment] ?? ENVIRONMENTS.sandbox;

	const required = (name: string, value: string | undefined | null): string => {
		if (value === undefined || value === "") problems.push(`${name} is required`);
		return value ?? "";
	};

	const config: Config = {
		environment: environment as Environment,
		// Overrides exist for testing against a local mock; normally leave unset.
		authUri: env("TRUELAYER_AUTH_URI") ?? defaults.authUri,
		apiUri: env("TRUELAYER_API_URI") ?? defaults.apiUri,
		clientId: required("TRUELAYER_CLIENT_ID", env("TRUELAYER_CLIENT_ID")),
		clientSecret: required(
			"TRUELAYER_CLIENT_SECRET (or TRUELAYER_CLIENT_SECRET_FILE)",
			valueOrFile("TRUELAYER_CLIENT_SECRET", problems),
		),
		kid: required("TRUELAYER_KID", env("TRUELAYER_KID")),
		privateKeyPem: required(
			"TRUELAYER_PRIVATE_KEY (or TRUELAYER_PRIVATE_KEY_FILE)",
			valueOrFile("TRUELAYER_PRIVATE_KEY", problems),
		),
		merchantAccountId: required("TRUELAYER_MERCHANT_ACCOUNT_ID", env("TRUELAYER_MERCHANT_ACCOUNT_ID")),
		// `paydirect` is needed for the payout tools; clients without Payouts
		// enabled get `invalid_scope` and should use "payments".
		tokenScope: env("TRUELAYER_TOKEN_SCOPE") ?? "paydirect payments",
	};

	if (config.privateKeyPem && !config.privateKeyPem.includes("-----BEGIN")) {
		problems.push("TRUELAYER_PRIVATE_KEY is not a PEM private key");
	}

	if (problems.length > 0) {
		throw new ConfigError(problems);
	}
	return Object.freeze(config);
}

let cached: Config | undefined;

// The configuration, loaded and validated on first use.
export function getConfig(): Config {
	if (cached === undefined) {
		cached = loadConfig();
	}
	return cached;
}
