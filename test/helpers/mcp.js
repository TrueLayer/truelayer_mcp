// Starts the built MCP server over stdio, configured against a mock TrueLayer,
// and wraps the MCP client for tests.
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { keys } from "./mock-truelayer.js";

export const serverPath = fileURLToPath(new URL("../../build/index.js", import.meta.url));
export const emptyEnvFile = fileURLToPath(new URL("../fixtures/empty.env", import.meta.url));

export const MERCHANT_ACCOUNT_ID = "6a5b3f2e-4c1d-4e8f-9a7b-1c2d3e4f5a6b";

// Environment for a server pointed at `mock`. The empty env file stops a
// developer's local .env from leaking into tests.
export function testEnv(mock, overrides = {}) {
	return {
		PATH: process.env.PATH,
		TRUELAYER_ENV_FILE: emptyEnvFile,
		TRUELAYER_AUTH_URI: `${mock.url}/connect/token`,
		TRUELAYER_API_URI: mock.url,
		TRUELAYER_CLIENT_ID: "test-client",
		TRUELAYER_CLIENT_SECRET: "test-secret",
		TRUELAYER_KID: "test-kid",
		TRUELAYER_PRIVATE_KEY: keys.privateKey,
		TRUELAYER_MERCHANT_ACCOUNT_ID: MERCHANT_ACCOUNT_ID,
		...overrides,
	};
}

export async function startServer(env) {
	const client = new Client({ name: "truelayer-mcp-tests", version: "0" });
	await client.connect(
		new StdioClientTransport({ command: process.execPath, args: [serverPath], env, stderr: "pipe" }),
	);
	return {
		client,
		// Calls a tool and returns { isError, text, json }, where json is the JSON
		// payload after the "Label: " prefix (null when there is none).
		async call(name, args = {}) {
			const result = await client.callTool({ name, arguments: args });
			const text = result.content.map((c) => c.text ?? "").join("\n");
			const start = text.search(/[[{]/);
			let json = null;
			if (!result.isError && start !== -1) json = JSON.parse(text.slice(start));
			return { isError: Boolean(result.isError), text, json };
		},
		close: () => client.close(),
	};
}
