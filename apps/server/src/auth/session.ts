import { createHmac, timingSafeEqual } from "node:crypto";

interface SessionPayload {
  readonly sub: string;
  readonly iat: number;
  readonly exp: number;
  readonly nonce: string;
}

export function createSession(
  username: string,
  secret: string,
  now: Date,
  ttlSeconds: number,
): string {
  const issuedAt = Math.floor(now.getTime() / 1000);
  const payload: SessionPayload = {
    sub: username,
    iat: issuedAt,
    exp: issuedAt + ttlSeconds,
    nonce: crypto.randomUUID(),
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${sign(encoded, secret)}`;
}

export function verifySession(token: string, secret: string, now: Date): SessionPayload | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [encoded, receivedSignature] = parts;
  if (encoded === undefined || receivedSignature === undefined) return null;
  const expectedSignature = sign(encoded, secret);
  if (!safeEqual(receivedSignature, expectedSignature)) return null;

  try {
    const payload: unknown = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    if (!isSessionPayload(payload)) return null;
    const current = Math.floor(now.getTime() / 1000);
    if (payload.iat > current || payload.exp <= current) return null;
    return payload;
  } catch {
    return null;
  }
}

export function sha256Matches(value: string, expected: string): boolean {
  const actual = new Bun.CryptoHasher("sha256").update(value).digest("hex");
  return safeEqual(`sha256:${actual}`, expected);
}

export function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.byteLength === rightBytes.byteLength && timingSafeEqual(leftBytes, rightBytes);
}

function sign(encoded: string, secret: string): string {
  return createHmac("sha256", Buffer.from(secret, "base64")).update(encoded).digest("base64url");
}

function isSessionPayload(value: unknown): value is SessionPayload {
  if (typeof value !== "object" || value === null) return false;
  const payload = value as Record<string, unknown>;
  return (
    typeof payload.sub === "string" &&
    typeof payload.iat === "number" &&
    Number.isSafeInteger(payload.iat) &&
    typeof payload.exp === "number" &&
    Number.isSafeInteger(payload.exp) &&
    typeof payload.nonce === "string"
  );
}
