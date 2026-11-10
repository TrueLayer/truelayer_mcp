import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import { MERCHANT_ACCOUNT_ID, startServer, testEnv } from "./helpers/mcp.js";
import { startMockTrueLayer } from "./helpers/mock-truelayer.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const user = { name: "Test User", email: "test@example.com" };
const redirectNext = {
	status: "authorizing",
	authorization_flow: { actions: { next: { type: "redirect", uri: "https://bank.test/auth" } } },
};

// One mock and one server are shared by every test in this file, and each test
// reads the mock's last request: this relies on node:test running a file's tests
// one at a time, which it does unless they opt into concurrency.
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

// Asserts the last request was a POST signed over the Idempotency-Key only, as
// TrueLayer's client libraries sign, and returns it.
function lastSignedPost() {
	const request = mock.lastRequest();
	assert.equal(request.method, "POST");
	assert.equal(request.signatureValid, true, "the request is signed with the test key");
	assert.deepEqual(request.signedHeaders, ["Idempotency-Key"]);
	assert.match(request.headers["idempotency-key"], /.+/);
	return request;
}

describe("annotations", () => {
	test("payment tools declare how risky they are", async () => {
		const { tools } = await server.client.listTools();
		const annotations = Object.fromEntries(tools.map((t) => [t.name, t.annotations]));
		for (const name of [
			"truelayer-get-refunds",
			"truelayer-search-payments-providers",
			"truelayer-get-payments-provider",
		]) {
			assert.equal(annotations[name].readOnlyHint, true, `${name} is read-only`);
		}
		for (const name of [
			"truelayer-cancel-payment",
			"truelayer-create-refund",
			"truelayer-submit-payment-action",
			"truelayer-submit-payment-provider-return",
		]) {
			assert.equal(annotations[name].destructiveHint, true, `${name} is destructive`);
		}
		for (const name of ["truelayer-create-payment", "truelayer-start-payment-authorization"]) {
			assert.equal(annotations[name].readOnlyHint, false, `${name} writes`);
			assert.equal(annotations[name].destructiveHint, false, `${name} doesn't move money by itself`);
		}
	});
});

describe("create-payment", () => {
	beforeEach(() => {
		mock.route("POST", "/v3/payments", () => ({
			status: 201,
			body: { id: "pay1", user: { id: "u1" }, resource_token: "rt", status: "authorization_required" },
		}));
	});

	test("defaults to a user-selected bank and the configured merchant account", async () => {
		const result = await server.call("truelayer-create-payment", { amount_in_minor: 100, currency: "GBP", user });
		assert.equal(result.isError, false, result.text);
		assert.equal(result.json.id, "pay1");
		const { body, headers } = lastSignedPost();
		assert.match(headers["idempotency-key"], UUID);
		assert.deepEqual(body, {
			amount_in_minor: 100,
			currency: "GBP",
			payment_method: {
				type: "bank_transfer",
				provider_selection: { type: "user_selected" },
				beneficiary: { type: "merchant_account", merchant_account_id: MERCHANT_ACCOUNT_ID },
			},
			user,
		});
	});

	test("pays into the caller's merchant account over the configured one", async () => {
		await server.call("truelayer-create-payment", {
			amount_in_minor: 100,
			currency: "EUR",
			user,
			beneficiary: { type: "merchant_account", merchant_account_id: "eur-account" },
		});
		assert.deepEqual(mock.lastRequest().body.payment_method.beneficiary, {
			type: "merchant_account",
			merchant_account_id: "eur-account",
		});
	});

	test("passes a preselected bank, defaulting the scheme to instant_preferred", async () => {
		await server.call("truelayer-create-payment", {
			amount_in_minor: 250,
			currency: "EUR",
			user,
			provider_selection: { type: "preselected", provider_id: "mock-payments-de-embedded" },
		});
		assert.deepEqual(mock.lastRequest().body.payment_method.provider_selection, {
			type: "preselected",
			provider_id: "mock-payments-de-embedded",
			scheme_selection: { type: "instant_preferred" },
		});
	});

	test("supports external account beneficiaries, retry, hosted page and the remaining options", async () => {
		mock.route("POST", "/v3/payments", () => ({
			status: 201,
			body: { id: "pay2", status: "authorization_required", hosted_page: { uri: "https://hpp.test/pay2" } },
		}));
		const beneficiary = {
			type: "external_account",
			account_holder_name: "Jane Doe",
			account_identifier: { type: "sort_code_account_number", sort_code: "040668", account_number: "00000871" },
			reference: "INV-1",
		};
		const extra = {
			metadata: { order: "1234" },
			hosted_page: { return_uri: "https://example.test/return", country_code: "GB", language_code: "en" },
			risk_assessment: { segment: "low" },
			sub_merchants: { ultimate_counterparty: { type: "business_division", id: "div1", name: "Shoes" } },
			user_consent: { type: "authorization_flow_captured" },
		};
		const result = await server.call("truelayer-create-payment", {
			amount_in_minor: 1,
			currency: "GBP",
			user,
			beneficiary,
			retry: true,
			idempotency_key: "pay-retry-1",
			...extra,
		});
		assert.equal(result.json.hosted_page.uri, "https://hpp.test/pay2");
		const { body, headers } = lastSignedPost();
		assert.equal(headers["idempotency-key"], "pay-retry-1");
		assert.deepEqual(body.payment_method.beneficiary, beneficiary);
		assert.deepEqual(body.payment_method.retry, {});
		for (const [key, value] of Object.entries(extra)) assert.deepEqual(body[key], value, key);
		assert.equal(body.idempotency_key, undefined);
	});

	// Each schema rule has a unit test in payment-schemas.test.js; this checks
	// that the server applies them before sending anything.
	test("rejects invalid input before calling TrueLayer, naming the field", async () => {
		const result = await server.call("truelayer-create-payment", {
			amount_in_minor: 100,
			currency: "GBP",
			user,
			beneficiary: {
				type: "external_account",
				account_holder_name: "Jane",
				account_identifier: { type: "sort_code_account_number", sort_code: "04-06-68", account_number: "00000871" },
				reference: "ref",
			},
		});
		assert.equal(result.isError, true, result.text);
		assert.match(result.text, /sort_code/);
		assert.equal(mock.apiRequests().length, 0);
	});

	test("rejects hosted_page with authorization_flow before calling TrueLayer", async () => {
		const result = await server.call("truelayer-create-payment", {
			amount_in_minor: 100,
			currency: "GBP",
			user,
			hosted_page: { return_uri: "https://example.test/return" },
			authorization_flow: { redirect: { return_uri: "https://example.test/return" } },
		});
		assert.equal(result.isError, true, result.text);
		assert.match(result.text, /can't be combined/);
		assert.equal(mock.apiRequests().length, 0);
	});

	test("passes Tl-Should-Retry on to the error, so the assistant knows whether to reuse the key", async () => {
		mock.route("POST", "/v3/payments", () => ({
			status: 400,
			body: { title: "Invalid Parameters", status: 400 },
			headers: { "Tl-Should-Retry": "false" },
		}));
		const result = await server.call("truelayer-create-payment", { amount_in_minor: 100, currency: "GBP", user });
		assert.equal(result.isError, true, result.text);
		assert.match(result.text, /HTTP 400 \(Tl-Should-Retry: false\): .*Invalid Parameters/);
	});
});

describe("authorization flow", () => {
	test("start-payment-authorization sends the UI capabilities only", async () => {
		mock.route("POST", "/v3/payments/:id/authorization-flow", () => ({ body: redirectNext }));
		const result = await server.call("truelayer-start-payment-authorization", {
			payment_id: "pay1",
			provider_selection: {},
			redirect: { return_uri: "https://example.test/return" },
			form: { input_types: ["text", "select"] },
			idempotency_key: "start-1",
		});
		assert.equal(result.json.authorization_flow.actions.next.uri, "https://bank.test/auth");
		const { path, body, headers } = lastSignedPost();
		assert.equal(path, "/v3/payments/pay1/authorization-flow");
		assert.equal(headers["idempotency-key"], "start-1");
		assert.deepEqual(body, {
			provider_selection: {},
			redirect: { return_uri: "https://example.test/return" },
			form: { input_types: ["text", "select"] },
		});
	});

	const cases = [
		[
			{ type: "provider_selection", provider_id: "ob-bank", branch_id: "b1" },
			"provider-selection",
			{ provider_id: "ob-bank", branch_id: "b1" },
		],
		[
			{ type: "scheme_selection", scheme_id: "faster_payments_service" },
			"scheme-selection",
			{ scheme_id: "faster_payments_service" },
		],
		[{ type: "branch_selection", branch_id: "b2" }, "branch-selection", { branch_id: "b2" }],
		[{ type: "form", inputs: { "psu-name": "Jane" } }, "form", { inputs: { "psu-name": "Jane" } }],
		[
			{ type: "form", inputs: { iban: "DE00" }, consent_captured: { ais_scopes: ["accounts"] } },
			"form",
			{ inputs: { iban: "DE00" }, adjacent: { consent: { captured: { pis: {}, ais: { scopes: ["accounts"] } } } } },
		],
		[{ type: "consent" }, "consent", {}],
		[{ type: "consent", ais_scopes: ["balance"] }, "consent", { captured: { pis: {}, ais: { scopes: ["balance"] } } }],
	];
	for (const [action, endpoint, expectedBody] of cases) {
		test(`submit-payment-action ${JSON.stringify(action)} posts to ${endpoint}`, async () => {
			mock.route("POST", `/v3/payments/:id/authorization-flow/actions/${endpoint}`, () => ({ body: redirectNext }));
			const result = await server.call("truelayer-submit-payment-action", { payment_id: "pay 1", action });
			assert.equal(result.isError, false, result.text);
			const { path, body } = lastSignedPost();
			assert.equal(path, `/v3/payments/pay%201/authorization-flow/actions/${endpoint}`);
			assert.deepEqual(body, expectedBody);
		});
	}

	test("submit-payment-action rejects an unknown action type", async () => {
		const result = await server.call("truelayer-submit-payment-action", {
			payment_id: "p",
			action: { type: "redirect" },
		});
		assert.equal(result.isError, true, result.text);
		assert.equal(mock.apiRequests().length, 0);
	});

	test("submit-payment-provider-return posts the query and fragment, and needs one of them", async () => {
		mock.route("POST", "/v3/payments-provider-return", () => ({
			body: { resource: { type: "payment", payment_id: "pay1" } },
		}));
		const result = await server.call("truelayer-submit-payment-provider-return", {
			query: "?code=abc",
			fragment: "#state=x",
		});
		assert.equal(result.json.resource.payment_id, "pay1");
		assert.deepEqual(lastSignedPost().body, { query: "?code=abc", fragment: "#state=x" });

		mock.reset();
		const empty = await server.call("truelayer-submit-payment-provider-return", {});
		assert.equal(empty.isError, true, empty.text);
		assert.match(empty.text, /Provide query, fragment or both/);
		assert.equal(mock.apiRequests().length, 0);
	});
});

describe("cancel-payment", () => {
	test("sends a signed POST without a body and reports the request as accepted", async () => {
		mock.route("POST", "/v3/payments/:id/actions/cancel", () => ({ status: 202 }));
		const result = await server.call("truelayer-cancel-payment", { payment_id: "pay1", idempotency_key: "cancel-1" });
		assert.deepEqual(result.json, { payment_id: "pay1", cancellation_requested: true });
		const { body, headers } = lastSignedPost();
		assert.equal(body, "", "no request body");
		assert.equal(headers["content-type"], undefined);
		assert.equal(headers["idempotency-key"], "cancel-1");
	});

	test("reports a payment that can't be cancelled", async () => {
		mock.route("POST", "/v3/payments/:id/actions/cancel", () => ({
			status: 400,
			body: { title: "Payment cannot be cancelled", status: 400 },
		}));
		const result = await server.call("truelayer-cancel-payment", { payment_id: "pay1" });
		assert.equal(result.isError, true, result.text);
		assert.match(result.text, /HTTP 400.*Payment cannot be cancelled/);
	});
});

describe("refunds", () => {
	test("create-refund omits the amount for a full refund", async () => {
		mock.route("POST", "/v3/payments/:id/refunds", () => ({ status: 202, body: { id: "r1" } }));
		const result = await server.call("truelayer-create-refund", { payment_id: "pay1", reference: "Refund" });
		assert.deepEqual(result.json, { id: "r1" });
		const { path, body } = lastSignedPost();
		assert.equal(path, "/v3/payments/pay1/refunds");
		assert.deepEqual(body, { reference: "Refund" });
	});

	test("create-refund sends a partial amount, metadata and the caller's idempotency key", async () => {
		mock.route("POST", "/v3/payments/:id/refunds", () => ({ status: 202, body: { id: "r2" } }));
		await server.call("truelayer-create-refund", {
			payment_id: "pay1",
			amount_in_minor: 50,
			reference: "Partial",
			metadata: { reason: "damaged" },
			idempotency_key: "refund-1",
		});
		const { body, headers } = lastSignedPost();
		assert.deepEqual(body, { amount_in_minor: 50, reference: "Partial", metadata: { reason: "damaged" } });
		assert.equal(headers["idempotency-key"], "refund-1");
	});

	test("get-refunds lists a payment's refunds, or gets one", async () => {
		mock.route("GET", "/v3/payments/:id/refunds", () => ({ body: { items: [{ id: "r1", status: "executed" }] } }));
		mock.route("GET", "/v3/payments/:id/refunds/:refund", (_req, { refund }) => ({
			body: { id: refund, status: "pending" },
		}));

		const list = await server.call("truelayer-get-refunds", { payment_id: "pay1" });
		assert.deepEqual(list.json, { items: [{ id: "r1", status: "executed" }] });
		assert.equal(mock.lastRequest().path, "/v3/payments/pay1/refunds");

		const one = await server.call("truelayer-get-refunds", { payment_id: "pay1", refund_id: "r2" });
		assert.deepEqual(one.json, { id: "r2", status: "pending" });
		assert.equal(mock.lastRequest().path, "/v3/payments/pay1/refunds/r2");
	});

	test("get-refunds rejects an empty refund_id rather than listing every refund", async () => {
		const result = await server.call("truelayer-get-refunds", { payment_id: "pay1", refund_id: "" });
		assert.equal(result.isError, true, result.text);
		assert.equal(mock.apiRequests().length, 0);
	});
});

describe("payments providers", () => {
	const provider = {
		id: "ob-bank",
		display_name: "Bank",
		country_code: "GB",
		logo_uri: "https://logo.test",
		capabilities: {
			payments: {
				bank_transfer: {
					release_channel: "general_availability",
					availability: { recommended_status: "healthy", updated_at: "2026-11-10T00:00:00Z" },
					schemes: [{ id: "faster_payments_service", requirements: [] }],
				},
			},
			mandates: { vrp_sweeping: { release_channel: "general_availability" } },
		},
	};

	test("search defaults to bank transfers and a redirect-capable UI, and summarises each provider", async () => {
		mock.route("POST", "/v3/payments-providers/search", () => ({ body: { items: [provider] } }));
		const result = await server.call("truelayer-search-payments-providers", { countries: ["GB"], currencies: ["GBP"] });
		assert.deepEqual(result.json, {
			count: 1,
			items: [
				{
					id: "ob-bank",
					display_name: "Bank",
					country_code: "GB",
					bank_transfer: {
						release_channel: "general_availability",
						availability: "healthy",
						schemes: ["faster_payments_service"],
					},
					mandates: ["vrp_sweeping"],
				},
			],
		});
		assert.deepEqual(lastSignedPost().body, {
			countries: ["GB"],
			currencies: ["GBP"],
			capabilities: { payments: { bank_transfer: {} } },
			authorization_flow: {
				configuration: {
					provider_selection: {},
					redirect: {},
					form: { input_types: ["text", "text_with_image", "select"] },
				},
			},
		});
	});

	test("search can filter on mandate capabilities and return the full objects", async () => {
		mock.route("POST", "/v3/payments-providers/search", () => ({ body: { items: [provider] } }));
		const result = await server.call("truelayer-search-payments-providers", {
			capability: "vrp_sweeping",
			detailed: true,
		});
		assert.deepEqual(result.json, { items: [provider] });
		assert.deepEqual(mock.lastRequest().body.capabilities, { mandates: { vrp_sweeping: {} } });
	});

	test("search sends the caller's own UI capabilities", async () => {
		mock.route("POST", "/v3/payments-providers/search", () => ({ body: { items: [] } }));
		const configuration = { redirect: {}, consent: { requirements: { pis: {} } } };
		const result = await server.call("truelayer-search-payments-providers", { authorization_flow: configuration });
		assert.equal(result.isError, false, result.text);
		assert.deepEqual(mock.lastRequest().body.authorization_flow, { configuration });
	});

	test("search returns the response as is when it has no items list", async () => {
		mock.route("POST", "/v3/payments-providers/search", () => ({ body: { unexpected: true } }));
		const result = await server.call("truelayer-search-payments-providers", {});
		assert.deepEqual(result.json, { unexpected: true });
	});

	test("get-payments-provider asks for this client's capabilities", async () => {
		mock.route("GET", "/v3/payments-providers/:id", (req, { id }) => ({ body: { id, query: req.query } }));
		const result = await server.call("truelayer-get-payments-provider", {
			provider_id: "ob-bank",
			icon_type: "extended",
		});
		assert.deepEqual(result.json, { id: "ob-bank", query: { client_id: "test-client", icon_type: "extended" } });
	});
});
