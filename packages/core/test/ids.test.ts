import { describe, expect, test } from "bun:test";
import { type Clock, SystemClock, UlidIdGenerator } from "../src/index.ts";

const ULID_ALPHABET = /^[0-9A-HJKMNP-TV-Z]{26}$/;

class FixedClock implements Clock {
  constructor(private readonly instant: Date) {}

  now(): Date {
    return new Date(this.instant);
  }
}

describe("SystemClock", () => {
  test("returns the current time", () => {
    const before = Date.now();
    const actual = new SystemClock().now().getTime();
    const after = Date.now();

    expect(actual).toBeGreaterThanOrEqual(before);
    expect(actual).toBeLessThanOrEqual(after);
  });
});

describe("UlidIdGenerator", () => {
  test("generates every documented ID shape", () => {
    const ids = new UlidIdGenerator(new FixedClock(new Date("2026-07-21T12:00:00.000Z")));
    const generated = [
      ["prj_", ids.projectId()],
      ["tsk_", ids.taskId()],
      ["qst_", ids.questionId()],
      ["opt_", ids.optionId()],
      ["att_", ids.attachmentId()],
      ["evt_", ids.eventId()],
      ["con_", ids.connectionId()],
      ["agp_", ids.agentProfileId()],
      ["run_", ids.runId()],
      ["cyc_", ids.cycleId()],
      ["msg_", ids.messageId()],
      ["spc_", ids.specRevisionId()],
      ["ans_", ids.questionAnswerId()],
      ["dlv_", ids.deliveryId()],
    ] as const;

    for (const [prefix, id] of generated) {
      expect(id).toHaveLength(30);
      expect(id.startsWith(prefix)).toBe(true);
      expect(id.slice(4)).toMatch(ULID_ALPHABET);
    }
  });

  test("is unique and monotonic when the clock is fixed", () => {
    const ids = new UlidIdGenerator(new FixedClock(new Date("2026-07-21T12:00:00.000Z")));
    const generated = Array.from({ length: 1_000 }, () => ids.taskId());

    expect(new Set(generated).size).toBe(generated.length);
    expect([...generated].sort()).toEqual(generated);
  });
});
