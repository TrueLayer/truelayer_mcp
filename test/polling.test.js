// Unit tests for poll(), with a fake clock so the schedule runs without waiting.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { POLL_DELAYS_MS, poll } from "../build/tools/polling.js";

// A clock whose sleep() moves time forward at once and records each wait.
function fakeClock() {
	let now = 0;
	const sleeps = [];
	return {
		sleeps,
		now: () => now,
		sleep: async (ms) => {
			sleeps.push(ms);
			now += ms;
		},
	};
}

const isPending = (r) => r === "pending";

// Returns "pending" `pendingChecks` times, then "done".
function checker(pendingChecks) {
	let checks = 0;
	const check = async () => {
		checks += 1;
		return checks <= pendingChecks ? "pending" : "done";
	};
	return { check, count: () => checks };
}

describe("poll", () => {
	test("backs off 0.5s, 1s, 1.5s, then every 2s", async () => {
		assert.deepEqual(POLL_DELAYS_MS, [500, 1000, 1500, 2000]);
		const clock = fakeClock();
		const { check, count } = checker(5);
		const outcome = await poll("pending", isPending, check, 60_000, clock);
		assert.deepEqual(outcome, { result: "done" });
		assert.deepEqual(clock.sleeps, [500, 1000, 1500, 2000, 2000, 2000], "waits between checks");
		assert.equal(count(), 6, "checks until the result is ready");
	});

	test("shortens the last wait to end at the deadline, checks once more, then gives up", async () => {
		const clock = fakeClock();
		const { check, count } = checker(Number.POSITIVE_INFINITY);
		const outcome = await poll("pending", isPending, check, 4_000, clock);
		assert.deepEqual(outcome, { result: "pending" });
		assert.deepEqual(clock.sleeps, [500, 1000, 1500, 1000], "the last wait is cut to the 4s deadline");
		assert.equal(count(), 4, "one check after each wait");
	});

	test("with no time to wait, doesn't check at all", async () => {
		const clock = fakeClock();
		const { check, count } = checker(0);
		const outcome = await poll("pending", isPending, check, 0, clock);
		assert.deepEqual(outcome, { result: "pending" });
		assert.equal(count(), 0, "no checks");
	});

	test("doesn't wait when the initial result is already final", async () => {
		const clock = fakeClock();
		const outcome = await poll("done", isPending, checker(0).check, 10_000, clock);
		assert.deepEqual(outcome, { result: "done" });
		assert.deepEqual(clock.sleeps, [], "no waits");
	});

	test("stops at a failed check and returns the error with the last result", async () => {
		const clock = fakeClock();
		const failure = new Error("HTTP 503");
		let checks = 0;
		const check = async () => {
			checks += 1;
			if (checks === 2) throw failure;
			return "pending";
		};
		const outcome = await poll("pending", isPending, check, 60_000, clock);
		assert.equal(outcome.result, "pending");
		assert.equal(outcome.error, failure);
		assert.equal(checks, 2, "no checks after the failure");
	});
});
