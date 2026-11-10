import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import { MERCHANT_ACCOUNT_ID, startServer, testEnv } from "./helpers/mcp.js";
import { startMockTrueLayer } from "./helpers/mock-truelayer.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

let mock;
let server;

before(async () => {
	mock = await startMockTrueLayer();
	server = await startServer(testEnv(mock));
});
after(async () => {
	await server?.close();
	await mock?.close();
});
beforeEach(() => mock.reset());

describe("tool list", () => {
	test("every tool has a title and annotations matching what it does", async () => {
		const { tools } = await server.client.listTools();
		const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
		for (const tool of tools) {
			assert.ok(tool.title, `${tool.name} has a title`);
			assert.equal(tool.annotations?.openWorldHint, true, `${tool.name} is open-world`);
		}
		for (const name of [
			"truelayer-get-merchant-account",
			"truelayer-list-merchant-accounts",
			"truelayer-list-transactions",
			"truelayer-get-payment",
			"truelayer-get-payment-link",
			"truelayer-get-payout",
		]) {
			assert.equal(byName[name]?.annotations.readOnlyHint, true, `${name} is read-only`);
		}
		assert.equal(byName["truelayer-create-payout"].annotations.destructiveHint, true);
		assert.equal(byName["truelayer-create-payment-link"].annotations.readOnlyHint, false);
		assert.equal(byName["truelayer-create-payment-link"].annotations.destructiveHint, false);
	});
});

describe("authentication", () => {
	test("requests a client_credentials token with the configured scope, and reuses it", async () => {
		const fresh = await startServer(testEnv(mock, { TRUELAYER_TOKEN_SCOPE: "payments" }));
		try {
			mock.route("GET", "/v3/payments/:id", (_req, { id }) => ({ body: { id } }));
			await fresh.call("truelayer-get-payment", { paymentId: "p1" });
			await fresh.call("truelayer-get-payment", { paymentId: "p2" });

			const tokenRequests = mock.requests.filter((r) => r.path === "/connect/token");
			assert.equal(tokenRequests.length, 1, "the token is cached");
			assert.deepEqual(tokenRequests[0].body, {
				client_id: "test-client",
				client_secret: "test-secret",
				scope: "payments",
				grant_type: "client_credentials",
			});
			assert.equal(tokenRequests[0].headers["tl-signature"], undefined, "token requests aren't signed");
			assert.equal(mock.apiRequests()[0].headers.authorization, "Bearer token:payments");
		} finally {
			await fresh.close();
		}
	});

	test("sends TL-Agent on token and API requests", async () => {
		const fresh = await startServer(testEnv(mock));
		try {
			mock.route("GET", "/v3/payments/:id", (_req, { id }) => ({ body: { id } }));
			await fresh.call("truelayer-get-payment", { paymentId: "p1" });
			for (const request of mock.requests) {
				assert.match(request.headers["tl-agent"], /^truelayer-mcp\/\d+\.\d+\.\d+ \(Node\/\d+/);
			}
		} finally {
			await fresh.close();
		}
	});

	test("retries once with a fresh token when the API answers 401", async () => {
		const fresh = await startServer(testEnv(mock));
		try {
			let calls = 0;
			mock.route("GET", "/v3/payments/:id", (_req, { id }) => {
				calls += 1;
				return calls === 1 ? { status: 401, body: { title: "Unauthenticated" } } : { body: { id } };
			});
			const result = await fresh.call("truelayer-get-payment", { paymentId: "p1" });
			assert.equal(result.isError, false, result.text);
			assert.deepEqual(result.json, { id: "p1" });
			assert.equal(mock.requests.filter((r) => r.path === "/connect/token").length, 2, "a new token was fetched");
		} finally {
			await fresh.close();
		}
	});

	test("gives up after a second 401", async () => {
		mock.route("GET", "/v3/payments/:id", () => ({ status: 401, body: { title: "Unauthenticated" } }));
		const result = await server.call("truelayer-get-payment", { paymentId: "p1" });
		assert.equal(result.isError, true);
		assert.match(result.text, /HTTP 401/);
		assert.equal(mock.apiRequests().length, 2);
	});

	test("reports a rejected token request as a tool error", async () => {
		mock.allowScopes(["payments"]);
		const fresh = await startServer(testEnv(mock));
		try {
			const result = await fresh.call("truelayer-get-payment", { paymentId: "p1" });
			assert.equal(result.isError, true);
			assert.match(result.text, /POST \/connect\/token failed with HTTP 400: {"error":"invalid_scope"}/);
		} finally {
			await fresh.close();
		}
	});
});

describe("merchant accounts", () => {
	test("get-merchant-account defaults to the configured account and adds the client ID", async () => {
		mock.route("GET", "/v3/merchant-accounts/:id", (_req, { id }) => ({ body: { id, currency: "GBP" } }));
		const result = await server.call("truelayer-get-merchant-account");
		assert.equal(result.isError, false);
		assert.deepEqual(result.json, { client_id: "test-client", id: MERCHANT_ACCOUNT_ID, currency: "GBP" });
	});

	test("get-merchant-account reports a 404 as an error with TrueLayer's problem details", async () => {
		mock.route("GET", "/v3/merchant-accounts/:id", () => ({ status: 404, body: { title: "Not Found" } }));
		const result = await server.call("truelayer-get-merchant-account", { merchant_account_id: "missing" });
		assert.equal(result.isError, true);
		assert.match(result.text, /GET \/v3\/merchant-accounts\/missing failed with HTTP 404: {"title":"Not Found"}/);
	});

	test("list-merchant-accounts returns the API response", async () => {
		mock.route("GET", "/v3/merchant-accounts", () => ({ body: { items: [{ id: "m1" }] } }));
		const result = await server.call("truelayer-list-merchant-accounts");
		assert.deepEqual(result.json, { items: [{ id: "m1" }] });
	});

	test("list-transactions defaults to the last 30 days and passes the cursor", async () => {
		mock.route("GET", "/v3/merchant-accounts/:id/transactions", (req) => ({ body: { items: [], query: req.query } }));
		const result = await server.call("truelayer-list-transactions", { merchant_account_id: "m1", cursor: "c1" });
		const { from, to, cursor } = result.json.query;
		assert.equal(cursor, "c1");
		const days = (new Date(to) - new Date(from)) / 86400000;
		assert.ok(days > 29.9 && days < 31.1, `window is about 30 days (${days})`);
	});
});

describe("payouts", () => {
	const payout = {
		currency: "GBP",
		amount_in_minor: 100,
		merchant_account_id: "m1",
		beneficiary: {
			type: "external_account",
			account_holder_name: "Test",
			account_identifier: { type: "iban", iban: "GB33BUKB20201555555555" },
			reference: "ref",
		},
	};

	test("create-payout sends a signed request with a generated idempotency key", async () => {
		mock.route("POST", "/v3/payouts", () => ({ status: 202, body: { id: "po1" } }));
		const result = await server.call("truelayer-create-payout", payout);
		assert.deepEqual(result.json, { id: "po1" });
		const request = mock.lastRequest();
		assert.equal(request.signatureValid, true);
		assert.deepEqual(request.signedHeaders, ["Idempotency-Key"], "only the idempotency key is signed");
		assert.match(request.headers["idempotency-key"], UUID);
		assert.deepEqual(request.body, payout);
	});

	test("create-payout reuses a caller-supplied idempotency key", async () => {
		mock.route("POST", "/v3/payouts", () => ({ status: 202, body: { id: "po1" } }));
		await server.call("truelayer-create-payout", { ...payout, idempotency_key: "retry-key-1" });
		assert.equal(mock.lastRequest().headers["idempotency-key"], "retry-key-1");
		assert.equal(mock.lastRequest().body.idempotency_key, undefined, "the key isn't sent in the body");
	});

	test("get-payout URL-encodes the ID", async () => {
		mock.route("GET", "/v3/payouts/:id", (_req, { id }) => ({ body: { id } }));
		await server.call("truelayer-get-payout", { payoutId: "a/b" });
		assert.equal(mock.lastRequest().path, "/v3/payouts/a%2Fb");
	});
});

describe("payment links", () => {
	test("create-payment-link sends a signed single-payment link expiring in 24 hours", async () => {
		mock.route("POST", "/v3/payment-links", () => ({ body: { id: "pl1", uri: "https://example.test/pl1" } }));
		const user = {
			name: "Test User",
			email: "test@example.com",
			phone: "+447700900123",
			date_of_birth: "1990-01-01",
			address: { address_line1: "1 Test St", city: "London", zip: "EC1A 1AA", state: "London", country_code: "GB" },
		};
		const result = await server.call("truelayer-create-payment-link", {
			amount_in_minor: 100,
			currency: "GBP",
			merchant_account_id: "m1",
			user,
		});
		assert.equal(result.json.id, "pl1");
		const { body, signatureValid } = mock.lastRequest();
		assert.equal(signatureValid, true);
		assert.equal(body.type, "single_payment");
		assert.deepEqual(body.payment_configuration.payment_method.beneficiary, {
			type: "merchant_account",
			merchant_account_id: "m1",
		});
		assert.match(body.payment_configuration.user.id, UUID);
		const hours = (new Date(body.expires_at) - Date.now()) / 3600000;
		assert.ok(hours > 23.9 && hours <= 24, `expires in about 24 hours (${hours})`);
	});

	test("get-payment-link fetches by ID", async () => {
		mock.route("GET", "/v3/payment-links/:id", (_req, { id }) => ({ body: { id, status: "enabled" } }));
		const result = await server.call("truelayer-get-payment-link", { paymentLinkId: "pl1" });
		assert.deepEqual(result.json, { id: "pl1", status: "enabled" });
	});
});

describe("input validation", () => {
	test("rejects a call missing a required argument", async () => {
		const result = await server.call("truelayer-get-payout", {});
		assert.equal(result.isError, true);
		assert.match(result.text, /payoutId/);
		assert.equal(mock.apiRequests().length, 0, "nothing is sent to TrueLayer");
	});
});
