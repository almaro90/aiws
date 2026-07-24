export interface TaskFilters {
  readonly projectId?: string;
  readonly status?: readonly string[];
  readonly accountScope?: string;
  readonly gitProvider?: string;
  readonly archived?: boolean;
  readonly sort?: "updatedAt" | "createdAt";
  readonly order?: "asc" | "desc";
  readonly cursor?: string;
}

export interface ProjectFilters {
  readonly gitProvider?: string;
  readonly accountScope?: string;
  readonly archived?: boolean;
}

export function parseTaskFilters(search: Record<string, unknown>): TaskFilters {
  const rawStatus = search.status;
  const status = Array.isArray(rawStatus)
    ? rawStatus.filter((value): value is string => typeof value === "string")
    : typeof rawStatus === "string"
      ? [rawStatus]
      : [];
  return {
    ...(typeof search.projectId === "string" && search.projectId
      ? { projectId: search.projectId }
      : {}),
    ...(status.length ? { status } : {}),
    ...(typeof search.accountScope === "string" && search.accountScope
      ? { accountScope: search.accountScope }
      : {}),
    ...(typeof search.gitProvider === "string" && search.gitProvider
      ? { gitProvider: search.gitProvider }
      : {}),
    archived: search.archived === true || search.archived === "true",
    sort: search.sort === "createdAt" ? "createdAt" : "updatedAt",
    order: search.order === "asc" ? "asc" : "desc",
  };
}

export function serializeTaskFilters(filters: TaskFilters): string {
  const query = new URLSearchParams();
  if (filters.projectId) query.set("projectId", filters.projectId);
  for (const status of filters.status ?? []) query.append("status", status);
  if (filters.accountScope) query.set("accountScope", filters.accountScope);
  if (filters.gitProvider) query.set("gitProvider", filters.gitProvider);
  if (filters.archived) query.set("archived", "true");
  if (filters.sort && filters.sort !== "updatedAt") query.set("sort", filters.sort);
  if (filters.order && filters.order !== "desc") query.set("order", filters.order);
  if (filters.cursor) query.set("cursor", filters.cursor);
  const value = query.toString();
  return value.length === 0 ? "" : `?${value}`;
}

export function parseProjectFilters(search: Record<string, unknown>): ProjectFilters {
  return {
    ...(typeof search.gitProvider === "string" && search.gitProvider
      ? { gitProvider: search.gitProvider }
      : {}),
    ...(typeof search.accountScope === "string" && search.accountScope
      ? { accountScope: search.accountScope }
      : {}),
    archived: search.archived === true || search.archived === "true",
  };
}

export function serializeProjectFilters(filters: ProjectFilters): string {
  const query = new URLSearchParams();
  if (filters.gitProvider) query.set("gitProvider", filters.gitProvider);
  if (filters.accountScope) query.set("accountScope", filters.accountScope);
  if (filters.archived) query.set("archived", "true");
  const value = query.toString();
  return value.length === 0 ? "" : `?${value}`;
}

export function mergePageItems<T extends { readonly id: string }>(
  current: readonly T[],
  next: readonly T[],
): T[] {
  const seen = new Set(current.map((item) => item.id));
  return [...current, ...next.filter((item) => !seen.has(item.id))];
}

export function protectedRedirect(pathname: string, authenticated: boolean): string | null {
  if (authenticated) return null;
  return `/login?redirect=${encodeURIComponent(pathname)}`;
}
