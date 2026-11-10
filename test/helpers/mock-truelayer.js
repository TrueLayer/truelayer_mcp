// A local stand-in for TrueLayer's auth and API servers. It records every
// request, verifies Tl-Signature headers against the test public key, issues an
// access token per scope, and answers API calls from per-test route handlers.
import { generateKeyPairSync } from "node:crypto";
import http from "node:http";
import * as tlSigning from "truelayer-signing";

export const keys = generateKeyPairSync("ec", {
	namedCurve: "secp521r1",
	privateKeyEncoding: { type: "sec1", format: "pem" },
	publicKeyEncoding: { type: "spki", format: "pem" },
});

export async function startMockTrueLayer() {
	const routes = [];
	const requests = [];
	let tokenScopes = null; // null: any scope is allowed

	const server = http.createServer((req, res) => {
		let raw = "";
		req.on("data", (chunk) => {
			raw += chunk;
		});
		req.on("end", async () => {
			const url = new URL(req.url, "http://localhost");
			const signature = req.headers["tl-signature"];
			let signatureValid = null;
			// The headers the signature covers, from the JWS header's tl_headers.
			let signedHeaders = null;
			if (signature) {
				const jwsHeader = JSON.parse(Buffer.from(signature.split(".")[0], "base64url").toString());
				signedHeaders = jwsHeader.tl_headers ? jwsHeader.tl_headers.split(",") : [];
				try {
					tlSigning.verify({
						publicKeyPem: keys.publicKey,
						signature,
						method: req.method,
						path: url.pathname,
						headers: req.headers,
						body: raw,
					});
					signatureValid = true;
				} catch {
					signatureValid = false;
				}
			}
			const contentType = req.headers["content-type"] ?? "";
			let body = raw;
			if (contentType.startsWith("application/json") && raw) body = JSON.parse(raw);
			if (contentType.startsWith("application/x-www-form-urlencoded"))
				body = Object.fromEntries(new URLSearchParams(raw));
			const request = {
				method: req.method,
				path: url.pathname,
				query: Object.fromEntries(url.searchParams),
				headers: req.headers,
				body,
				signatureValid,
				signedHeaders,
			};
			requests.push(request);

			const send = (status, payload, headers = {}) => {
				res.writeHead(status, { ...(payload === undefined ? {} : { "content-type": "application/json" }), ...headers });
				res.end(payload === undefined ? "" : JSON.stringify(payload));
			};
			if (signatureValid === false) return send(401, { title: "Invalid signature" });

			if (req.method === "POST" && url.pathname === "/connect/token") {
				const scope = body.scope;
				if (tokenScopes && !scope.split(" ").every((s) => tokenScopes.includes(s))) {
					return send(400, { error: "invalid_scope" });
				}
				return send(200, { access_token: `token:${scope}`, expires_in: 3600, token_type: "Bearer", scope });
			}

			const route = routes.find((r) => r.method === req.method && r.match(url.pathname));
			if (!route)
				return send(404, {
					title: "Not Found",
					status: 404,
					detail: `no mock route for ${req.method} ${url.pathname}`,
				});
			try {
				const result = await route.handler(request, route.match(url.pathname));
				send(result?.status ?? 200, result?.body, result?.headers);
			} catch (error) {
				send(500, { title: "Mock handler failed", detail: String(error) });
			}
		});
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	const url = `http://127.0.0.1:${server.address().port}`;

	return {
		url,
		requests,
		// Registers a handler for METHOD + path. `path` may contain :params, which
		// are passed to the handler as its second argument. The handler returns
		// { status, body, headers }, all optional.
		route(method, path, handler) {
			const pattern = new RegExp(`^${path.replace(/:[a-z_]+/g, "([^/]+)")}$`);
			const names = [...path.matchAll(/:([a-z_]+)/g)].map((m) => m[1]);
			const match = (pathname) => {
				const m = pattern.exec(pathname);
				return m && Object.fromEntries(names.map((n, i) => [n, decodeURIComponent(m[i + 1])]));
			};
			routes.unshift({ method, match, handler });
		},
		// Limits which scopes the token endpoint grants, to simulate a client
		// without some products enabled.
		allowScopes(scopes) {
			tokenScopes = scopes;
		},
		apiRequests() {
			return requests.filter((r) => r.path !== "/connect/token");
		},
		lastRequest() {
			return requests.at(-1);
		},
		reset() {
			requests.length = 0;
			routes.length = 0;
			tokenScopes = null;
		},
		close: () => new Promise((resolve) => server.close(resolve)),
	};
}
