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
  MenuIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  ShieldAlertIcon,
  BellIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { type ReactElement, type ReactNode, useEffect, useState } from "react";
import { toast } from "sonner";
import { api, ApiError } from "../lib/api.ts";
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
import { Button, buttonVariants } from "./ui/button.tsx";
import {
  Empty as EmptyPrimitive,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "./ui/empty.tsx";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "./ui/sheet.tsx";
import { Skeleton } from "./ui/skeleton.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip.tsx";

const navigation = [
  { to: "/tasks" as const, label: "Tasks", icon: CircleDotIcon },
  { to: "/projects" as const, label: "Projects", icon: FolderGit2Icon },
  { to: "/automation" as const, label: "Automation", icon: BotIcon },
  { to: "/notifications" as const, label: "Notificaciones", icon: BellIcon },
];

export function Shell({ children }: { readonly children: ReactNode }) {
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);
  const [apiOffline, setApiOffline] = useState(false);

  const logout = async () => {
    setLoggingOut(true);
    await api.logout().catch(() => undefined);
    await router.navigate({ to: "/login", search: { redirect: undefined } });
    await router.invalidate();
  };

  return (
    <div className="min-h-svh bg-background">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r bg-sidebar lg:flex">
        <Brand />
        <Navigation />
        <div className="mt-auto space-y-3 border-t p-4">
          <p className="text-xs text-muted-foreground">AIWS · v0.5.1</p>
          <Button
            className="w-full justify-start"
            variant="ghost"
            disabled={loggingOut}
            onClick={logout}
          >
            <LogOutIcon data-icon="inline-start" />
            {loggingOut ? "Saliendo…" : "Cerrar sesión"}
          </Button>
        </div>
      </aside>

      <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b bg-background/92 px-4 backdrop-blur lg:hidden">
        <Brand compact />
        <div className="flex items-center gap-2">
          <RunnerIndicator compact />
          <Sheet>
            <SheetTrigger render={<Button variant="outline" size="icon" />}>
              <MenuIcon />
              <span className="sr-only">Abrir navegación</span>
            </SheetTrigger>
            <SheetContent side="left" className="w-72">
              <SheetHeader>
                <SheetTitle>AIWS</SheetTitle>
                <SheetDescription>Workspace local para Tasks</SheetDescription>
              </SheetHeader>
              <Navigation />
              <div className="mt-auto border-t p-4">
                <Button
                  className="w-full justify-start"
                  variant="ghost"
                  disabled={loggingOut}
                  onClick={logout}
                >
                  <LogOutIcon data-icon="inline-start" />
                  Cerrar sesión
                </Button>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </header>

      <div className="lg:pl-60">
        <header className="sticky top-0 z-20 hidden h-12 items-center justify-end border-b bg-background/92 px-6 backdrop-blur lg:flex">
          <RunnerIndicator />
        </header>
        <ApiConnectivity onStateChange={setApiOffline} />
        {apiOffline ? (
          <output className="border-b border-destructive/30 bg-destructive/5 px-4 py-2 text-sm text-destructive">
            No se puede contactar con la API. Los cambios están deshabilitados hasta recuperar la
            conexión.
          </output>
        ) : null}
        <main className="mx-auto grid w-full max-w-7xl gap-5 px-4 py-5 sm:px-6 lg:px-8 lg:py-8">
          {children}
        </main>
      </div>
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

function ApiConnectivity({
  onStateChange,
}: {
  readonly onStateChange: (offline: boolean) => void;
}) {
  useEffect(() => {
    let stopped = false;
    const check = async () => {
      try {
        await api.health();
        if (!stopped) onStateChange(false);
      } catch {
        if (!stopped) onStateChange(true);
      }
    };
    void check();
    const interval = window.setInterval(check, 30_000);
    return () => {
      stopped = true;
      window.clearInterval(interval);
    };
  }, [onStateChange]);
  return null;
}

function Brand({ compact = false }: { readonly compact?: boolean }) {
  return (
    <Link
      to="/tasks"
      className={cn("flex items-center gap-3", compact ? "" : "h-16 border-b px-5")}
    >
      <span className="grid size-8 place-items-center rounded-lg bg-primary text-sm font-black text-primary-foreground">
        A
      </span>
      <span>
        <strong className="block leading-none">AIWS</strong>
        {!compact ? <span className="text-xs text-muted-foreground">Task workspace</span> : null}
      </span>
    </Link>
  );
}

function Navigation() {
  return (
    <nav aria-label="Principal" className="grid gap-1 p-3">
      {navigation.map(({ to, label, icon: Icon }) => (
        <Link
          key={to}
          to={to}
          className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          activeProps={{ className: "bg-sidebar-accent text-sidebar-accent-foreground" }}
        >
          <Icon className="size-4" />
          {label}
        </Link>
      ))}
    </nav>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  readonly title: string;
  readonly description?: string;
  readonly actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
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

export function Empty({
  title = "No hay resultados",
  children,
  action,
}: {
  readonly title?: string;
  readonly children: ReactNode;
  readonly action?: ReactNode;
}) {
  return (
    <EmptyPrimitive className="border bg-card py-10">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <CircleIcon />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
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
  return (
    <Alert variant="destructive">
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
    <Alert className="border-amber-300 bg-amber-50 text-amber-950">
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
