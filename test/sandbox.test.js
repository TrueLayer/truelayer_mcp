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

	// Creates 1p payments that are never authorised, so no money moves. Set
	// TRUELAYER_SANDBOX_RETURN_URI if https://console.truelayer.com/redirect-page
	// isn't registered for your client in Console.
	describe("payments", () => {
		const returnUri = process.env.TRUELAYER_SANDBOX_RETURN_URI ?? "https://console.truelayer.com/redirect-page";
		const user = { name: "Sandbox Test", email: "sandbox.test@example.com" };

		test("provider search finds the GB mock bank", async () => {
			const result = await server.call("truelayer-search-payments-providers", {
				countries: ["GB"],
				currencies: ["GBP"],
				release_channel: "private_beta",
			});
			assert.equal(result.isError, false, result.text);
			assert.ok(result.json.items.some((p) => p.id === "mock-payments-gb-redirect"));
		});

		test("a payment's authorization flow reaches the bank redirect", async () => {
			const created = await server.call("truelayer-create-payment", { amount_in_minor: 1, currency: "GBP", user });
			assert.equal(created.isError, false, created.text);
			assert.equal(created.json.status, "authorization_required");

			const started = await server.call("truelayer-start-payment-authorization", {
				payment_id: created.json.id,
				provider_selection: {},
				redirect: { return_uri: returnUri },
			});
			assert.equal(started.isError, false, started.text);
			assert.equal(started.json.authorization_flow.actions.next.type, "provider_selection");

			const selected = await server.call("truelayer-submit-payment-action", {
				payment_id: created.json.id,
				action: { type: "provider_selection", provider_id: "mock-payments-gb-redirect" },
			});
			assert.equal(selected.isError, false, selected.text);
			assert.equal(selected.json.authorization_flow.actions.next.type, "redirect");
			assert.match(selected.json.authorization_flow.actions.next.uri, /^https:\/\//);
		});

		test("a cancelled payment fails with failure_reason canceled", async () => {
			const created = await server.call("truelayer-create-payment", { amount_in_minor: 1, currency: "GBP", user });
			assert.equal(created.isError, false, created.text);
			const cancelled = await server.call("truelayer-cancel-payment", { payment_id: created.json.id });
			assert.equal(cancelled.isError, false, cancelled.text);

			let payment;
			for (let attempt = 0; attempt < 10; attempt++) {
				payment = (await server.call("truelayer-get-payment", { paymentId: created.json.id })).json;
				if (payment.status === "failed") break;
				await new Promise((resolve) => setTimeout(resolve, 500));
			}
			assert.equal(payment.status, "failed");
			assert.equal(payment.failure_reason, "canceled");
		});
	});
});
