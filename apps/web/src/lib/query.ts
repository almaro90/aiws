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

export function protectedRedirect(pathname: string, authenticated: boolean): string | null {
  if (authenticated) return null;
  return `/login?redirect=${encodeURIComponent(pathname)}`;
}
