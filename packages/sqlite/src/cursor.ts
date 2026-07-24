import { ValidationError } from "@aiws/core";

export type CursorOrder = "asc" | "desc";

interface CursorPayload {
  readonly v: 1;
  readonly sort: string;
  readonly order: CursorOrder;
  readonly value: string;
  readonly id: string;
  readonly filter: string;
}

export interface CursorContext {
  readonly sort: string;
  readonly order: CursorOrder;
  readonly filter: Readonly<Record<string, unknown>>;
}

export interface CursorPosition {
  readonly value: string;
  readonly id: string;
}

export function encodeCursor(context: CursorContext, position: CursorPosition): string {
  const payload: CursorPayload = {
    v: 1,
    sort: context.sort,
    order: context.order,
    value: position.value,
    id: position.id,
    filter: filterKey(context.filter),
  };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decodeCursor(value: string, context: CursorContext): CursorPosition {
  try {
    const decoded: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (!isCursorPayload(decoded)) throw new Error("Invalid cursor payload.");
    if (
      decoded.sort !== context.sort ||
      decoded.order !== context.order ||
      decoded.filter !== filterKey(context.filter)
    ) {
      throw new Error("Cursor context does not match.");
    }
    return { value: decoded.value, id: decoded.id };
  } catch {
    throw new ValidationError([{ path: "cursor", message: "Cursor is invalid for this query." }]);
  }
}

export function assertPageLimit(limit: number): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    throw new ValidationError([{ path: "limit", message: "Must be an integer from 1 to 200." }]);
  }
}

function filterKey(filter: Readonly<Record<string, unknown>>): string {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(filter)
        .filter(([, value]) => value !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, value]) => [key, Array.isArray(value) ? [...value].sort() : value]),
    ),
  );
}

function isCursorPayload(value: unknown): value is CursorPayload {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<CursorPayload>;
  return (
    candidate.v === 1 &&
    typeof candidate.sort === "string" &&
    (candidate.order === "asc" || candidate.order === "desc") &&
    typeof candidate.value === "string" &&
    typeof candidate.id === "string" &&
    typeof candidate.filter === "string"
  );
}
