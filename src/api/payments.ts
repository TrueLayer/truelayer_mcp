import { getConfig } from "../config.js";
import { apiGet, apiPath, apiRequest } from "./client.js";

// Payments API v3: payments, their authorization flow, refunds and payments
// providers. Like TrueLayer's client libraries, the client signs every POST and
// sends an idempotency key with it (a caller-supplied one when retrying).

export function createPayment(body: unknown, idempotencyKey?: string): Promise<unknown> {
	return apiRequest("POST", "/v3/payments", { body, idempotencyKey });
}

export function getPayment(paymentId: string): Promise<unknown> {
	return apiGet(apiPath`/v3/payments/${paymentId}`);
}

export function startAuthorizationFlow(paymentId: string, body: unknown, idempotencyKey?: string): Promise<unknown> {
	return apiRequest("POST", apiPath`/v3/payments/${paymentId}/authorization-flow`, { body, idempotencyKey });
}

export type AuthorizationAction = "provider-selection" | "scheme-selection" | "branch-selection" | "form" | "consent";

export function submitAuthorizationAction(
	paymentId: string,
	action: AuthorizationAction,
	body: unknown,
	idempotencyKey?: string,
): Promise<unknown> {
	return apiRequest("POST", `${apiPath`/v3/payments/${paymentId}/authorization-flow/actions`}/${action}`, {
		body,
		idempotencyKey,
	});
}

// No request body, as in TrueLayer's client libraries; signed over an empty body.
export function cancelPayment(paymentId: string, idempotencyKey?: string): Promise<unknown> {
	return apiRequest("POST", apiPath`/v3/payments/${paymentId}/actions/cancel`, { idempotencyKey });
}

export function submitProviderReturn(
	body: { query?: string; fragment?: string },
	idempotencyKey?: string,
): Promise<unknown> {
	return apiRequest("POST", "/v3/payments-provider-return", { body, idempotencyKey });
}

export function createRefund(paymentId: string, body: unknown, idempotencyKey?: string): Promise<unknown> {
	return apiRequest("POST", apiPath`/v3/payments/${paymentId}/refunds`, { body, idempotencyKey });
}

export function listRefunds(paymentId: string): Promise<unknown> {
	return apiGet(apiPath`/v3/payments/${paymentId}/refunds`);
}

export function getRefund(paymentId: string, refundId: string): Promise<unknown> {
	return apiGet(apiPath`/v3/payments/${paymentId}/refunds/${refundId}`);
}

export function searchProviders(body: unknown): Promise<unknown> {
	return apiRequest("POST", "/v3/payments-providers/search", { body });
}

// Passing client_id returns the capabilities available to this client,
// including ones that aren't generally available yet.
export function getProvider(providerId: string, iconType?: string): Promise<unknown> {
	return apiGet(apiPath`/v3/payments-providers/${providerId}`, {
		query: { client_id: getConfig().clientId, icon_type: iconType },
	});
}
