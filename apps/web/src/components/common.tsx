import { Link, useRouter } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  ArchiveIcon,
  CheckCircle2Icon,
  CircleDotIcon,
  CircleIcon,
  ClipboardIcon,
  FolderGit2Icon,
  BotIcon,
  LoaderCircleIcon,
  LogOutIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  SparklesIcon,
  ShieldAlertIcon,
  BellIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";
import { type ReactElement, type ReactNode, useState } from "react";
import { toast } from "sonner";
import { api, ApiError } from "../lib/api.ts";
import {
  ConnectivityProvider,
  formatRelativeAge,
  useConnectivity,
  useRelativeAge,
} from "../lib/connectivity.tsx";
import { cn } from "../lib/utils.ts";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "./ui/alert-dialog.tsx";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert.tsx";
import { Badge } from "./ui/badge.tsx";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "./ui/breadcrumb.tsx";
import { Button, buttonVariants } from "./ui/button.tsx";
import {
  Empty as EmptyPrimitive,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "./ui/empty.tsx";
import {
  Sidebar,
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "./ui/sidebar.tsx";
import { Skeleton } from "./ui/skeleton.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip.tsx";

const navigation = [
  { to: "/attention" as const, label: "Necesita atención", icon: TriangleAlertIcon },
  { to: "/tasks" as const, label: "Tasks", icon: CircleDotIcon },
  { to: "/projects" as const, label: "Projects", icon: FolderGit2Icon },
  { to: "/automation" as const, label: "Automatización", icon: BotIcon },
  { to: "/notifications" as const, label: "Notificaciones", icon: BellIcon },
];

export function Shell({ children }: { readonly children: ReactNode }) {
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);

  const logout = async () => {
    setLoggingOut(true);
    await api.logout().catch(() => undefined);
    await router.navigate({ to: "/login", search: { redirect: undefined } });
    await router.invalidate();
  };

  return (
    <ConnectivityProvider>
      <SidebarProvider>
        <div className="min-h-svh bg-background">
          <Sidebar>
            <Brand />
            <Navigation />
            <SidebarFooter loggingOut={loggingOut} logout={logout} />
          </Sidebar>
          <SidebarInset>
            <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b bg-background/92 px-4 backdrop-blur sm:px-6">
              <SidebarTrigger />
              <Brand compact className="lg:hidden" />
              <div className="ml-auto">
                <span className="lg:hidden">
                  <RunnerIndicator compact />
                </span>
                <span className="hidden lg:inline">
                  <RunnerIndicator />
                </span>
              </div>
            </header>
            <ApiConnectivity />
            <main className="mx-auto grid w-full max-w-7xl gap-5 px-4 py-5 sm:px-6 lg:px-8 lg:py-8">
              {children}
            </main>
          </SidebarInset>
        </div>
      </SidebarProvider>
    </ConnectivityProvider>
  );
}

function SidebarFooter({
  loggingOut,
  logout,
}: {
  readonly loggingOut: boolean;
  readonly logout: () => Promise<void>;
}) {
  const { collapsed } = useSidebar();
  return (
    <div className="mt-auto space-y-2 border-t p-3">
      <p className={cn("px-2 text-xs text-muted-foreground", collapsed && "lg:sr-only")}>
        AIWS · v0.8.0
      </p>
      <Button
        className={cn("w-full", collapsed ? "lg:justify-center" : "justify-start")}
        variant="ghost"
        disabled={loggingOut}
        aria-label="Cerrar sesión"
        onClick={() => void logout()}
      >
        <LogOutIcon data-icon="inline-start" />
        <span className={cn(collapsed && "lg:sr-only")}>
          {loggingOut ? "Saliendo…" : "Cerrar sesión"}
        </span>
      </Button>
    </div>
  );
}

export function RunnerIndicator({ compact = false }: { readonly compact?: boolean }) {
  const query = useQuery({
    queryKey: ["runner-status"],
    queryFn: api.runnerStatus,
    refetchInterval: 15_000,
    staleTime: 0,
  });
  const status = query.data?.status ?? (query.isError ? "offline" : "unknown");
  const label =
    status === "online"
      ? "Runner activo"
      : status === "offline"
        ? "Runner sin conexión"
        : "Runner sin señal";
  return (
    <Link
      to="/automation"
      aria-label={label}
      title={
        query.data?.lastSeenAt
          ? `${label}. Última señal: ${formatDate(query.data.lastSeenAt)}`
          : label
      }
      className="inline-flex items-center gap-2 rounded-md border bg-background px-2.5 py-1.5 text-xs font-medium"
    >
      <span
        aria-hidden="true"
        className={cn(
          "size-2 rounded-full",
          status === "online"
            ? "bg-emerald-500"
            : status === "offline"
              ? "bg-destructive"
              : "bg-amber-500",
        )}
      />
      {!compact ? label : <span className="sr-only">{label}</span>}
    </Link>
  );
}

function ApiConnectivity() {
  const connectivity = useConnectivity();
  const [checking, setChecking] = useState(false);
  const age = useRelativeAge(connectivity.lastSuccessfulAt);
  const check = async () => {
    setChecking(true);
    try {
      await connectivity.check();
    } finally {
      setChecking(false);
    }
  };

  if (connectivity.state !== "offline") return null;
  return (
    <output
      aria-live="polite"
      className="flex flex-wrap items-center gap-3 border-b border-destructive/30 bg-destructive/5 px-4 py-2 text-sm text-destructive"
    >
      <span className="min-w-0 flex-1">
        No se puede contactar con la API. El contenido mostrado se conserva; los cambios pueden
        fallar hasta recuperar la conexión.
        {age ? ` Última conexión correcta ${age}.` : ""}
      </span>
      <Button size="sm" variant="outline" disabled={checking} onClick={() => void check()}>
        <RefreshCwIcon data-icon="inline-start" />
        {checking ? "Comprobando…" : "Reintentar conexión"}
      </Button>
    </output>
  );
}

function Brand({
  compact = false,
  className,
}: {
  readonly compact?: boolean;
  readonly className?: string;
}) {
  const sidebar = useSidebar();
  return (
    <Link
      to="/tasks"
      className={cn("flex items-center gap-3", compact ? "" : "h-16 border-b px-4", className)}
    >
      <img
        src="/aiws-logo.png"
        alt=""
        aria-hidden="true"
        data-brand-logo={compact ? "mobile-header" : "sidebar"}
        className="size-8 shrink-0 object-contain"
      />
      <span className={cn(sidebar?.collapsed && "lg:sr-only")}>
        <strong className="block leading-none">AIWS</strong>
        {!compact ? <span className="text-xs text-muted-foreground">Task workspace</span> : null}
      </span>
    </Link>
  );
}

function Navigation() {
  const { collapsed, setMobileOpen } = useSidebar();
  return (
    <nav aria-label="Principal" className="grid gap-1 p-3">
      {navigation.map(({ to, label, icon: Icon }) => (
        <Link
          key={to}
          to={to}
          title={collapsed ? label : undefined}
          className={cn(
            "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
            collapsed && "lg:justify-center lg:px-2",
          )}
          activeProps={{ className: "bg-sidebar-accent text-sidebar-accent-foreground" }}
          onClick={() => setMobileOpen(false)}
        >
          <Icon className="size-4 shrink-0" />
          <span className={cn(collapsed && "lg:sr-only")}>{label}</span>
        </Link>
      ))}
    </nav>
  );
}

export function PageBreadcrumb({
  parent,
  current,
}: {
  readonly parent: { readonly to: "/projects" | "/tasks"; readonly label: string };
  readonly current: string;
}) {
  return (
    <Breadcrumb className="min-w-0 max-w-full overflow-hidden">
      <BreadcrumbList className="min-w-0 max-w-full">
        <BreadcrumbItem>
          <BreadcrumbLink render={<Link to={parent.to} />}>{parent.label}</BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem className="min-w-0">
          <BreadcrumbPage className="min-w-0 max-w-full truncate" title={current}>
            {current}
          </BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  );
}

export function ActiveFilters({
  filters,
  clearLabel = "Limpiar filtros",
  onRemove,
  onClear,
}: {
  readonly filters: readonly { readonly key: string; readonly label: string }[];
  readonly clearLabel?: string;
  readonly onRemove: (key: string) => void;
  readonly onClear: () => void;
}) {
  if (filters.length === 0) return null;
  return (
    <fieldset className="flex flex-wrap items-center gap-2">
      <legend className="sr-only">Filtros activos</legend>
      <span className="text-xs font-medium text-muted-foreground">Filtros activos:</span>
      {filters.map((filter) => (
        <Badge key={filter.key} variant="secondary" className="gap-1 pr-1">
          {filter.label}
          <button
            type="button"
            className="rounded-sm p-0.5 hover:bg-foreground/10 focus-visible:outline-2 focus-visible:outline-offset-1"
            aria-label={`Quitar filtro ${filter.label}`}
            onClick={() => onRemove(filter.key)}
          >
            <XIcon className="size-3" />
          </button>
        </Badge>
      ))}
      <Button variant="ghost" size="xs" type="button" onClick={onClear}>
        {clearLabel}
      </Button>
    </fieldset>
  );
}

export function LoadMoreFooter({
  count,
  hasMore,
  pending,
  error,
  onLoadMore,
}: {
  readonly count: number;
  readonly hasMore: boolean;
  readonly pending: boolean;
  readonly error?: unknown;
  readonly onLoadMore: () => void;
}) {
  return (
    <div className="grid justify-items-center gap-2" aria-live="polite">
      <p className="text-xs text-muted-foreground">
        {count} {count === 1 ? "resultado cargado" : "resultados cargados"}
      </p>
      {error ? <ErrorNotice error={error} retry={onLoadMore} /> : null}
      {hasMore ? (
        <Button variant="outline" disabled={pending} onClick={onLoadMore}>
          {pending ? "Cargando…" : "Cargar más"}
        </Button>
      ) : null}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  headingLevel = 1,
}: {
  readonly title: string;
  readonly description?: string;
  readonly actions?: ReactNode;
  readonly headingLevel?: 1 | 2;
}) {
  const Heading = headingLevel === 1 ? "h1" : "h2";
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <Heading className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</Heading>
        {description ? (
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Loading({ label = "Cargando" }: { readonly label?: string }) {
  return (
    <output className="grid gap-3" aria-label={label}>
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-16 w-full" />
      <span className="sr-only">{label}…</span>
    </output>
  );
}

export function FreshnessStatus({
  updatedAt,
  fetching = false,
  error,
  retry,
}: {
  readonly updatedAt: number;
  readonly fetching?: boolean;
  readonly error?: unknown;
  readonly retry?: () => void;
}) {
  const connectivity = useConnectivity();
  const age = useRelativeAge(updatedAt);
  const stale = connectivity.state === "offline" || error !== undefined;
  return (
    <div
      className={cn(
        "flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted-foreground",
        stale && "text-amber-800",
      )}
      {...(error !== undefined && connectivity.state !== "offline"
        ? { role: "status" as const }
        : {})}
    >
      <span>
        {fetching
          ? "Actualizando…"
          : stale
            ? `Snapshot actualizado ${age ?? formatRelativeAge(updatedAt)}`
            : `Actualizado ${age ?? formatRelativeAge(updatedAt)}`}
      </span>
      {stale && retry ? (
        <Button size="xs" variant="ghost" type="button" onClick={retry}>
          <RefreshCwIcon data-icon="inline-start" />
          Reintentar
        </Button>
      ) : null}
    </div>
  );
}

export function Empty({
  title = "No hay resultados",
  children,
  action,
  headingLevel = 2,
}: {
  readonly title?: string;
  readonly children: ReactNode;
  readonly action?: ReactNode;
  readonly headingLevel?: 1 | 2 | 3;
}) {
  const headingTag = headingLevel === 1 ? "h1" : headingLevel === 2 ? "h2" : "h3";
  return (
    <EmptyPrimitive className="border bg-card py-10">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <CircleIcon />
        </EmptyMedia>
        <EmptyTitle as={headingTag}>{title}</EmptyTitle>
        <EmptyDescription>{children}</EmptyDescription>
      </EmptyHeader>
      {action}
    </EmptyPrimitive>
  );
}

export function ErrorNotice({
  error,
  retry,
}: {
  readonly error: unknown;
  readonly retry?: () => void;
}) {
  const apiError = error instanceof ApiError ? error : null;
  const hasFieldErrors =
    Array.isArray(apiError?.details?.fields) && apiError.details.fields.length > 0;
  return (
    <Alert variant="destructive" role={hasFieldErrors ? undefined : "alert"}>
      <ShieldAlertIcon />
      <AlertTitle>{apiError?.message ?? "Ha ocurrido un error."}</AlertTitle>
      <AlertDescription className="space-y-2">
        {apiError?.requestId ? <CopyValue label="Request ID" value={apiError.requestId} /> : null}
        {retry ? (
          <Button size="sm" variant="outline" type="button" onClick={retry}>
            <RefreshCwIcon data-icon="inline-start" /> Reintentar
          </Button>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}

export function CopyValue({ label, value }: { readonly label: string; readonly value: string }) {
  const copy = async () => {
    await navigator.clipboard.writeText(value);
    toast.success(`${label} copiado`);
  };
  return (
    <span className="inline-flex max-w-full min-w-0 items-center gap-1.5 font-mono text-xs text-muted-foreground">
      <span className="truncate" title={value}>
        {label}: {value}
      </span>
      <Tooltip>
        <TooltipTrigger
          render={<Button variant="ghost" size="icon-xs" type="button" onClick={copy} />}
        >
          <ClipboardIcon />
          <span className="sr-only">Copiar {label}</span>
        </TooltipTrigger>
        <TooltipContent>Copiar {label}</TooltipContent>
      </Tooltip>
    </span>
  );
}

const statusPresentation: Record<
  string,
  { label: string; className: string; icon: typeof CircleIcon }
> = {
  draft: {
    label: "Draft",
    className: "border-slate-300 bg-slate-100 text-slate-700",
    icon: CircleIcon,
  },
  curating: {
    label: "Curating",
    className: "border-cyan-300 bg-cyan-50 text-cyan-900",
    icon: SparklesIcon,
  },
  blocked: {
    label: "Blocked",
    className: "border-amber-300 bg-amber-50 text-amber-800",
    icon: TriangleAlertIcon,
  },
  ready: {
    label: "Ready",
    className: "border-emerald-300 bg-emerald-50 text-emerald-800",
    icon: CheckCircle2Icon,
  },
  implementing: {
    label: "Implementing",
    className: "border-blue-300 bg-blue-50 text-blue-800",
    icon: LoaderCircleIcon,
  },
  done: {
    label: "Done",
    className: "border-violet-300 bg-violet-50 text-violet-800",
    icon: CheckCircle2Icon,
  },
  open: {
    label: "Open",
    className: "border-amber-300 bg-amber-50 text-amber-800",
    icon: CircleDotIcon,
  },
  answered: {
    label: "Answered",
    className: "border-emerald-300 bg-emerald-50 text-emerald-800",
    icon: CheckCircle2Icon,
  },
  dismissed: {
    label: "Dismissed",
    className: "border-slate-300 bg-slate-100 text-slate-700",
    icon: ArchiveIcon,
  },
};

export function StatusBadge({ status }: { readonly status: string }) {
  const presentation = statusPresentation[status] ?? {
    label: status,
    className: "",
    icon: CircleIcon,
  };
  const Icon = presentation.icon;
  return (
    <Badge variant="outline" className={presentation.className}>
      <Icon /> {presentation.label}
    </Badge>
  );
}

export function formatDate(value: string): string {
  return new Intl.DateTimeFormat("es", { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(value),
  );
}

export function ConflictBanner({
  readVersion,
  currentVersion,
  text,
  reload,
}: {
  readonly readVersion: number;
  readonly currentVersion: number | null;
  readonly text: string;
  readonly reload: () => void;
}) {
  return (
    <Alert role="alert" className="border-amber-300 bg-amber-50 text-amber-950">
      <TriangleAlertIcon />
      <AlertTitle>La Task cambió mientras editabas</AlertTitle>
      <AlertDescription className="space-y-3 text-amber-900">
        <p>
          Tus cambios se conservan. Versión leída: {readVersion}; versión actual:{" "}
          {currentVersion ?? "desconocida"}.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            type="button"
            onClick={() => navigator.clipboard.writeText(text)}
          >
            <ClipboardIcon data-icon="inline-start" /> Copiar cambios
          </Button>
          <Button size="sm" type="button" onClick={reload}>
            <RotateCcwIcon data-icon="inline-start" /> Recargar Task
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}

export function ConfirmAction({
  trigger,
  title,
  description,
  confirmLabel,
  destructive = false,
  disabled = false,
  onConfirm,
}: {
  readonly trigger: ReactNode;
  readonly title: string;
  readonly description: string;
  readonly confirmLabel: string;
  readonly destructive?: boolean;
  readonly disabled?: boolean;
  readonly onConfirm: () => void;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger render={trigger as ReactElement} disabled={disabled} />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction variant={destructive ? "destructive" : "default"} onClick={onConfirm}>
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export { buttonVariants };
