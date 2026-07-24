export class LoginRateLimiter {
  private readonly attempts = new Map<string, number[]>();

  constructor(
    private readonly maximum: number,
    private readonly windowSeconds: number,
    private readonly now: () => number = Date.now,
  ) {}

  consume(ip: string): { allowed: true } | { allowed: false; retryAfter: number } {
    const now = this.now();
    const windowStart = now - this.windowSeconds * 1000;
    const global = this.active("global", windowStart);
    const perIp = this.active(`ip:${ip}`, windowStart);
    if (global.length >= this.maximum || perIp.length >= this.maximum) {
      const oldest = Math.min(global[0] ?? now, perIp[0] ?? now);
      return {
        allowed: false,
        retryAfter: Math.max(1, Math.ceil((oldest + this.windowSeconds * 1000 - now) / 1000)),
      };
    }
    global.push(now);
    perIp.push(now);
    this.attempts.set("global", global);
    this.attempts.set(`ip:${ip}`, perIp);
    return { allowed: true };
  }

  private active(key: string, windowStart: number): number[] {
    return (this.attempts.get(key) ?? []).filter((attempt) => attempt > windowStart);
  }
}
