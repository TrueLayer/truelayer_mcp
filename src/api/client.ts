import * as tlSigning from "truelayer-signing";
import { v4 as uuidv4 } from "uuid";
import { getConfig } from "../config.js";

// Client behaviour settings; credentials and endpoints come from getConfig().
export const settings = {
	userAgent: "truelayer-mcp/1.0.0",
	// Identifies the integration to TrueLayer, in the format their client libraries use.
	tlAgent: `truelayer-mcp/1.0.0 (Node/${process.versions.node})`,
	tokenExpiryFallbackSeconds: 1800, // 30 minutes fallback if expires_in is not present
	tokenExpiryBufferMs: 60000, // reuse a cached token until 60 seconds before it expires
	paymentLinkExpiryHours: 24, // Payment links expire after 24 hours by default
};

type AccessResponse = {
	access_token: string;
	expires_in: number;
	token_type: string;
	scope?: string;
};

// Raised when TrueLayer answers with a non-2xx status. The message carries the
// status and the response body (usually a problem+json document), so the
// assistant sees why the call failed instead of an error body passed off as data.
export class TrueLayerApiError extends Error {
	constructor(
		readonly method: string,
		readonly path: string,
		readonly status: number,
		readonly body: string,
	) {
		super(`${method} ${path} failed with HTTP ${status}${body ? `: ${body}` : ""}`);
		this.name = "TrueLayerApiError";
	}
}

// Response bodies are returned as `unknown`: the tools pass them through to the
// assistant as JSON, and anything reading fields must check them first.
async function parseResponse<T = unknown>(method: string, path: string, response: Response): Promise<T> {
	const text = await response.text();
	if (!response.ok) {
		throw new TrueLayerApiError(method, path, response.status, text);
	}
	return (text ? JSON.parse(text) : {}) as T;
}

// Access tokens are cached per scope string: the Payments API uses the
// configured scopes, while other products (such as Data API v3) need their own
// token, so a client without that product doesn't break the payments tools.
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

export async function getAccessToken(scope: string = getConfig().tokenScope): Promise<string> {
	const cached = tokenCache.get(scope);
	if (cached && cached.expiresAt > Date.now() + settings.tokenExpiryBufferMs) {
		return cached.token;
	}

	const tokenResponse = await generateAccessToken(scope);
	const expiresIn = tokenResponse.expires_in || settings.tokenExpiryFallbackSeconds;
	tokenCache.set(scope, { token: tokenResponse.access_token, expiresAt: Date.now() + expiresIn * 1000 });
	return tokenResponse.access_token;
}

// Token requests aren't signed, matching TrueLayer's official client libraries.
export async function generateAccessToken(scope: string = getConfig().tokenScope): Promise<AccessResponse> {
	const path = "/connect/token";
	const response = await fetch(getConfig().authUri, {
		method: "POST",
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
			"User-Agent": settings.userAgent,
			"TL-Agent": settings.tlAgent,
		},
		body: new URLSearchParams({
			client_id: getConfig().clientId,
			client_secret: getConfig().clientSecret,
			scope,
			grant_type: "client_credentials",
		}).toString(),
	});
	return parseResponse<AccessResponse>("POST", path, response);
}

// Signs like TrueLayer's Java, .NET and PHP libraries: method, path, the
// Idempotency-Key header and the body. Leaving the other headers out of the
// signature means proxies that rewrite them don't invalidate it.
function sign(method: "POST" | "DELETE", path: string, idempotencyKey: string, body: string): string {
	return tlSigning.sign({
		kid: getConfig().kid,
		privateKeyPem: getConfig().privateKeyPem,
		method: method === "POST" ? tlSigning.HttpMethod.Post : tlSigning.HttpMethod.Delete,
		path,
		headers: { "Idempotency-Key": idempotencyKey },
		body,
	});
}

export interface RequestOptions {
	// JSON request body. Omit for requests without a body.
	body?: unknown;
	// Query string parameters; undefined values are skipped.
	query?: Record<string, string | undefined>;
	// Sign the request with Tl-Signature. Defaults to true for every non-GET
	// request, as TrueLayer's client libraries do for the Payments API.
	sign?: boolean;
	// Idempotency key for non-GET requests: sent as is, so a caller retrying an
	// operation can reuse it. A fresh UUID is generated when omitted.
	idempotencyKey?: string;
	// Extra headers, such as Connection-Id or Tl-User-IP; undefined values are skipped.
	headers?: Record<string, string | undefined>;
	// Token scope; defaults to the configured Payments API scopes.
	scope?: string;
}

export async function apiRequest<T = unknown>(
	method: "GET" | "POST" | "DELETE",
	path: string,
	options: RequestOptions = {},
): Promise<T> {
	const query = new URLSearchParams(
		Object.entries(options.query ?? {}).filter((entry): entry is [string, string] => entry[1] !== undefined),
	).toString();
	const fullPath = query ? `${path}?${query}` : path;
	const bodyStr = options.body === undefined ? undefined : JSON.stringify(options.body);

	const headers: Record<string, string> = {
		Accept: "application/json; charset=UTF-8",
		"User-Agent": settings.userAgent,
		"TL-Agent": settings.tlAgent,
	};
	if (bodyStr !== undefined) {
		headers["Content-Type"] = "application/json; charset=UTF-8";
	}
	if (method !== "GET") {
		// Generated once, so the retry below reuses it.
		const idempotencyKey = options.idempotencyKey ?? uuidv4();
		headers["Idempotency-Key"] = idempotencyKey;
		if (options.sign ?? true) {
			headers["Tl-Signature"] = sign(method, path, idempotencyKey, bodyStr ?? "");
		}
	}
	for (const [name, value] of Object.entries(options.headers ?? {})) {
		if (value !== undefined) headers[name] = value;
	}

	const scope = options.scope ?? getConfig().tokenScope;
	const send = async () =>
		fetch(`${getConfig().apiUri}${fullPath}`, {
			method,
			headers: { ...headers, Authorization: `Bearer ${await getAccessToken(scope)}` },
			body: bodyStr,
		});

	let response = await send();
	if (response.status === 401) {
		// The cached token may have been revoked or expired early: retry once
		// with a fresh one, as TrueLayer's Java library does.
		tokenCache.delete(scope);
		response = await send();
	}
	return parseResponse<T>(method, fullPath, response);
}

export function apiGet<T = unknown>(
	path: string,
	options: Omit<RequestOptions, "body" | "sign" | "idempotencyKey"> = {},
): Promise<T> {
	return apiRequest<T>("GET", path, options);
}

// Signed POST with an idempotency key, as Payments API v3 writes require.
export function apiSignedPost<T = unknown>(path: string, body: unknown, idempotencyKey?: string): Promise<T> {
	return apiRequest<T>("POST", path, { body, idempotencyKey });
}

// Builds a request path from a template, URL-encoding each parameter.
export function apiPath(strings: TemplateStringsArray, ...params: string[]): string {
	return strings.reduce((path, part, i) => path + part + (i < params.length ? encodeURIComponent(params[i]) : ""), "");
}
