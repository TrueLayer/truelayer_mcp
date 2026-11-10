// Waits for an asynchronous TrueLayer result, such as a Data API v3
// transactions request. Time comes from a Clock, so tests can run the schedule
// without waiting.

export interface Clock {
	now(): number;
	sleep(ms: number): Promise<void>;
}

export const systemClock: Clock = {
	now: () => Date.now(),
	sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

// Start quickly, then back off: 0.5s, 1s, 1.5s, then every 2s.
export const POLL_DELAYS_MS = [500, 1000, 1500, 2000];

export interface PollOutcome<T> {
	// The last result seen: the final one, or the last pending one if time ran
	// out or a check failed.
	result: T;
	// Set when a check failed; the caller decides how to report it.
	error?: unknown;
}

// Checks `check` until `isPending` is false or `waitMs` has passed, starting
// from `initial`. The last wait is shortened so it ends at the deadline, and one
// more check runs then. A failed check stops polling and is returned, not thrown,
// so the caller can still report what it created.
export async function poll<T>(
	initial: T,
	isPending: (result: T) => boolean,
	check: () => Promise<T>,
	waitMs: number,
	clock: Clock = systemClock,
): Promise<PollOutcome<T>> {
	let result = initial;
	const deadline = clock.now() + waitMs;
	for (let attempt = 0; isPending(result) && clock.now() < deadline; attempt++) {
		const delay = POLL_DELAYS_MS[Math.min(attempt, POLL_DELAYS_MS.length - 1)];
		await clock.sleep(Math.min(delay, Math.max(0, deadline - clock.now())));
		try {
			result = await check();
		} catch (error) {
			return { result, error };
		}
	}
	return { result };
}
