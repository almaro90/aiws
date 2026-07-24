import type { Stores } from "./stores.ts";

export interface UnitOfWork {
  execute<T>(work: (stores: Stores) => Promise<T>): Promise<T>;
}
