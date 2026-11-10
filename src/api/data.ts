import { apiGet, apiPath, apiRequest } from "./client.js";

// Data API v3. Every endpoint is called with a client_credentials token that
// has the `data` scope (see getAccessToken). Data v3 requests aren't signed:
// the API reference doesn't list Tl-Signature for any of them.
export const DATA_SCOPE = "data";

// Tl-User-IP records the end user's IP address and marks them as present,
// which lifts the limit of 4 calls per day for unattended access.
function dataHeaders(connectionId?: string, userIp?: string) {
	return { "Connection-Id": connectionId, "Tl-User-IP": userIp };
}

export function createConnection(body: unknown, userIp?: string): Promise<unknown> {
	return apiRequest("POST", "/v3/data-connections", {
		body,
		sign: false,
		scope: DATA_SCOPE,
		headers: dataHeaders(undefined, userIp),
	});
}

export function getUserInfo(connectionId: string, userIp?: string): Promise<unknown> {
	return apiGet(apiPath`/v3/data-connections/${connectionId}/user-info`, {
		scope: DATA_SCOPE,
		headers: dataHeaders(undefined, userIp),
	});
}

export function listAccounts(connectionId: string, cursor?: string, userIp?: string): Promise<unknown> {
	return apiGet("/v3/connected-accounts", {
		scope: DATA_SCOPE,
		query: { cursor },
		headers: dataHeaders(connectionId, userIp),
	});
}

export function getBalance(connectionId: string, accountId: string, userIp?: string): Promise<unknown> {
	return apiGet(apiPath`/v3/connected-accounts/${accountId}/balance`, {
		scope: DATA_SCOPE,
		headers: dataHeaders(connectionId, userIp),
	});
}

export interface TransactionsRequest {
	from: string;
	to: string;
	cursor?: string;
	page_size?: number;
	enrichment?: { transaction_category: true; merchant_name: true };
}

export type TransactionsRequestResult =
	| { id: string; status: "pending" }
	| { id: string; status: "completed"; result: { items: unknown[]; pagination?: { next_cursor?: string } } }
	| { id: string; status: "failed"; failure_reason: string };

export function createTransactionsRequest(
	connectionId: string,
	accountId: string,
	body: TransactionsRequest,
	userIp?: string,
): Promise<{ id: string; status: "pending" }> {
	return apiRequest("POST", apiPath`/v3/connected-accounts/${accountId}/transactions/requests`, {
		body,
		sign: false,
		scope: DATA_SCOPE,
		headers: dataHeaders(connectionId, userIp),
	});
}

export function getTransactionsRequest(
	connectionId: string,
	accountId: string,
	requestId: string,
	userIp?: string,
): Promise<TransactionsRequestResult> {
	return apiGet(apiPath`/v3/connected-accounts/${accountId}/transactions/requests/${requestId}`, {
		scope: DATA_SCOPE,
		headers: dataHeaders(connectionId, userIp),
	});
}
