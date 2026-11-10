// Read-only checks against the real TrueLayer sandbox, using your .env.
// Skipped unless TRUELAYER_SANDBOX_TESTS=1 (see `npm run test:sandbox`).
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { startServer } from "./helpers/mcp.js";

const enabled = process.env.TRUELAYER_SANDBOX_TESTS === "1";

describe("sandbox", { skip: !enabled && "set TRUELAYER_SANDBOX_TESTS=1 to run against the sandbox" }, () => {
	let server;
	before(async () => {
		// Pass the developer's environment through, so .env (or TRUELAYER_ENV_FILE) is used.
		server = await startServer({ ...process.env, TRUELAYER_ENV: "sandbox" });
	});
	after(() => server?.close());

	test("get-merchant-account returns the configured account", async () => {
		const result = await server.call("truelayer-get-merchant-account");
		assert.equal(result.isError, false, result.text);
		assert.ok(result.json.id);
		assert.ok(result.json.currency);
	});

	test("list-merchant-accounts includes it", async () => {
		const account = (await server.call("truelayer-get-merchant-account")).json;
		const result = await server.call("truelayer-list-merchant-accounts");
		assert.equal(result.isError, false, result.text);
		assert.ok(result.json.items.some((a) => a.id === account.id));
	});

	test("list-transactions succeeds for the configured account", async () => {
		const account = (await server.call("truelayer-get-merchant-account")).json;
		const result = await server.call("truelayer-list-transactions", { merchant_account_id: account.id });
		assert.equal(result.isError, false, result.text);
		assert.ok(Array.isArray(result.json.items));
	});

	test("an unknown payment is reported as a 404 tool error", async () => {
		const result = await server.call("truelayer-get-payment", { paymentId: "00000000-0000-0000-0000-000000000000" });
		assert.equal(result.isError, true);
		assert.match(result.text, /HTTP 404/);
	});
});
