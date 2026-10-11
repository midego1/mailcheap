import assert from "node:assert/strict";
import { test } from "node:test";
import { getClientIp } from "../lib/rate-limit.js";
import { getReactivatableStatuses } from "../lib/resubscribe.js";

const headers = (values) => new Headers(values);

test("rate limits key on the entry the proxy added, not the one the client sent", () => {
	delete process.env.TRUSTED_PROXY_COUNT;
	assert.equal(getClientIp(headers({ "x-forwarded-for": "203.0.113.7" })), "203.0.113.7");
	assert.equal(getClientIp(headers({ "x-forwarded-for": "1.2.3.4, 203.0.113.7" })), "203.0.113.7", "spoofed first entry");
	assert.equal(getClientIp(headers({ "x-forwarded-for": "1.2.3.4,5.6.7.8 , 203.0.113.7 " })), "203.0.113.7");
	assert.equal(getClientIp(headers({ "x-real-ip": "203.0.113.9" })), "203.0.113.9");
	assert.equal(getClientIp(headers({})), "unknown");
});

test("TRUSTED_PROXY_COUNT reads further back for each proxy", () => {
	process.env.TRUSTED_PROXY_COUNT = "2";
	assert.equal(getClientIp(headers({ "x-forwarded-for": "1.2.3.4, 203.0.113.7, 10.0.0.2" })), "203.0.113.7");
	assert.equal(getClientIp(headers({ "x-forwarded-for": "203.0.113.7" })), "203.0.113.7");
	process.env.TRUSTED_PROXY_COUNT = "nonsense";
	assert.equal(getClientIp(headers({ "x-forwarded-for": "1.2.3.4, 203.0.113.7" })), "203.0.113.7");
	delete process.env.TRUSTED_PROXY_COUNT;
});

test("an unsubscribed contact only comes back through the confirmation email", () => {
	assert.deepEqual(getReactivatableStatuses({ requireConfirmation: false }), ["dormant"]);
	assert.deepEqual(getReactivatableStatuses({ requireConfirmation: true }), ["unsubscribed", "dormant"]);
	assert.deepEqual(getReactivatableStatuses(null), ["dormant"]);
});
