import { apiGet, apiPath } from "./client.js";

export function listMerchantAccounts(): Promise<unknown> {
	return apiGet("/v3/merchant-accounts");
}

export function getMerchantAccount(merchantAccountId: string): Promise<Record<string, unknown>> {
	return apiGet<Record<string, unknown>>(apiPath`/v3/merchant-accounts/${merchantAccountId}`);
}

export function listTransactions(
	from: string,
	to: string,
	merchantAccountId: string,
	cursor?: string,
): Promise<unknown> {
	return apiGet(apiPath`/v3/merchant-accounts/${merchantAccountId}/transactions`, { query: { from, to, cursor } });
}
