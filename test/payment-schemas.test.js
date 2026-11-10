// Unit tests for the Payments API v3 input schemas: one case per rule, checking
// which field failed, so a case rejected for some other reason doesn't pass.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { z } from "zod";
import {
	authorizationFlowCapabilities,
	beneficiary,
	hostedPage,
	metadata,
	paymentUser,
	providerSelection,
	searchFlowConfiguration,
	subMerchants,
} from "../build/tools/payment-schemas.js";

// Asserts that `schema` rejects `value`, and that an issue is at `path`.
function rejects(schema, value, path) {
	const result = schema.safeParse(value);
	assert.equal(result.success, false, `expected ${JSON.stringify(value)} to be rejected`);
	const paths = result.error.issues.map((issue) => issue.path.join("."));
	assert.ok(paths.includes(path), `expected an issue at ${path}, got ${JSON.stringify(paths)}`);
}

function accepts(schema, value) {
	const result = schema.safeParse(value);
	assert.equal(result.success, true, result.success ? "" : JSON.stringify(result.error.issues));
}

const sortCode = { type: "sort_code_account_number", sort_code: "040668", account_number: "00000871" };
const external = {
	type: "external_account",
	account_holder_name: "Jane Doe",
	account_identifier: sortCode,
	reference: "INV-1",
};

describe("beneficiary", () => {
	test("accepts a valid external account and merchant account", () => {
		accepts(beneficiary, external);
		accepts(beneficiary, { type: "merchant_account", reference: "Order 1234", statement_reference: "SHOP 1234" });
	});

	test("external account reference: at most 18 characters", () => {
		accepts(beneficiary, { ...external, reference: "A".repeat(18) });
		rejects(beneficiary, { ...external, reference: "A".repeat(19) }, "reference");
	});

	test("external account reference: only the allowed characters", () => {
		accepts(beneficiary, { ...external, reference: "a-Z0:().,'+ ?/" });
		rejects(beneficiary, { ...external, reference: "INV#1" }, "reference");
		rejects(beneficiary, { ...external, reference: "INV_1" }, "reference");
	});

	test("merchant account reference: at most 100 characters", () => {
		accepts(beneficiary, { type: "merchant_account", reference: "A".repeat(100) });
		rejects(beneficiary, { type: "merchant_account", reference: "A".repeat(101) }, "reference");
	});

	test("merchant account statement_reference: at most 18 allowed characters", () => {
		rejects(beneficiary, { type: "merchant_account", statement_reference: "A".repeat(19) }, "statement_reference");
		rejects(beneficiary, { type: "merchant_account", statement_reference: "SHOP&CO" }, "statement_reference");
	});

	test("account holder name: no parentheses, at most 40 characters", () => {
		rejects(beneficiary, { ...external, account_holder_name: "Jane (Ltd)" }, "account_holder_name");
		rejects(beneficiary, { ...external, account_holder_name: "J".repeat(41) }, "account_holder_name");
	});

	test("sort code: 6 digits, and account number: 8 digits", () => {
		rejects(
			beneficiary,
			{ ...external, account_identifier: { ...sortCode, sort_code: "04-06-68" } },
			"account_identifier.sort_code",
		);
		rejects(
			beneficiary,
			{ ...external, account_identifier: { ...sortCode, account_number: "0871" } },
			"account_identifier.account_number",
		);
	});

	test("IBAN: no spaces, country code and check digits first", () => {
		accepts(beneficiary, { ...external, account_identifier: { type: "iban", iban: "GB33BUKB20201555555555" } });
		rejects(
			beneficiary,
			{ ...external, account_identifier: { type: "iban", iban: "GB33 BUKB 2020 1555 5555 55" } },
			"account_identifier.iban",
		);
		rejects(
			beneficiary,
			{ ...external, account_identifier: { type: "iban", iban: "33GBBUKB20201555555555" } },
			"account_identifier.iban",
		);
	});
});

describe("providerSelection", () => {
	test("remitter account holder name: no parentheses", () => {
		rejects(
			providerSelection,
			{ type: "user_selected", remitter: { account_holder_name: "Jane (Ltd)" } },
			"remitter.account_holder_name",
		);
	});

	test("preselected scheme defaults to instant_preferred", () => {
		const result = providerSelection.parse({ type: "preselected", provider_id: "ob-bank" });
		assert.deepEqual(result.scheme_selection, { type: "instant_preferred" });
	});
});

describe("paymentUser", () => {
	test("name: no parentheses", () => {
		rejects(paymentUser, { name: "Jane (Doe)" }, "name");
	});

	test("date_of_birth: YYYY-MM-DD", () => {
		accepts(paymentUser, { date_of_birth: "1990-01-31" });
		rejects(paymentUser, { date_of_birth: "31/01/1990" }, "date_of_birth");
	});

	test("address country_code: two letters", () => {
		const address = { address_line1: "1 Street", city: "London", zip: "N1 1AA", country_code: "GBR" };
		rejects(paymentUser, { address }, "address.country_code");
	});
});

describe("metadata", () => {
	test("at most 10 pairs", () => {
		accepts(metadata, Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`k${i}`, "v"])));
		rejects(metadata, Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`k${i}`, "v"])), "");
	});

	test("keys up to 40 characters, values up to 500", () => {
		rejects(metadata, { ["k".repeat(41)]: "v" }, "k".repeat(41));
		rejects(metadata, { k: "v".repeat(501) }, "k");
	});
});

describe("hostedPage", () => {
	const page = { return_uri: "https://example.test/return" };

	test("return_uri: a URL", () => {
		rejects(hostedPage, { return_uri: "not a url" }, "return_uri");
	});

	test("country_code: two upper-case letters", () => {
		accepts(hostedPage, { ...page, country_code: "GB" });
		rejects(hostedPage, { ...page, country_code: "gb" }, "country_code");
	});

	test("language_code: two lower-case letters", () => {
		accepts(hostedPage, { ...page, language_code: "en" });
		rejects(hostedPage, { ...page, language_code: "EN" }, "language_code");
	});

	test("max_wait_for_result: 0 to 60 seconds", () => {
		accepts(hostedPage, { ...page, max_wait_for_result: 60 });
		rejects(hostedPage, { ...page, max_wait_for_result: 61 }, "max_wait_for_result");
	});
});

describe("subMerchants", () => {
	const client = { type: "business_client", id: "c1", trading_name: "Shoes" };

	test("mcc: four digits", () => {
		accepts(subMerchants, { ultimate_counterparty: { ...client, mcc: "5661" } });
		rejects(subMerchants, { ultimate_counterparty: { ...client, mcc: "566" } }, "ultimate_counterparty.mcc");
	});

	test("trading_name: at most 70 characters", () => {
		rejects(
			subMerchants,
			{ ultimate_counterparty: { ...client, trading_name: "S".repeat(71) } },
			"ultimate_counterparty.trading_name",
		);
	});
});

describe("authorization flow capabilities", () => {
	const capabilities = z.object(authorizationFlowCapabilities);

	test("redirect needs a return_uri", () => {
		accepts(capabilities, { redirect: { return_uri: "https://example.test/return" } });
		rejects(capabilities, { redirect: {} }, "redirect.return_uri");
	});

	test("form needs at least one input type", () => {
		rejects(capabilities, { form: { input_types: [] } }, "form.input_types");
	});

	test("the search configuration takes redirect without a return_uri", () => {
		accepts(searchFlowConfiguration, { redirect: {}, provider_selection: {} });
	});
});
