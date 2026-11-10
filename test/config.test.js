import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { emptyEnvFile, serverPath } from "./helpers/mcp.js";
import { keys } from "./helpers/mock-truelayer.js";

// Starts the server with stdin closed and returns its exit code and stderr.
function startWith(env) {
	const result = spawnSync(process.execPath, [serverPath], {
		env: { PATH: process.env.PATH, TRUELAYER_ENV_FILE: emptyEnvFile, ...env },
		input: "",
		encoding: "utf8",
		timeout: 10000,
	});
	return { code: result.status, stderr: result.stderr };
}

const valid = {
	TRUELAYER_CLIENT_ID: "client",
	TRUELAYER_CLIENT_SECRET: "secret",
	TRUELAYER_KID: "kid",
	TRUELAYER_PRIVATE_KEY: keys.privateKey,
	TRUELAYER_MERCHANT_ACCOUNT_ID: "merchant",
};

test("lists every missing setting and exits 1", () => {
	const { code, stderr } = startWith({});
	assert.equal(code, 1);
	for (const name of [
		"TRUELAYER_CLIENT_ID",
		"TRUELAYER_CLIENT_SECRET",
		"TRUELAYER_KID",
		"TRUELAYER_PRIVATE_KEY",
		"TRUELAYER_MERCHANT_ACCOUNT_ID",
	]) {
		assert.match(stderr, new RegExp(`${name}.* is required`));
	}
});

test("rejects an unknown environment", () => {
	const { code, stderr } = startWith({ ...valid, TRUELAYER_ENV: "staging" });
	assert.equal(code, 1);
	assert.match(stderr, /TRUELAYER_ENV must be "sandbox" or "production", got "staging"/);
});

test("reports an unreadable secret file once, not also as missing", () => {
	const { code, stderr } = startWith({
		...valid,
		TRUELAYER_CLIENT_SECRET: "",
		TRUELAYER_CLIENT_SECRET_FILE: "/nonexistent/secret",
	});
	assert.equal(code, 1);
	assert.match(stderr, /TRUELAYER_CLIENT_SECRET_FILE: cannot read \/nonexistent\/secret \(ENOENT\)/);
	assert.doesNotMatch(stderr, /TRUELAYER_CLIENT_SECRET \(or TRUELAYER_CLIENT_SECRET_FILE\) is required/);
});

test("rejects a key given both inline and as a file", () => {
	const { code, stderr } = startWith({ ...valid, TRUELAYER_PRIVATE_KEY_FILE: "/some/key.pem" });
	assert.equal(code, 1);
	assert.match(stderr, /set only one of TRUELAYER_PRIVATE_KEY and TRUELAYER_PRIVATE_KEY_FILE/);
});

test("rejects a private key that isn't PEM", () => {
	const { code, stderr } = startWith({ ...valid, TRUELAYER_PRIVATE_KEY: "not-a-key" });
	assert.equal(code, 1);
	assert.match(stderr, /TRUELAYER_PRIVATE_KEY is not a PEM private key/);
});

test("fails when TRUELAYER_ENV_FILE points to a missing file", () => {
	const { code, stderr } = startWith({ ...valid, TRUELAYER_ENV_FILE: "/nonexistent/.env" });
	assert.equal(code, 1);
	assert.match(stderr, /TRUELAYER_ENV_FILE points to \/nonexistent\/.env, which does not exist/);
});

test("starts with a valid configuration, defaulting to sandbox", () => {
	const { stderr } = startWith(valid);
	assert.match(stderr, /using the sandbox environment/);
	assert.match(stderr, /running on stdio/);
});

test("accepts a PEM key written on one line with literal \\n", () => {
	const { stderr } = startWith({ ...valid, TRUELAYER_PRIVATE_KEY: keys.privateKey.trim().replace(/\n/g, "\\n") });
	assert.match(stderr, /running on stdio/);
});
