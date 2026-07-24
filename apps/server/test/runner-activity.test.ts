import { describe, expect, test } from "bun:test";
import { RunnerActivityMonitor } from "../src/runner-activity.ts";

describe("Runner activity monitor", () => {
  test("moves from unknown to online and offline using the bounded heartbeat window", () => {
    let now = new Date("2026-07-24T06:00:00.000Z");
    const monitor = new RunnerActivityMonitor(() => now, 45_000);
    expect(monitor.status()).toEqual({
      status: "unknown",
      lastSeenAt: null,
      offlineAfterSeconds: 45,
    });
    monitor.seen();
    expect(monitor.status()).toMatchObject({
      status: "online",
      lastSeenAt: "2026-07-24T06:00:00.000Z",
    });
    now = new Date("2026-07-24T06:00:46.000Z");
    expect(monitor.status()).toMatchObject({
      status: "offline",
      lastSeenAt: "2026-07-24T06:00:00.000Z",
    });
  });
});
