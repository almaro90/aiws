export interface RunnerActivityStatus {
  readonly status: "online" | "offline" | "unknown";
  readonly lastSeenAt: string | null;
  readonly offlineAfterSeconds: number;
}

export class RunnerActivityMonitor {
  private lastSeen: Date | null = null;

  constructor(
    private readonly now: () => Date = () => new Date(),
    private readonly offlineAfterMilliseconds = 45_000,
  ) {}

  seen(): void {
    this.lastSeen = this.now();
  }

  status(): RunnerActivityStatus {
    const current = this.now();
    const lastSeenAt = this.lastSeen?.toISOString() ?? null;
    return {
      status:
        this.lastSeen === null
          ? "unknown"
          : current.getTime() - this.lastSeen.getTime() <= this.offlineAfterMilliseconds
            ? "online"
            : "offline",
      lastSeenAt,
      offlineAfterSeconds: Math.ceil(this.offlineAfterMilliseconds / 1_000),
    };
  }
}
