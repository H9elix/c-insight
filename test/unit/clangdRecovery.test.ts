import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ClangdRecoveryPolicy,
  isBrokenClangdTransportError,
} from "../../src/clangd/clangdRecovery";

describe("clangd recovery policy", () => {
  it("allows four automatic restarts within the recovery window", () => {
    const policy = new ClangdRecoveryPolicy();

    for (let crash = 1; crash <= 4; crash += 1) {
      assert.deepEqual(policy.recordUnexpectedClose(crash * 1_000), {
        action: "restart",
        crashCount: crash,
        maxAutomaticRestarts: 4,
        windowMs: 180_000,
      });
    }
  });

  it("stops the fifth crash within three minutes", () => {
    const policy = new ClangdRecoveryPolicy();

    for (let crash = 0; crash < 4; crash += 1) {
      policy.recordUnexpectedClose(crash * 1_000);
    }

    assert.equal(policy.recordUnexpectedClose(4_000).action, "stop");
  });

  it("allows recovery after old crashes leave the sliding window", () => {
    const policy = new ClangdRecoveryPolicy(2, 10_000);

    policy.recordUnexpectedClose(0);
    policy.recordUnexpectedClose(1_000);
    assert.equal(policy.recordUnexpectedClose(2_000).action, "stop");

    assert.deepEqual(policy.recordUnexpectedClose(20_000), {
      action: "restart",
      crashCount: 1,
      maxAutomaticRestarts: 2,
      windowMs: 10_000,
    });
  });
});

describe("clangd broken transport classification", () => {
  it("recognizes EPIPE and destroyed-stream errors", () => {
    assert.equal(
      isBrokenClangdTransportError(
        Object.assign(new Error("write EPIPE"), { code: "EPIPE" }),
      ),
      true,
    );
    assert.equal(
      isBrokenClangdTransportError(
        new Error("Cannot call write after a stream was destroyed"),
      ),
      true,
    );
    assert.equal(
      isBrokenClangdTransportError({
        code: "ERR_STREAM_DESTROYED",
        message: "Cannot call write after a stream was destroyed",
      }),
      true,
    );
  });

  it("does not hide unrelated language-client errors", () => {
    assert.equal(
      isBrokenClangdTransportError(new Error("Request failed: method not found")),
      false,
    );
    assert.equal(isBrokenClangdTransportError(undefined), false);
  });
});
