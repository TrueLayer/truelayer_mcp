import { z } from "zod";
import {
	createConnection,
	createTransactionsRequest,
	getBalance,
	getTransactionsRequest,
	getUserInfo,
	listAccounts,
	type TransactionsRequestResult,
} from "../api/data.js";
import { READ_ONLY, run, type ToolModule, WRITES } from "./shared.js";

// Data API v3 tools: create a connection the user authorises at their bank,
// then read their accounts, balances, transactions and name through it.

const DATA_SCOPES = ["info", "accounts", "balance", "transactions"] as const;

const connectionId = z.string().min(1).describe("Connection ID from truelayer-data-create-connection");
const accountId = z.string().min(1).describe("Account ID from truelayer-data-list-accounts");
const userIp = z
	.string()
	.optional()
	.describe(
		"The end user's IP address, when they're present. Lifts the limit of 4 calls per day that applies when the user isn't present.",
	);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");

const providerFilter = z
	.object({
		countries: z
			.array(z.string().regex(/^[A-Z]{2}$/))
			.optional()
			.describe("Only providers from these countries"),
		release_channel: z.enum(["general_availability", "public_beta", "private_beta"]).optional(),
		customer_segments: z.array(z.enum(["retail", "business", "corporate"])).optional(),
		provider_ids: z.array(z.string()).optional().describe("Providers to include"),
		excludes: z.object({ provider_ids: z.array(z.string()).optional() }).optional(),
	})
	.describe("Constrains which banks the user can choose from");

// Polling schedule for transactions requests: start quickly, then back off.
const POLL_DELAYS_MS = [500, 1000, 1500, 2000];
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// TrueLayer rejects the token request with invalid_scope when Data API v3 isn't
// enabled for the client; say so instead of only passing the OAuth error on.
async function withDataHint<T>(fn: () => Promise<T>): Promise<T> {
	try {
		return await fn();
	} catch (error) {
		if (error instanceof Error && /\/connect\/token .*invalid_scope/.test(error.message)) {
			throw new Error(
				`Data API v3 isn't enabled for this client: the token request for the \`data\` scope was rejected (${error.message})`,
			);
		}
		throw error;
	}
}

function describeTransactions(result: TransactionsRequestResult) {
	switch (result.status) {
		case "completed":
			return {
				request_id: result.id,
				status: result.status,
				count: result.result.items.length,
				next_cursor: result.result.pagination?.next_cursor,
				items: result.result.items,
			};
		case "failed":
			return { request_id: result.id, status: result.status, failure_reason: result.failure_reason };
		default:
			return {
				request_id: result.id,
				status: result.status,
				message: "Still processing: fetch the result later with truelayer-data-get-transactions-request.",
			};
	}
}

export const registerDataTools: ToolModule = (server) => {
	server.registerTool(
		"truelayer-data-create-connection",
		{
			title: "Create data connection",
			description:
				"Start connecting a user's bank account with Data API v3 (UK). Returns the connection ID and, with hosted_page type authorization_flow, a hosted_page.uri to send the user to: they choose their bank, consent and log in. Once they've authorised, read their data with the other truelayer-data-* tools using the connection ID.",
			inputSchema: {
				scopes: z
					.array(z.enum(DATA_SCOPES))
					.min(1)
					.default([...DATA_SCOPES])
					.describe("Data the user is asked to share; defaults to info, accounts, balance and transactions"),
				provider_selection: z
					.discriminatedUnion("type", [
						z.object({ type: z.literal("user_selected"), filter: providerFilter.optional() }),
						z.object({ type: z.literal("preselected"), provider_id: z.string().describe("e.g. ob-monzo") }),
					])
					.default({ type: "user_selected" })
					.describe("How the bank is chosen; defaults to the user choosing on TrueLayer's page"),
				user: z
					.object({
						id: z.string().optional().describe("Your ID for the user; TrueLayer creates one if omitted"),
						name: z
							.string()
							.regex(/^[^()]+$/)
							.optional()
							.describe("Full name; required unless you have an AISP licence"),
						email: z.string().optional().describe("Email; email or phone is required unless you have an AISP licence"),
						phone: z.string().optional().describe("Phone number including the country calling code"),
					})
					.describe("The user connecting their account"),
				user_consent: z
					.discriminatedUnion("type", [
						z.object({ type: z.literal("authorization_flow_captured") }),
						z.object({
							type: z.literal("precaptured"),
							captured_at: z.string().describe("When you captured the user's consent (UTC)"),
						}),
					])
					.default({ type: "authorization_flow_captured" })
					.describe("How consent is captured; defaults to TrueLayer capturing it during the flow"),
				hosted_page: z
					.discriminatedUnion("type", [
						z.object({
							type: z.literal("authorization_flow").describe("TrueLayer's hosted page runs the whole journey"),
							return_uri: z.url().describe("Where the user goes afterwards; must be registered in Console"),
							country_code: z
								.string()
								.regex(/^[A-Z]{2}$/)
								.optional(),
							language_code: z
								.string()
								.regex(/^[a-z]{2}$/)
								.optional(),
						}),
						z.object({
							type: z.literal("result_page").describe("Only TrueLayer's result screen; you run the rest"),
							language_code: z
								.string()
								.regex(/^[a-z]{2}$/)
								.optional(),
						}),
					])
					.optional()
					.describe("TrueLayer's hosted pages. Most clients use type authorization_flow."),
				authorization_flow: z
					.object({ redirect: z.object({ return_uri: z.url() }) })
					.optional()
					.describe("Regulated (AISP) clients running their own journey: redirect straight to the bank"),
				data_access_type: z
					.enum(["one_time", "recurring"])
					.optional()
					.describe("recurring (default) keeps access for the consent period; one_time only right after authorisation"),
				metadata: z
					.record(z.string().max(40), z.string().max(500))
					.refine((m) => Object.keys(m).length <= 10, "At most 10 key-value pairs")
					.optional(),
				user_ip: userIp,
			},
			annotations: WRITES,
		},
		({ user_ip, ...body }) =>
			run("Data connection", "Failed to create data connection", () =>
				withDataHint(async () => {
					if (!body.hosted_page && !body.authorization_flow) {
						throw new Error(
							"Provide hosted_page (TrueLayer's hosted journey, for most clients) or authorization_flow (regulated clients)",
						);
					}
					return createConnection(body, user_ip);
				}),
			),
	);

	server.registerTool(
		"truelayer-data-get-user-info",
		{
			title: "Get connected user's info",
			description:
				"Get the name of the user who authorised a data connection, as held by their bank (needs the info scope).",
			inputSchema: { connection_id: connectionId, user_ip: userIp },
			annotations: READ_ONLY,
		},
		({ connection_id, user_ip }) =>
			run("User info", "Failed to retrieve user info", () => withDataHint(() => getUserInfo(connection_id, user_ip))),
	);

	server.registerTool(
		"truelayer-data-list-accounts",
		{
			title: "List connected accounts",
			description:
				"List the bank accounts shared through a data connection: IDs, type, currency, sort code and account number or IBAN, and account holder names (needs the accounts scope).",
			inputSchema: {
				connection_id: connectionId,
				cursor: z.string().optional().describe("next_cursor from a previous page"),
				user_ip: userIp,
			},
			annotations: READ_ONLY,
		},
		({ connection_id, cursor, user_ip }) =>
			run("Connected accounts", "Failed to list connected accounts", () =>
				withDataHint(() => listAccounts(connection_id, cursor, user_ip)),
			),
	);

	server.registerTool(
		"truelayer-data-get-balance",
		{
			title: "Get connected account balance",
			description:
				"Get a connected account's current and available balance and overdraft, in minor units (needs the balance scope).",
			inputSchema: { connection_id: connectionId, account_id: accountId, user_ip: userIp },
			annotations: READ_ONLY,
		},
		({ connection_id, account_id, user_ip }) =>
			run("Balance", "Failed to retrieve balance", () =>
				withDataHint(() => getBalance(connection_id, account_id, user_ip)),
			),
	);

	server.registerTool(
		"truelayer-data-get-transactions",
		{
			title: "Get connected account transactions",
			description:
				"Get a connected account's transactions between two dates (needs the transactions scope). TrueLayer prepares them asynchronously: this waits up to wait_seconds for the result; if it isn't ready, it returns the request_id to fetch later with truelayer-data-get-transactions-request.",
			inputSchema: {
				connection_id: connectionId,
				account_id: accountId,
				from: isoDate.describe("First day, inclusive (YYYY-MM-DD)"),
				to: isoDate.describe("Last day, inclusive (YYYY-MM-DD)"),
				page_size: z.number().int().min(1).max(500).optional().describe("Transactions per page (default 50, max 500)"),
				cursor: z.string().optional().describe("next_cursor from a previous page"),
				enrich: z.boolean().optional().describe("Add a category and merchant name to each transaction"),
				wait_seconds: z
					.number()
					.int()
					.min(0)
					.max(60)
					.default(20)
					.describe("How long to wait for the result (default 20, 0 to return straight away)"),
				user_ip: userIp,
			},
			annotations: READ_ONLY,
		},
		({ connection_id, account_id, from, to, page_size, cursor, enrich, wait_seconds, user_ip }) =>
			run("Transactions", "Failed to retrieve transactions", () =>
				withDataHint(async () => {
					const created = await createTransactionsRequest(
						connection_id,
						account_id,
						{
							from,
							to,
							page_size,
							cursor,
							...(enrich ? { enrichment: { transaction_category: true, merchant_name: true } } : {}),
						},
						user_ip,
					);
					let result: TransactionsRequestResult = created;
					const deadline = Date.now() + wait_seconds * 1000;
					for (let attempt = 0; result.status === "pending" && Date.now() < deadline; attempt++) {
						const delay = POLL_DELAYS_MS[Math.min(attempt, POLL_DELAYS_MS.length - 1)];
						await sleep(Math.min(delay, Math.max(0, deadline - Date.now())));
						result = await getTransactionsRequest(connection_id, account_id, created.id, user_ip);
					}
					return describeTransactions(result);
				}),
			),
	);

	server.registerTool(
		"truelayer-data-get-transactions-request",
		{
			title: "Get transactions request",
			description:
				"Get the result of a transactions request created by truelayer-data-get-transactions: pending, completed (with the transactions) or failed.",
			inputSchema: {
				connection_id: connectionId,
				account_id: accountId,
				request_id: z.string().min(1).describe("request_id returned by truelayer-data-get-transactions"),
				user_ip: userIp,
			},
			annotations: READ_ONLY,
		},
		({ connection_id, account_id, request_id, user_ip }) =>
			run("Transactions", "Failed to retrieve the transactions request", () =>
				withDataHint(async () =>
					describeTransactions(await getTransactionsRequest(connection_id, account_id, request_id, user_ip)),
				),
			),
	);
};
