# TrueLayer MCP Integration for AI assistants

An experimental project connecting TrueLayer APIs and an AI assistant, like Claude AI.

This project provides a Truelayer Model Context Protocol (MCP) server that enables an AI assistant, like Claude AI, to interact with TrueLayer's financial APIs. It allows the AI assistant to perform various banking and payment operations through TrueLayer's services.

> ⚠️ **DISCLAIMER** ⚠️

> This project is for demonstration purposes only. It is not officially supported or maintained by TrueLayer, does not form a part of the services we contractually provide you with and we are not responsible for the outcome of your use.
> Use at your own risk.
> This integration may break with API changes.

> By using this MCP server with an external LLM you are trusting an external third party with the handling of the data retrieved from the TrueLayer API.

## Features

The integration allows an AI assistant to execute some of the TrueLayer actions directly from the assistant chat.

These functions allow you to perform common payment operations like retrieving account information, creating payment links for customers, sending payouts to beneficiaries, and reviewing transaction history.

Given that AI assistants may not always produce deterministic behaviors, and for safe and isolated testing, we recommend testing the MCP server in the TrueLayer Sandbox environment.

### Product coverage

The server covers part of the TrueLayer API. ✅ means every endpoint of the product is covered, 🟡 means some operations are available and others aren't, and ❌ means the product isn't covered at all. The "Not covered" column lists the main gaps and isn't exhaustive; see the [TrueLayer API reference](https://docs.truelayer.com/reference) for everything each product offers.

| Product                                        | Status | Tools                                                                                               | Not covered                                                                                                                                         |
| ---------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Payments                                       | 🟡     | `truelayer-get-payment`                                                                             | Creating a payment directly (outside a payment link), choosing the bank for the user, the authorization flow, cancelling, refunds, listing payments |
| Payment links                                  | 🟡     | `truelayer-create-payment-link`, `truelayer-get-payment-link`                                       | Links other than single payments, listing a link's payments, disabling a link                                                                       |
| Payouts                                        | 🟡     | `truelayer-create-payout`, `truelayer-get-payout`                                                   | Payouts to anything other than an external account (back to a payment source, to a business account), cancelling, listing payouts                   |
| Merchant accounts                              | 🟡     | `truelayer-get-merchant-account`, `truelayer-list-merchant-accounts`, `truelayer-list-transactions` | Payment sources, sweeping                                                                                                                           |
| Mandates and variable recurring payments (VRP) | ❌     |                                                                                                     | Creating, getting, listing and revoking mandates, funds checks, constraints, payments under a mandate                                               |
| Data API v3 (account information, UK)          | ✅     | Connections, user info, accounts, balances, transactions; see [Data API v3 tools](#data-api-v3)     | Connection and transactions request webhooks (the tools poll instead)                                                                               |
| Data API v1 (legacy)                           | ❌     |                                                                                                     | Superseded by v3. Covers what v3 doesn't (cards, standing orders, direct debits, banks outside the UK), but needs a per-user OAuth token flow       |
| Verification                                   | ❌     |                                                                                                     | Account holder name verification                                                                                                                    |
| Signup+                                        | ❌     |                                                                                                     | Identity data for onboarding                                                                                                                        |
| Providers                                      | ❌     |                                                                                                     | Searching for and looking up banks                                                                                                                  |
| Webhooks                                       | ❌     |                                                                                                     | Status change notifications; the tools poll instead, as a local stdio server can't receive webhooks                                                 |

The payout tools need the `paydirect` token scope, which is only available if Payouts is enabled on your client (see `TRUELAYER_TOKEN_SCOPE` below).

The Data API v3 tools need Data API v3 enabled on your client. They request their own token with the `data` scope, separately from the payments token, so the payments tools keep working on clients without Data.

## Setup

### Prerequisites

- Node.js (v22 or later)
- npm or yarn
- A TrueLayer account with API credentials

### Installation

1. Clone this repository:
```bash
git clone <repository-url>
cd truelayer_mcp
```

2. Install dependencies:
```bash
npm install
```

3. Configure your TrueLayer credentials. The server reads them from environment variables, or from a `.env` file in the project root (next to `package.json`):
```bash
cp .env.example .env
```
Fill in `.env`:

| Variable                                                    | Required | Description                                                                                                                                                  |
| ----------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `TRUELAYER_ENV`                                             | no       | `sandbox` (default) or `production`                                                                                                                          |
| `TRUELAYER_CLIENT_ID`                                       | yes      | Client ID from the Console                                                                                                                                   |
| `TRUELAYER_CLIENT_SECRET` or `TRUELAYER_CLIENT_SECRET_FILE` | yes      | Client secret, inline or as a path to a file containing it                                                                                                   |
| `TRUELAYER_KID`                                             | yes      | Key ID of the signing public key uploaded to the Console                                                                                                     |
| `TRUELAYER_PRIVATE_KEY_FILE` or `TRUELAYER_PRIVATE_KEY`     | yes      | EC P-521 signing private key, as a path or inline PEM (`\n` for line breaks)                                                                                 |
| `TRUELAYER_MERCHANT_ACCOUNT_ID`                             | yes      | Default merchant account for the tools                                                                                                                       |
| `TRUELAYER_TOKEN_SCOPE`                                     | no       | Token scopes, default `paydirect payments`. Use `payments` if Payouts isn't enabled on your client (the token request otherwise fails with `invalid_scope`). |
| `TRUELAYER_ENV_FILE`                                        | no       | Load the `.env` file from another path                                                                                                                       |

Variables already set in the environment take precedence over `.env`. The server checks the configuration at startup and exits listing anything missing. `.env` is gitignored; prefer the `_FILE` variants so secrets stay in files only you can read (`chmod 600`).

4. Build the project:
```bash
npm run build
```

## Development

```bash
npm test               # build, then run the test suite against a local mock of TrueLayer
npm run test:sandbox   # build, then run read-only checks against the real sandbox using your .env
npm run lint           # check lint and formatting with Biome
npm run fix            # apply safe fixes and format
```

The tests start the built server over stdio, the way an MCP client does, and point it at a mock TrueLayer server (`test/helpers/mock-truelayer.js`). The mock checks the `Tl-Signature` on signed requests against the test key, so signing regressions fail the tests. They never use your `.env`.

Code layout:

- `src/index.ts`: entry point; checks the configuration and starts the stdio server
- `src/config.ts`: environment and `.env` configuration
- `src/server.ts`: creates the MCP server and registers every tool module
- `src/api/client.ts`: access tokens (cached per scope), request signing, idempotency keys and error handling
- `src/api/<product>.ts`: one module per TrueLayer product, wrapping its endpoints
- `src/tools/<product>.ts`: one module per product, defining its MCP tools; `src/tools/shared.ts` has the annotation presets

## Configuration with Claude Desktop

To use this MCP server with Claude Desktop:

1. Locate your Claude Desktop configuration file:
   - macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - Windows: `%APPDATA%\Claude\claude_desktop_config.json`

2. Add the TrueLayer MCP server to your configuration:

```json
{
	"mcpServers": {
		"truelayer": {
			"command": "node",
			"args": ["/path/to/truelayer_mcp/build/index.js"]
		}
	}
}
```

Replace `/path/to/truelayer_mcp` with the actual path to this project on your system. The server picks up `.env` from the project root wherever the client starts it; alternatively, pass the variables in the server's `"env"` block, which overrides `.env`.

## Using with Claude

Once configured, you can ask Claude to perform TrueLayer operations. Here are some example prompts:

- "Create a payout of £100 to account number 12345678 with sort code 01-02-03."
- "Generate a payment link for £50."
- "List all transactions between 2023-01-01 and 2023-01-31."
- "Create a data connection for Jane Smith (jane@example.com) returning to https://example.com/done", then, once she has connected her bank: "What did she spend on groceries last month?"

When you ask Claude about these operations, it will use the MCP server to execute them through the TrueLayer API.

## Available Tools

Every tool declares MCP annotations so clients can decide when to ask before running it: read-only tools set `readOnlyHint`, and tools that move money or can't be undone set `destructiveHint` (marked 💸 below). The payout and payment link tools accept an optional `idempotency_key`; reuse it when retrying, so TrueLayer doesn't perform the operation twice. The Data API v3 doesn't take idempotency keys, so each call to `truelayer-data-create-connection` creates a new connection.

### Merchant accounts

- `truelayer-get-merchant-account`: details and balances of a merchant account (defaults to the configured one)
- `truelayer-list-merchant-accounts`: all merchant accounts available to the client
- `truelayer-list-transactions`: transactions for a merchant account (defaults to the last 30 days)

### Payments

- `truelayer-get-payment`: details and status of a payment

### Payment links

- `truelayer-create-payment-link`: create a single-payment link to your merchant account
- `truelayer-get-payment-link`: details and status of a payment link

### Payouts

- `truelayer-create-payout` 💸: pay out from a merchant account to an external account
- `truelayer-get-payout`: details and status of a payout

### Data API v3

Read a user's bank account data (UK banks). First create a connection: the user authorises it on TrueLayer's hosted page (`hosted_page.uri`), choosing their bank, consenting and logging in. Then read their data with the connection ID. Calls made without the user present are rate limited to 4 per day; pass the user's IP address as `user_ip` when they are present.

- `truelayer-data-create-connection`: start a connection with the scopes the user is asked to share (info, accounts, balance, transactions)
- `truelayer-data-get-user-info`: the user's name as held by their bank
- `truelayer-data-list-accounts`: the connected accounts, with identifiers and account holder names
- `truelayer-data-get-balance`: an account's current and available balance and overdraft
- `truelayer-data-get-transactions`: an account's transactions between two dates, optionally with categories and merchant names; waits for TrueLayer to prepare them. Each call is a new request to the bank, so fetch a result that wasn't ready with the next tool instead of calling it again
- `truelayer-data-get-transactions-request`: fetch a transactions result that wasn't ready in time

## License

MIT. See [LICENSE](LICENSE).
