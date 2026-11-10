import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import { startServer, testEnv } from "./helpers/mcp.js";
import { startMockTrueLayer } from "./helpers/mock-truelayer.js";

const CONNECTION = "conn-1";
const user = { name: "Jane Smith", email: "jane@example.com" };
const hostedPage = { type: "authorization_flow", return_uri: "https://example.test/callback" };

// One mock and one server are shared by every test in this file, and tests read
// the mock's request log: this relies on node:test running a file's tests one at
// a time, which it does unless they opt into concurrency.
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

const dataRequests = () =>
	mock.apiRequests().filter((r) => r.path.startsWith("/v3/data") || r.path.startsWith("/v3/connected"));

// Every Data v3 call uses the `data` token and isn't signed.
function assertDataRequest(request, { connectionId } = {}) {
	assert.equal(request.headers.authorization, "Bearer token:data");
	assert.equal(request.headers["tl-signature"], undefined, "Data v3 requests aren't signed");
	if (connectionId) assert.equal(request.headers["connection-id"], connectionId);
}

describe("annotations", () => {
	test("only create-connection writes; the rest are read-only", async () => {
		const { tools } = await server.client.listTools();
		const data = tools.filter((t) => t.name.startsWith("truelayer-data-"));
		assert.equal(data.length, 6, "six Data tools are registered");
		for (const tool of data) {
			const writes = tool.name === "truelayer-data-create-connection";
			assert.equal(tool.annotations.readOnlyHint, !writes, tool.name);
			assert.notEqual(tool.annotations.destructiveHint, true, `${tool.name} moves no money`);
		}
	});
});

describe("access tokens", () => {
	test("Data calls use their own data-scope token, separate from the payments token", async () => {
		mock.route("GET", "/v3/data-connections/:id/user-info", () => ({ body: { name: "Jane Smith" } }));
		mock.route("GET", "/v3/payments/:id", (_req, { id }) => ({ body: { id } }));
		const fresh = await startServer(testEnv(mock, { TRUELAYER_TOKEN_SCOPE: "payments" }));
		try {
			await fresh.call("truelayer-data-get-user-info", { connection_id: CONNECTION });
			await fresh.call("truelayer-get-payment", { paymentId: "p1" });
			const scopes = mock.requests.filter((r) => r.path === "/connect/token").map((r) => r.body.scope);
			assert.deepEqual(scopes.sort(), ["data", "payments"]);
		} finally {
			await fresh.close();
		}
	});

	test("without Data enabled, Data tools explain why and payments keep working", async () => {
		mock.allowScopes(["payments", "paydirect"]);
		mock.route("GET", "/v3/payments/:id", (_req, { id }) => ({ body: { id } }));
		const fresh = await startServer(testEnv(mock));
		try {
			const data = await fresh.call("truelayer-data-list-accounts", { connection_id: CONNECTION });
			assert.equal(data.isError, true, data.text);
			assert.match(data.text, /Data API v3 isn't enabled for this client/);
			assert.match(data.text, /invalid_scope/);

			const payment = await fresh.call("truelayer-get-payment", { paymentId: "p1" });
			assert.equal(payment.isError, false, payment.text);
		} finally {
			await fresh.close();
		}
	});
});

describe("create-connection", () => {
	beforeEach(() => {
		mock.route("POST", "/v3/data-connections", () => ({
			status: 201,
			body: {
				id: CONNECTION,
				user: { id: "u1" },
				status: "authorization_required",
				hosted_page: { uri: "https://app.truelayer.test/data/conn-1" },
			},
		}));
	});

	test("defaults to all scopes, a user-selected bank and consent captured in the flow", async () => {
		const result = await server.call("truelayer-data-create-connection", { user, hosted_page: hostedPage });
		assert.equal(result.isError, false, result.text);
		assert.equal(result.json.hosted_page.uri, "https://app.truelayer.test/data/conn-1");
		const request = mock.lastRequest();
		assertDataRequest(request);
		assert.deepEqual(request.body, {
			scopes: ["info", "accounts", "balance", "transactions"],
			provider_selection: { type: "user_selected" },
			user,
			user_consent: { type: "authorization_flow_captured" },
			hosted_page: hostedPage,
		});
	});

	test("passes a preselected bank, precaptured consent, access type, metadata and the user's IP", async () => {
		await server.call("truelayer-data-create-connection", {
			scopes: ["accounts", "transactions"],
			provider_selection: { type: "preselected", provider_id: "ob-monzo" },
			user,
			user_consent: { type: "precaptured", captured_at: "2026-11-10T09:00:00Z" },
			hosted_page: { type: "result_page", language_code: "en" },
			data_access_type: "one_time",
			metadata: { ref: "abc" },
			user_ip: "203.0.113.7",
		});
		const request = mock.lastRequest();
		assert.equal(request.headers["tl-user-ip"], "203.0.113.7");
		assert.deepEqual(request.body, {
			scopes: ["accounts", "transactions"],
			provider_selection: { type: "preselected", provider_id: "ob-monzo" },
			user,
			user_consent: { type: "precaptured", captured_at: "2026-11-10T09:00:00Z" },
			hosted_page: { type: "result_page", language_code: "en" },
			data_access_type: "one_time",
			metadata: { ref: "abc" },
		});
	});

	test("accepts a regulated client's own redirect instead of a hosted page", async () => {
		const result = await server.call("truelayer-data-create-connection", {
			user,
			provider_selection: { type: "preselected", provider_id: "ob-monzo" },
			authorization_flow: { redirect: { return_uri: "https://example.test/callback" } },
		});
		assert.equal(result.isError, false, result.text);
		assert.deepEqual(mock.lastRequest().body.authorization_flow, {
			redirect: { return_uri: "https://example.test/callback" },
		});
	});

	test("rejects authorization_flow with a hosted page of type authorization_flow, as the API reference does", async () => {
		const result = await server.call("truelayer-data-create-connection", {
			user,
			hosted_page: hostedPage,
			authorization_flow: { redirect: { return_uri: "https://example.test/callback" } },
		});
		assert.equal(result.isError, true, result.text);
		assert.match(result.text, /can't be combined with hosted_page type authorization_flow/);
		assert.equal(dataRequests().length, 0, "nothing is sent to TrueLayer");
	});

	test("requires a hosted page or an authorization flow, and valid scopes", async () => {
		const missing = await server.call("truelayer-data-create-connection", { user });
		assert.equal(missing.isError, true, missing.text);
		assert.match(missing.text, /Provide hosted_page .* or authorization_flow/);

		const badScope = await server.call("truelayer-data-create-connection", {
			user,
			hosted_page: hostedPage,
			scopes: ["cards"],
		});
		assert.equal(badScope.isError, true, badScope.text);
		assert.equal(dataRequests().length, 0, "nothing is sent to TrueLayer");
	});
});

describe("reading data", () => {
	test("get-user-info", async () => {
		mock.route("GET", "/v3/data-connections/:id/user-info", (_req, { id }) => ({ body: { name: `user of ${id}` } }));
		const result = await server.call("truelayer-data-get-user-info", {
			connection_id: "conn/1",
			user_ip: "203.0.113.7",
		});
		assert.deepEqual(result.json, { name: "user of conn/1" });
		const request = mock.lastRequest();
		assertDataRequest(request);
		assert.equal(request.path, "/v3/data-connections/conn%2F1/user-info");
		assert.equal(request.headers["tl-user-ip"], "203.0.113.7");
	});

	test("list-accounts sends the Connection-Id header and the cursor", async () => {
		const account = {
			id: "acc1",
			type: "account",
			currency: "GBP",
			account_identifiers: [{ type: "sort_code_account_number", sort_code: "560029", account_number: "26207729" }],
			account_holder_names: ["Jane Smith"],
		};
		mock.route("GET", "/v3/connected-accounts", (req) => ({ body: { items: [account], query: req.query } }));
		const result = await server.call("truelayer-data-list-accounts", { connection_id: CONNECTION, cursor: "c2" });
		assert.deepEqual(result.json.items, [account]);
		assert.deepEqual(result.json.query, { cursor: "c2" });
		assertDataRequest(mock.lastRequest(), { connectionId: CONNECTION });
	});

	test("get-balance", async () => {
		mock.route("GET", "/v3/connected-accounts/:id/balance", () => ({
			body: { currency: "GBP", current_balance_in_minor: 12345, available_balance_in_minor: 10000 },
		}));
		const result = await server.call("truelayer-data-get-balance", { connection_id: CONNECTION, account_id: "acc1" });
		assert.equal(result.json.current_balance_in_minor, 12345);
		assert.equal(mock.lastRequest().path, "/v3/connected-accounts/acc1/balance");
		assertDataRequest(mock.lastRequest(), { connectionId: CONNECTION });
	});

	test("an expired connection is reported with TrueLayer's problem details", async () => {
		mock.route("GET", "/v3/connected-accounts/:id/balance", () => ({
			status: 400,
			body: { title: "Invalid State", detail: "The data connection is no longer authorized." },
		}));
		const result = await server.call("truelayer-data-get-balance", { connection_id: CONNECTION, account_id: "acc1" });
		assert.equal(result.isError, true, result.text);
		assert.match(result.text, /HTTP 400.*Invalid State/);
	});
});

describe("transactions", () => {
	const transaction = {
		id: "t1",
		timestamp: "2026-11-01T10:00:00Z",
		description: "COFFEE",
		currency: "GBP",
		amount_in_minor: -350,
		status: "settled",
	};

	// Answers the create request, then `pendingPolls` pending results before `final`.
	function transactionsRoutes(final, pendingPolls = 0) {
		let polls = 0;
		mock.route("POST", "/v3/connected-accounts/:id/transactions/requests", () => ({
			status: 202,
			body: { id: "req-1", status: "pending" },
		}));
		mock.route("GET", "/v3/connected-accounts/:id/transactions/requests/:request", () => {
			polls += 1;
			return { body: polls <= pendingPolls ? { id: "req-1", status: "pending" } : final };
		});
		return () => polls;
	}

	test("creates a request and polls until it completes", async () => {
		const polls = transactionsRoutes(
			{ id: "req-1", status: "completed", result: { items: [transaction], pagination: { next_cursor: "n1" } } },
			1,
		);
		const result = await server.call("truelayer-data-get-transactions", {
			connection_id: CONNECTION,
			account_id: "acc1",
			from: "2026-10-01",
			to: "2026-10-31",
			page_size: 100,
			enrich: true,
		});
		assert.equal(result.isError, false, result.text);
		assert.deepEqual(result.json, {
			request_id: "req-1",
			status: "completed",
			count: 1,
			next_cursor: "n1",
			items: [transaction],
		});
		assert.equal(polls(), 2, "status checks before the request completed");
		const create = mock.requests.find((r) => r.method === "POST" && r.path.endsWith("/transactions/requests"));
		assertDataRequest(create, { connectionId: CONNECTION });
		assert.equal(create.path, "/v3/connected-accounts/acc1/transactions/requests");
		assert.deepEqual(create.body, {
			from: "2026-10-01",
			to: "2026-10-31",
			page_size: 100,
			enrichment: { transaction_category: true, merchant_name: true },
		});
	});

	test("reports a failed request with its reason", async () => {
		transactionsRoutes({ id: "req-1", status: "failed", failure_reason: "provider_error" });
		const result = await server.call("truelayer-data-get-transactions", {
			connection_id: CONNECTION,
			account_id: "acc1",
			from: "2026-10-01",
			to: "2026-10-31",
		});
		assert.deepEqual(result.json, { request_id: "req-1", status: "failed", failure_reason: "provider_error" });
	});

	test("returns the request ID when the result isn't ready in time, and fetches it later", async () => {
		transactionsRoutes({ id: "req-1", status: "completed", result: { items: [transaction] } }, 100);
		const pending = await server.call("truelayer-data-get-transactions", {
			connection_id: CONNECTION,
			account_id: "acc1",
			from: "2026-10-01",
			to: "2026-10-31",
			wait_seconds: 1,
		});
		assert.equal(pending.json.status, "pending");
		assert.equal(pending.json.request_id, "req-1");
		assert.match(pending.json.message, /truelayer-data-get-transactions-request/);

		mock.reset();
		mock.route("GET", "/v3/connected-accounts/:id/transactions/requests/:request", (_req, { request }) => ({
			body: { id: request, status: "completed", result: { items: [transaction] } },
		}));
		const later = await server.call("truelayer-data-get-transactions-request", {
			connection_id: CONNECTION,
			account_id: "acc1",
			request_id: "req-1",
		});
		assert.equal(later.json.status, "completed");
		assert.deepEqual(later.json.items, [transaction]);
		assert.equal(mock.lastRequest().path, "/v3/connected-accounts/acc1/transactions/requests/req-1");
	});

	test("wait_seconds 0 returns straight after creating the request", async () => {
		const polls = transactionsRoutes({ id: "req-1", status: "completed", result: { items: [] } });
		const result = await server.call("truelayer-data-get-transactions", {
			connection_id: CONNECTION,
			account_id: "acc1",
			from: "2026-10-01",
			to: "2026-10-31",
			wait_seconds: 0,
		});
		assert.equal(result.json.status, "pending");
		assert.equal(polls(), 0, "no status checks");
	});

	test("rejects dates that aren't YYYY-MM-DD", async () => {
		const result = await server.call("truelayer-data-get-transactions", {
			connection_id: CONNECTION,
			account_id: "acc1",
			from: "01/10/2026",
			to: "2026-10-31",
		});
		assert.equal(result.isError, true, result.text);
		assert.equal(dataRequests().length, 0, "nothing is sent to TrueLayer");
	});

	test("names the request ID when checking the result fails", async () => {
		mock.route("POST", "/v3/connected-accounts/:id/transactions/requests", () => ({
			status: 202,
			body: { id: "req-1", status: "pending" },
		}));
		mock.route("GET", "/v3/connected-accounts/:id/transactions/requests/:request", () => ({
			status: 503,
			body: { title: "Service Unavailable" },
		}));
		const result = await server.call("truelayer-data-get-transactions", {
			connection_id: CONNECTION,
			account_id: "acc1",
			from: "2026-10-01",
			to: "2026-10-31",
			wait_seconds: 1,
		});
		assert.equal(result.isError, true, result.text);
		assert.match(result.text, /transactions request req-1 failed .*HTTP 503.*truelayer-data-get-transactions-request/);
	});
});
