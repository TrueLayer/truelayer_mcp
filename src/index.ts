#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ConfigError, getConfig } from "./config.js";
import { createServer } from "./server.js";

async function main() {
	// Validate configuration before accepting requests, so a missing setting
	// fails at startup with a clear message instead of on the first tool call.
	try {
		const { environment } = getConfig();
		console.error(`Truelayer MCP using the ${environment} environment`);
	} catch (error) {
		console.error(error instanceof ConfigError ? error.message : error);
		process.exit(1);
	}

	const transport = new StdioServerTransport();
	await createServer().connect(transport);
	console.error("Truelayer MCP server running on stdio");
}

main().catch((error) => {
	console.error("Fatal error in main():", error);
	process.exit(1);
});
