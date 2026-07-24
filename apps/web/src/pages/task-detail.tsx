import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  ArchiveIcon,
  CheckCircle2Icon,
  CircleAlertIcon,
  DownloadIcon,
  ExternalLinkIcon,
  FileIcon,
  FileUpIcon,
  ListTodoIcon,
  PanelRightOpenIcon,
  PencilIcon,
  PlusIcon,
  RotateCcwIcon,
  SaveIcon,
  Trash2Icon,
} from "lucide-react";
import {
  type ChangeEvent,
  type ReactElement,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import {
  ConflictBanner,
  ConfirmAction,
  CopyValue,
  Empty,
  ErrorNotice,
  FreshnessStatus,
  formatDate,
  Loading,
  PageBreadcrumb,
  PageHeader,
  StatusBadge,
  buttonVariants,
} from "../components/common.tsx";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert.tsx";
import { Badge } from "../components/ui/badge.tsx";
import { Button } from "../components/ui/button.tsx";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../components/ui/card.tsx";
import { Checkbox } from "../components/ui/checkbox.tsx";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../components/ui/dialog.tsx";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "../components/ui/field.tsx";
import { Input } from "../components/ui/input.tsx";
import { Progress, ProgressLabel } from "../components/ui/progress.tsx";
import { RadioGroup, RadioGroupItem } from "../components/ui/radio-group.tsx";
import { ScrollArea } from "../components/ui/scroll-area.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select.tsx";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "../components/ui/sheet.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs.tsx";
import { Textarea } from "../components/ui/textarea.tsx";
import { ApiError, api, apiFieldMessage } from "../lib/api.ts";
import {
  attachmentAccept,
  formatFileSize,
  validateAttachmentFiles,
} from "../lib/attachment-files.ts";
import { preserveConflict } from "../lib/conflict.ts";
import { focusFirstInvalid, UnsavedChangesBadge, UnsavedChangesGuard } from "../lib/form-state.tsx";
import { renderSafeMarkdown } from "../lib/markdown.ts";
import { answerPayload, questionPayload, type QuestionDraft } from "../lib/questions.ts";
import {
  cycleNumberMap,
  isActiveRunStatus,
  parseRunLogRows,
  presentTaskEvent,
  primaryTaskAction,
  selectRelevantRun,
} from "../lib/task-detail-view.ts";
import type { Question, Run, Task, TaskStatus, TimelineItem } from "../lib/types.ts";
import { useUploadQueue } from "../lib/upload-queue.tsx";

const questionTypeOptions = [
  { value: "text", label: "Text" },
  { value: "single_choice", label: "Single choice" },
  { value: "multiple_choice", label: "Multiple choice" },
];

export function TaskDetailPage({ taskId }: { readonly taskId: string }) {
  const client = useQueryClient();
  const desktop = useDesktopLayout();
  const inspectorCloseRef = useRef<HTMLButtonElement>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [logsRun, setLogsRun] = useState<Run | null>(null);
  const query = useQuery({
    queryKey: ["task", taskId],
    queryFn: () => api.task(taskId),
    refetchInterval: (current) => {
      const status = current.state.data?.status;
      return status === "curating" || status === "implementing" ? 5_000 : false;
    },
  });
  const runs = useQuery({
    queryKey: ["runs", taskId],
    queryFn: () => api.taskRuns(taskId),
    refetchInterval: (current) =>
      current.state.data?.some((run) => isActiveRunStatus(run.status)) ? 5_000 : false,
  });
  const update = (task: Task, message?: string) => {
    client.setQueryData(["task", taskId], task);
    void client.invalidateQueries({ queryKey: ["timeline", taskId] });
    void client.invalidateQueries({ queryKey: ["runs", taskId] });
    if (message) toast.success(message);
  };
  if (query.isError && query.data === undefined)
    return <ErrorNotice error={query.error} retry={() => void query.refetch()} />;
  if (query.data === undefined) return <Loading label="Cargando Task" />;
  const task = query.data;
  const relevantRun = selectRelevantRun(runs.data ?? [], task.currentCycle.id);
  const refresh = () => {
    void query.refetch();
    void client.invalidateQueries({ queryKey: ["timeline", task.id] });
    void client.invalidateQueries({ queryKey: ["runs", task.id] });
  };
  const mobileInspector = !desktop ? (
    <Sheet open={inspectorOpen} onOpenChange={setInspectorOpen}>
      <SheetTrigger render={<Button variant="outline" />}>
        <PanelRightOpenIcon /> Abrir inspector
      </SheetTrigger>
      <SheetContent
        aria-label="Inspector de la Task"
        className="w-[min(92vw,28rem)] overflow-y-auto p-0"
        showCloseButton={false}
        keepMounted
        initialFocus={inspectorCloseRef}
      >
        <SheetHeader className="border-b">
          <SheetTitle>Inspector de la Task</SheetTitle>
          <SheetDescription>
            Curator Spec, Delivery, Attachments y diagnóstico del Cycle vigente.
          </SheetDescription>
          <SheetClose
            render={
              <Button ref={inspectorCloseRef} className="mt-3 self-start" variant="outline" />
            }
          >
            Cerrar inspector
          </SheetClose>
        </SheetHeader>
        <div className="grid gap-4 p-4">
          <TaskInspector task={task} onUpdate={update} reload={refresh} />
        </div>
      </SheetContent>
    </Sheet>
  ) : null;
  return (
    <>
      <PageBreadcrumb parent={{ to: "/tasks", label: "Tasks" }} current={task.title} />
      <FreshnessStatus
        updatedAt={query.dataUpdatedAt}
        fetching={query.isFetching}
        error={query.isError ? query.error : undefined}
        retry={refresh}
      />
      {task.archivedAt ? (
        <Alert>
          <ArchiveIcon />
          <AlertTitle>Task archivada</AlertTitle>
          <AlertDescription>
            El agregado está en modo de solo lectura. Restáuralo para volver a modificarlo.
          </AlertDescription>
        </Alert>
      ) : null}
      <TaskHeader
        task={task}
        relevantRun={relevantRun}
        runsError={runs.error}
        retryRuns={() => void runs.refetch()}
        openLogs={setLogsRun}
        inspectorAction={mobileInspector}
        onUpdate={update}
        reload={refresh}
      />
      {task.status === "blocked" ? (
        <QuestionsSection task={task} onUpdate={update} reload={refresh} openOnly />
      ) : null}
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-4 overflow-x-hidden lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="grid min-w-0 gap-4">
          <UserRequestSection task={task} onUpdate={update} reload={refresh} />
          <ConversationTimeline task={task} openLogs={setLogsRun} />
          <MessageComposer task={task} refresh={refresh} />
          {task.project.repositoryMode === "local" ? (
            <QuestionsSection task={task} onUpdate={update} reload={refresh} controlsOnly />
          ) : null}
        </div>
        {desktop ? (
          <aside className="min-w-0 lg:sticky lg:top-4" aria-label="Inspector de la Task">
            <TaskInspector task={task} onUpdate={update} reload={refresh} />
          </aside>
        ) : null}
      </div>
      {logsRun ? <RunLogsDialog run={logsRun} close={() => setLogsRun(null)} /> : null}
    </>
  );
}

function useDesktopLayout(): boolean {
  const [desktop, setDesktop] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(min-width: 64rem)");
    const update = () => setDesktop(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return desktop;
}

function TaskInspector({
  task,
  onUpdate,
  reload,
}: {
  readonly task: Task;
  readonly onUpdate: (task: Task, message?: string) => void;
  readonly reload: () => void;
}) {
  return (
    <div className="grid min-w-0 gap-4">
      <SpecSection task={task} onUpdate={onUpdate} reload={reload} />
      <InspectorDisclosure
        title="Delivery y PR"
        description="Rama, referencia y enlace de entrega vigentes."
      >
        <CycleInspector task={task} />
        <PrSection task={task} onUpdate={onUpdate} reload={reload} />
      </InspectorDisclosure>
      <InspectorDisclosure
        title={`Attachments (${task.attachments.length})`}
        description="Ficheros y cola de upload de la Task."
      >
        <AttachmentsSection task={task} onRefresh={reload} reload={reload} />
      </InspectorDisclosure>
      <InspectorDisclosure
        title="Diagnóstico"
        description="Identificadores y versión para soporte."
      >
        <div className="grid gap-2 rounded-lg border p-3 text-sm">
          <CopyValue label="Task" value={task.id} />
          <CopyValue label="Cycle" value={task.currentCycle.id} />
          {task.currentDelivery ? (
            <CopyValue label="Delivery" value={task.currentDelivery.id} />
          ) : null}
          <span className="text-muted-foreground">Versión {task.version}</span>
        </div>
      </InspectorDisclosure>
    </div>
  );
}

function InspectorDisclosure({
  title,
  description,
  children,
}: {
  readonly title: string;
  readonly description: string;
  readonly children: ReactNode;
}) {
  return (
    <details className="group rounded-lg border bg-card">
      <summary className="cursor-pointer list-none p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <span className="font-semibold">{title}</span>
        <span className="mt-1 block text-xs text-muted-foreground">{description}</span>
      </summary>
      <div className="grid gap-4 border-t p-3">{children}</div>
    </details>
  );
}

function CycleInspector({ task }: { readonly task: Task }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Cycle {task.currentCycle.number}</CardTitle>
        <CardDescription>Estado y Delivery vigentes.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2 text-sm">
        <div className="flex items-center justify-between gap-2">
          <span>Estado</span>
          <StatusBadge status={task.status} />
        </div>
        <CopyValue label="Cycle" value={task.currentCycle.id} />
        {task.currentDelivery ? (
          <>
            <CopyValue label="Delivery" value={task.currentDelivery.id} />
            {task.currentDelivery.branchName ? (
              <CopyValue label="Rama" value={task.currentDelivery.branchName} />
            ) : null}
            {task.currentDelivery.baseBranch ? (
              <CopyValue label="Rama de referencia" value={task.currentDelivery.baseBranch} />
            ) : null}
            {task.currentDelivery.prUrl ? (
              <a
                className="inline-flex items-center gap-1 text-primary hover:underline"
                href={task.currentDelivery.prUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Abrir pull request <ExternalLinkIcon className="size-4" />
              </a>
            ) : null}
          </>
        ) : (
          <p className="text-muted-foreground">Delivery pendiente de resolución.</p>
        )}
      </CardContent>
    </Card>
  );
}

function ConversationTimeline({
  task,
  openLogs,
}: {
  readonly task: Task;
  readonly openLogs: (run: Run) => void;
}) {
  const timeline = useInfiniteQuery({
    queryKey: ["timeline", task.id],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => api.timeline(task.id, pageParam),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    refetchInterval: task.status === "curating" || task.status === "implementing" ? 5_000 : false,
  });
  if (timeline.isError && timeline.data === undefined)
    return <ErrorNotice error={timeline.error} retry={() => void timeline.refetch()} />;
  if (timeline.data === undefined) return <Loading label="Cargando timeline" />;
  const items = [...timeline.data.pages].reverse().flatMap((page) => page.items);
  const cycleNumbers = cycleNumberMap(task.currentCycle, items);
  const groups: Array<{ cycleId: string | null; items: TimelineItem[] }> = [];
  let previousCycle: string | null = null;
  for (const item of items) {
    const resolvedCycle: string | null = item.cycleId ?? previousCycle ?? task.currentCycle.id;
    previousCycle = resolvedCycle;
    const group = groups.at(-1);
    if (group && group.cycleId === resolvedCycle) group.items.push(item);
    else groups.push({ cycleId: resolvedCycle, items: [item] });
  }
  return (
    <section className="grid gap-3" aria-label="Timeline de la Task">
      <div>
        <h2 className="text-xl font-semibold">Conversación e historial</h2>
        <p className="text-sm text-muted-foreground">
          Mensajes y resultados organizados por Cycle; el historial no se puede modificar.
        </p>
        <FreshnessStatus
          updatedAt={timeline.dataUpdatedAt}
          fetching={timeline.isFetching && !timeline.isFetchingNextPage}
          error={timeline.isError ? timeline.error : undefined}
          retry={() => void timeline.refetch()}
        />
      </div>
      {timeline.hasNextPage ? (
        <Button
          variant="outline"
          disabled={timeline.isFetchingNextPage}
          onClick={() => void timeline.fetchNextPage()}
        >
          Cargar historial anterior
        </Button>
      ) : null}
      {groups.map((group, groupIndex) => {
        const number = group.cycleId === null ? null : (cycleNumbers.get(group.cycleId) ?? null);
        return (
          <section
            key={group.cycleId ?? `general-${groupIndex}`}
            className="grid gap-3"
            aria-label={number === null ? "Actividad general" : `Cycle ${number}`}
          >
            <div className="flex items-center gap-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <span className="h-px flex-1 bg-border" />
              {number === null ? "Actividad general" : `Cycle ${number}`}
              {group.cycleId === task.currentCycle.id ? (
                <Badge variant="outline">Vigente</Badge>
              ) : null}
              <span className="h-px flex-1 bg-border" />
            </div>
            {group.items.map((item) => (
              <TimelineCard key={timelineKey(item)} item={item} openLogs={openLogs} />
            ))}
          </section>
        );
      })}
      {items.length === 0 ? (
        <Empty title="Sin historial">Todavía no hay elementos en la timeline.</Empty>
      ) : null}
    </section>
  );
}

function timelineKey(item: TimelineItem): string {
  if (item.kind === "message" || item.kind === "spec_revision") return item.id;
  if (item.kind === "question") return item.question.id;
  if (item.kind === "run") return item.run.id;
  return item.event.id;
}

function TimelineCard({
  item,
  openLogs,
}: {
  readonly item: TimelineItem;
  readonly openLogs: (run: Run) => void;
}) {
  if (item.kind === "message")
    return (
      <Card className="ml-auto w-[min(100%,42rem)] border-primary/25 bg-primary/5">
        <CardHeader>
          <CardTitle className="text-base">
            {item.type === "initial_request"
              ? "Petición inicial"
              : item.type === "change"
                ? "Cambio solicitado"
                : "Contexto añadido"}
          </CardTitle>
          <CardDescription>{formatDate(item.createdAt)}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="whitespace-pre-wrap">{item.text ?? "Mensaje con adjuntos"}</p>
        </CardContent>
      </Card>
    );
  if (item.kind === "spec_revision")
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Revisión de spec {item.revision}</CardTitle>
          <CardDescription>{formatDate(item.createdAt)}</CardDescription>
        </CardHeader>
        <CardContent>
          <details>
            <summary className="cursor-pointer font-medium">Ver snapshot</summary>
            <div
              className="markdown mt-3"
              // biome-ignore lint/security/noDangerouslySetInnerHtml: renderSafeMarkdown escapes raw HTML and only emits a closed, tested Markdown subset.
              dangerouslySetInnerHTML={{ __html: renderSafeMarkdown(item.content) }}
            />
          </details>
        </CardContent>
      </Card>
    );
  if (item.kind === "question") {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Question · {item.question.text}</CardTitle>
          <CardDescription>
            {questionStatusLabel(item.question.status)} · {formatDate(item.createdAt)}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2">
          {item.answers.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin respuestas registradas.</p>
          ) : (
            item.answers.map((answer) => (
              <div key={answer.id} className="rounded bg-muted p-3 text-sm">
                <strong>Respuesta {answer.revision}</strong>
                <p className="mt-1 whitespace-pre-wrap">
                  {answer.answerText ?? answer.selectedOptionIds.join(", ")}
                </p>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    );
  }
  if (item.kind === "run") return <RunTimelineCard run={item.run} openLogs={openLogs} />;
  return <ActivityTimelineItem item={item} />;
}

function ActivityTimelineItem({
  item,
}: {
  readonly item: Extract<TimelineItem, { kind: "event" }>;
}) {
  const presentation = presentTaskEvent(item.event);
  const hasMetadata = Object.keys(presentation.metadata).length > 0;
  return (
    <div className="mx-auto w-[min(100%,42rem)] rounded-lg border bg-muted/40 px-4 py-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <strong>{presentation.label}</strong>
          <p className="text-xs text-muted-foreground">
            {presentation.actor}
            {presentation.summary ? ` · ${presentation.summary}` : ""}
          </p>
        </div>
        <time className="text-xs text-muted-foreground">{formatDate(item.createdAt)}</time>
      </div>
      {hasMetadata ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs font-medium">Ver metadata segura</summary>
          <pre className="mt-2 overflow-x-auto rounded bg-background p-2 font-mono text-xs whitespace-pre-wrap">
            {JSON.stringify(presentation.metadata, null, 2)}
          </pre>
        </details>
      ) : null}
    </div>
  );
}

function MessageComposer({ task, refresh }: { readonly task: Task; readonly refresh: () => void }) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const visible = !task.archivedAt && (task.status === "done" || task.status === "blocked");
  const send = useMutation({
    mutationFn: () => api.sendMessage(task.id, text, files, task.version),
    onSuccess: () => {
      setText("");
      setFiles([]);
      refresh();
      toast.success(task.status === "done" ? "Cambio enviado a curation" : "Contexto añadido");
    },
  });
  if (!visible) return null;
  const label = task.status === "done" ? "Solicitar cambio" : "Añadir contexto";
  return (
    <Card id={task.status === "done" ? "request-change" : "add-context"}>
      <CardHeader>
        <CardTitle>{label}</CardTitle>
        <CardDescription>
          {task.status === "blocked"
            ? "El contexto no responde ni cierra Questions abiertas."
            : "Se creará un Cycle nuevo y la Task volverá a Curating."}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <Textarea
          aria-label={label}
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Describe el cambio o contexto…"
        />
        <Input
          aria-label="Adjuntos del mensaje"
          type="file"
          multiple
          onChange={(event: ChangeEvent<HTMLInputElement>) =>
            setFiles(Array.from(event.target.files ?? []))
          }
        />
        {files.length > 0 ? (
          <p className="text-xs text-muted-foreground">
            {files.length} archivo(s) preparados. El borrador se conserva hasta que el envío sea
            aceptado.
          </p>
        ) : null}
        <Button
          className="justify-self-start"
          disabled={send.isPending || (!text.trim() && files.length === 0)}
          onClick={() => send.mutate()}
        >
          {send.isPending ? "Enviando…" : label}
        </Button>
        {send.isError ? <ErrorNotice error={send.error} /> : null}
      </CardContent>
    </Card>
  );
}

function RunTimelineCard({
  run,
  openLogs,
}: {
  readonly run: Run;
  readonly openLogs: (run: Run) => void;
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="text-base">
          Run de {runKindLabel(run.kind)} · intento {run.attempt}
        </CardTitle>
        <CardDescription>
          {runStatusLabel(run.status)}
          {run.outcome ? ` · resultado ${run.outcome}` : ""}
        </CardDescription>
        <CardAction>
          <Badge variant={run.status === "failed" ? "destructive" : "outline"}>
            {runStatusLabel(run.status)}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="grid gap-3">
        <p className="text-sm text-muted-foreground">
          {run.summary ?? run.errorMessage ?? "Sin resumen"}
        </p>
        {run.kind === "implementation" ? (
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {run.branchName ? <span>Rama: {run.branchName}</span> : null}
            {run.executionStage === "publishing" ? <span>Etapa: publicación</span> : null}
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => openLogs(run)}>
            Logs
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function RunLogsDialog({ run, close }: { readonly run: Run; readonly close: () => void }) {
  const current = useQuery({
    queryKey: ["run", run.id],
    queryFn: () => api.run(run.id),
    initialData: run,
    refetchInterval: (query) =>
      query.state.data !== undefined && isActiveRunStatus(query.state.data.status) ? 3_000 : false,
  });
  const active = isActiveRunStatus(current.data.status);
  const logs = useQuery({
    queryKey: ["run-logs", run.id],
    queryFn: () => api.runLogs(run.id),
    retry: false,
    refetchInterval: active ? 3_000 : false,
  });
  const missing =
    logs.data === undefined && logs.error instanceof ApiError && logs.error.code === "not_found";
  const logText = logs.data ?? "";
  const logRows = parseRunLogRows(logText);
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : close())}>
      <DialogContent showCloseButton={false} className="max-h-[90svh] overflow-hidden sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Logs · Intento {run.attempt}</DialogTitle>
          <DialogDescription>
            Eventos NDJSON del Run {run.kind}. Los secretos permanecen redactados.
          </DialogDescription>
        </DialogHeader>
        {logs.data !== undefined ? (
          <FreshnessStatus
            updatedAt={logs.dataUpdatedAt}
            fetching={logs.isFetching}
            error={logs.isError ? logs.error : current.isError ? current.error : undefined}
            retry={() => {
              void current.refetch();
              void logs.refetch();
            }}
          />
        ) : null}
        {logs.isLoading && logs.data === undefined ? (
          <Loading label="Cargando logs" />
        ) : missing ? (
          <Empty
            title={active ? "Iniciando captura de logs…" : "No se capturaron logs para este Run."}
          >
            {current.data.errorMessage ??
              (active
                ? "Los eventos aparecerán automáticamente."
                : "El Run terminó antes de producir eventos.")}
          </Empty>
        ) : logs.isError && logs.data === undefined ? (
          <ErrorNotice error={logs.error} retry={() => void logs.refetch()} />
        ) : logText.trim() === "" ? (
          <Empty title={active ? "Iniciando captura de logs…" : "Logs vacíos"}>
            {active ? "Los eventos aparecerán automáticamente." : "El Run no produjo eventos."}
          </Empty>
        ) : (
          <div className="grid min-h-0 gap-3">
            <ScrollArea className="h-[min(52svh,32rem)] rounded-lg border bg-muted/30">
              <ol className="divide-y">
                {logRows.map((row, index) => (
                  <li key={row.id} className="grid gap-1 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <strong className="font-mono text-xs">{row.label}</strong>
                      <span className="text-xs text-muted-foreground">Evento {index + 1}</span>
                    </div>
                    {row.detail ? (
                      <p className="break-words text-sm text-muted-foreground">{row.detail}</p>
                    ) : null}
                  </li>
                ))}
              </ol>
            </ScrollArea>
            <details>
              <summary className="cursor-pointer text-sm font-medium">
                Ver NDJSON formateado
              </summary>
              <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-muted p-3 font-mono text-xs whitespace-pre-wrap">
                {formatRunLogs(logText)}
              </pre>
            </details>
          </div>
        )}
        {!active && current.data.errorMessage && logText.trim() !== "" ? (
          <Alert>
            <CircleAlertIcon />
            <AlertTitle>Error terminal</AlertTitle>
            <AlertDescription>{current.data.errorMessage}</AlertDescription>
          </Alert>
        ) : null}
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cerrar</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function formatRunLogs(value: string): string {
  return parseRunLogRows(value)
    .map((row) => row.raw)
    .join("\n\n");
}

function TaskHeader({
  task,
  relevantRun,
  runsError,
  retryRuns,
  openLogs,
  inspectorAction,
  onUpdate,
  reload,
}: {
  readonly task: Task;
  readonly relevantRun: Run | null;
  readonly runsError: unknown;
  readonly retryRuns: () => void;
  readonly openLogs: (run: Run) => void;
  readonly inspectorAction: ReactNode;
  readonly onUpdate: (task: Task, message?: string) => void;
  readonly reload: () => void;
}) {
  const titleId = useId();
  const [title, setTitle] = useState(task.title);
  const save = useMutation({
    mutationFn: () => api.updateTask(task.id, { title }, task.version),
    onSuccess: (value) => onUpdate(value, "Título guardado"),
  });
  const restore = useMutation({
    mutationFn: () => api.unarchiveTask(task.id, task.version),
    onSuccess: (value) => onUpdate(value, "Task restaurada"),
  });
  const resumeAutomation = useMutation({
    mutationFn: () => api.resumeTaskAutomation(task.id, task.version),
    onSuccess: (value) => onUpdate(value, "Automatización reanudada"),
  });
  const retryRun = useMutation({
    mutationFn: (mode: "auto" | "full") => {
      if (relevantRun === null) throw new Error("No hay un Run para reintentar.");
      return api.retryRun(relevantRun.id, task.version, mode);
    },
    onSuccess: () => {
      toast.success("Retry solicitado");
      reload();
    },
  });
  const cancelRun = useMutation({
    mutationFn: () => {
      if (relevantRun === null) throw new Error("No hay un Run para cancelar.");
      return api.cancelRun(relevantRun.id, "Cancelled from Web.", task.version);
    },
    onSuccess: () => {
      toast.success("Cancelación solicitada");
      reload();
    },
  });
  const titleConflict = preserveConflict(save.error, title, task.version);
  const primaryAction = primaryTaskAction(task);
  const runActive = relevantRun !== null && isActiveRunStatus(relevantRun.status);
  const runRetryable =
    relevantRun !== null &&
    (relevantRun.status === "failed" || relevantRun.status === "cancelled") &&
    (task.status === "ready" || task.status === "curating");
  const runDominates = runActive || runRetryable;
  useEffect(() => setTitle(task.title), [task.title]);
  useEffect(() => {
    if (save.error && !titleConflict) focusFirstInvalid();
  }, [save.error, titleConflict]);
  return (
    <Card aria-label="Resumen operativo de la Task">
      <CardHeader>
        <CardTitle>
          <PageHeader
            title={task.title}
            description={taskStatusGuidance(task)}
            actions={<StatusBadge status={task.status} />}
          />
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        {task.automationPaused ? (
          <Alert variant="destructive">
            <CircleAlertIcon />
            <AlertTitle>Automatización pausada</AlertTitle>
            <AlertDescription className="grid gap-3">
              <p>
                No se crearán nuevos Runs para esta Task hasta reanudarla. Revisa el último fallo
                mostrado en este resumen.
              </p>
              <Button
                className="justify-self-start"
                size="sm"
                variant="outline"
                disabled={
                  resumeAutomation.isPending ||
                  (task.status !== "curating" && task.status !== "ready")
                }
                onClick={() => resumeAutomation.mutate()}
              >
                Reanudar automatización
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}
        {resumeAutomation.isError ? <ErrorNotice error={resumeAutomation.error} /> : null}
        <div className="grid gap-3 rounded-lg bg-muted/40 p-4 sm:grid-cols-3">
          <div>
            <span className="block text-xs text-muted-foreground">Project</span>
            <Link
              className="font-medium text-primary hover:underline"
              to="/projects/$projectId"
              params={{ projectId: task.project.id }}
            >
              {task.project.name}
            </Link>
          </div>
          <div>
            <span className="block text-xs text-muted-foreground">Cycle vigente</span>
            <strong>Cycle {task.currentCycle.number}</strong>
          </div>
          <div>
            <span className="block text-xs text-muted-foreground">Versión del agregado</span>
            <strong>v{task.version}</strong>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <CopyValue label="ID" value={task.id} />
          <CopyValue label="Cycle" value={task.currentCycle.id} />
          {task.archivedAt ? (
            <Badge variant="outline">Archivada {formatDate(task.archivedAt)}</Badge>
          ) : null}
        </div>
        {runsError ? <ErrorNotice error={runsError} retry={retryRuns} /> : null}
        {relevantRun ? (
          <section
            className="grid gap-3 rounded-lg border border-primary/20 bg-primary/5 p-4"
            aria-label="Run vigente"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <strong>
                  {runActive ? "Run activo" : "Último Run accionable"} ·{" "}
                  {runKindLabel(relevantRun.kind)} · intento {relevantRun.attempt}
                </strong>
                <p className="text-sm text-muted-foreground">
                  {runStatusLabel(relevantRun.status)}
                  {relevantRun.kind === "implementation" &&
                  relevantRun.executionStage === "publishing"
                    ? " · etapa de publicación"
                    : ""}
                </p>
              </div>
              <Badge variant={relevantRun.status === "failed" ? "destructive" : "outline"}>
                {runStatusLabel(relevantRun.status)}
              </Badge>
            </div>
            <p className="text-sm">
              {relevantRun.errorMessage ?? relevantRun.summary ?? "Sin diagnóstico disponible."}
            </p>
            {relevantRun.kind === "implementation" && relevantRun.branchName ? (
              <p className="break-all text-xs text-muted-foreground">
                Rama: {relevantRun.branchName}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {runRetryable ? (
                <Button disabled={retryRun.isPending} onClick={() => retryRun.mutate("auto")}>
                  Reintentar
                </Button>
              ) : null}
              {runRetryable && relevantRun.executionStage === "publishing" ? (
                <Button
                  variant="outline"
                  disabled={retryRun.isPending}
                  onClick={() => retryRun.mutate("full")}
                >
                  Reintentar completo
                </Button>
              ) : null}
              <Button variant="outline" onClick={() => openLogs(relevantRun)}>
                Ver logs
              </Button>
              {runActive ? (
                <Button
                  variant="destructive"
                  disabled={cancelRun.isPending}
                  onClick={() => cancelRun.mutate()}
                >
                  Cancelar Run
                </Button>
              ) : null}
            </div>
            {retryRun.isError ? <ErrorNotice error={retryRun.error} /> : null}
            {cancelRun.isError ? <ErrorNotice error={cancelRun.error} /> : null}
          </section>
        ) : null}
        {titleConflict ? (
          <ConflictBanner
            readVersion={titleConflict.readVersion}
            currentVersion={titleConflict.currentVersion}
            text={titleConflict.draft}
            reload={reload}
          />
        ) : null}
        {!task.archivedAt ? (
          <form
            className="flex flex-wrap gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              save.mutate();
            }}
          >
            <Field
              className="min-w-0 flex-1 basis-64"
              data-invalid={Boolean(apiFieldMessage(save.error, "title"))}
            >
              <FieldLabel className="sr-only" htmlFor={titleId}>
                Título
              </FieldLabel>
              <Input
                id={titleId}
                maxLength={200}
                value={title}
                disabled={task.status !== "draft"}
                aria-invalid={Boolean(apiFieldMessage(save.error, "title"))}
                aria-describedby={
                  apiFieldMessage(save.error, "title") ? `${titleId}-error` : undefined
                }
                onChange={(event) => setTitle(event.target.value)}
              />
              <FieldError id={`${titleId}-error`}>
                {apiFieldMessage(save.error, "title")}
              </FieldError>
            </Field>
            <Button
              variant="outline"
              disabled={
                task.status !== "draft" ||
                save.isPending ||
                title.trim().length === 0 ||
                title === task.title
              }
              type="submit"
            >
              <SaveIcon /> Guardar título
            </Button>
          </form>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          {primaryAction?.kind === "transition" ? (
            <ReasonActionDialog
              trigger={
                <Button variant={runDominates ? "outline" : "default"}>
                  {transitionIcon(primaryAction.nextStatus)}
                  {primaryAction.label}
                </Button>
              }
              title={primaryAction.label}
              description={transitionDescription(task.status, primaryAction.nextStatus)}
              confirmLabel={primaryAction.label}
              disabled={primaryAction.nextStatus === "ready" && !canReady(task)}
              action={(reason) =>
                api.transitionTask(
                  task.id,
                  {
                    from: task.status,
                    to: primaryAction.nextStatus,
                    ...(reason ? { reason } : {}),
                  },
                  task.version,
                )
              }
              onSuccess={(value) => onUpdate(value, `Task movida a ${primaryAction.nextStatus}`)}
            />
          ) : null}
          {primaryAction?.kind === "answer" ? (
            <Button
              onClick={() => {
                const target = document.getElementById("open-questions");
                target?.scrollIntoView({ behavior: "smooth", block: "start" });
                target?.querySelector<HTMLElement>('[id^="answer-"]')?.focus();
              }}
            >
              <ListTodoIcon /> {primaryAction.label}
            </Button>
          ) : null}
          {primaryAction?.kind === "message" ? (
            <Button
              onClick={() => {
                const target = document.getElementById("request-change");
                target?.scrollIntoView({ behavior: "smooth", block: "start" });
                target?.querySelector<HTMLElement>("textarea")?.focus();
              }}
            >
              <PencilIcon /> {primaryAction.label}
            </Button>
          ) : null}
          {primaryAction?.kind === "restore" ? (
            <Button disabled={restore.isPending} onClick={() => restore.mutate()}>
              <RotateCcwIcon /> Restaurar Task
            </Button>
          ) : null}
          {!task.archivedAt ? (
            <ReasonActionDialog
              trigger={
                <Button variant="ghost" className="text-destructive hover:text-destructive">
                  <ArchiveIcon /> Archivar Task
                </Button>
              }
              title="Archivar Task"
              description="La Task dejará de aparecer en los listados activos, pero conservará todo su agregado."
              confirmLabel="Archivar"
              destructive
              action={(reason) => api.archiveTask(task.id, task.version, reason)}
              onSuccess={(value) => onUpdate(value, "Task archivada")}
            />
          ) : null}
          {inspectorAction}
        </div>
        {primaryAction?.kind === "transition" &&
        primaryAction.nextStatus === "ready" &&
        !canReady(task) &&
        !task.archivedAt ? (
          <p className="text-sm text-muted-foreground">
            Para marcar Ready, guarda una Curator Spec no vacía y resuelve todas las Questions
            abiertas.
          </p>
        ) : null}
        {save.isError && !titleConflict ? <ErrorNotice error={save.error} /> : null}
        {restore.isError ? <ErrorNotice error={restore.error} /> : null}
      </CardContent>
    </Card>
  );
}

function UserRequestSection({
  task,
  onUpdate,
  reload,
}: {
  readonly task: Task;
  readonly onUpdate: (task: Task, message?: string) => void;
  readonly reload: () => void;
}) {
  const requestId = useId();
  const [request, setRequest] = useState(task.userRequest);
  const save = useMutation({
    mutationFn: () => api.updateTask(task.id, { userRequest: request }, task.version),
    onSuccess: (value) => onUpdate(value, "User Request guardada"),
  });
  const conflict = preserveConflict(save.error, request, task.version);
  useEffect(() => setRequest(task.userRequest), [task.userRequest]);
  useEffect(() => {
    if (save.error && !conflict) focusFirstInvalid();
  }, [save.error, conflict]);
  if (task.status !== "draft" || task.archivedAt) {
    return (
      <SectionCard title="User Request" description="Petición congelada al enviarse a curation.">
        <p className="whitespace-pre-wrap leading-7">{task.userRequest}</p>
      </SectionCard>
    );
  }
  return (
    <SectionCard title="User Request" description="Editable mientras la Task permanezca Draft.">
      <div className="grid gap-3">
        {conflict ? (
          <ConflictBanner
            readVersion={conflict.readVersion}
            currentVersion={conflict.currentVersion}
            text={conflict.draft}
            reload={reload}
          />
        ) : null}
        <Field data-invalid={Boolean(apiFieldMessage(save.error, "userRequest"))}>
          <FieldLabel htmlFor={requestId}>User Request</FieldLabel>
          <Textarea
            id={requestId}
            className="min-h-40"
            maxLength={100000}
            value={request}
            aria-invalid={Boolean(apiFieldMessage(save.error, "userRequest"))}
            aria-describedby={
              apiFieldMessage(save.error, "userRequest") ? `${requestId}-error` : undefined
            }
            onChange={(event) => setRequest(event.target.value)}
          />
          <FieldError id={`${requestId}-error`}>
            {apiFieldMessage(save.error, "userRequest")}
          </FieldError>
        </Field>
        <Button
          className="justify-self-start"
          disabled={save.isPending || request.trim().length === 0 || request === task.userRequest}
          onClick={() => save.mutate()}
        >
          <SaveIcon /> Guardar petición
        </Button>
        {save.isError && !conflict ? <ErrorNotice error={save.error} /> : null}
      </div>
    </SectionCard>
  );
}

function SectionCard({
  title,
  description,
  action,
  children,
}: {
  readonly title: string;
  readonly description?: string;
  readonly action?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
        {action ? <CardAction>{action}</CardAction> : null}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function SpecSection({
  task,
  onUpdate,
  reload,
}: {
  readonly task: Task;
  readonly onUpdate: (task: Task, message?: string) => void;
  readonly reload: () => void;
}) {
  const [spec, setSpec] = useState(task.curatorSpec);
  const save = useMutation({
    mutationFn: () => api.updateTask(task.id, { curatorSpec: spec }, task.version),
    onSuccess: (value) => {
      onUpdate(value, "Curator Spec guardada");
      setSpec(value.curatorSpec);
    },
  });
  const conflict = preserveConflict(save.error, spec, task.version);
  const dirty = spec !== task.curatorSpec;
  useEffect(() => {
    if (!dirty) setSpec(task.curatorSpec);
  }, [task.curatorSpec, dirty]);
  useEffect(() => {
    if (save.error && !conflict) focusFirstInvalid();
  }, [save.error, conflict]);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Curator Spec</CardTitle>
        <CardDescription>
          Markdown implementable para el agente externo. El guardado es explícito.
        </CardDescription>
        {dirty ? (
          <CardAction>
            <UnsavedChangesBadge dirty />
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent className="grid gap-4">
        {conflict ? (
          <ConflictBanner
            readVersion={conflict.readVersion}
            currentVersion={conflict.currentVersion}
            text={conflict.draft}
            reload={reload}
          />
        ) : null}
        <Tabs defaultValue="edit">
          <TabsList>
            <TabsTrigger value="edit">Editar</TabsTrigger>
            <TabsTrigger value="preview">Preview</TabsTrigger>
          </TabsList>
          <TabsContent value="edit">
            <Field data-invalid={Boolean(apiFieldMessage(save.error, "curatorSpec"))}>
              <FieldLabel className="sr-only" htmlFor={`spec-${task.id}`}>
                Curator Spec Markdown
              </FieldLabel>
              <Textarea
                id={`spec-${task.id}`}
                className="min-h-80 font-mono"
                maxLength={1048576}
                value={spec}
                disabled={Boolean(task.archivedAt)}
                aria-invalid={Boolean(apiFieldMessage(save.error, "curatorSpec"))}
                aria-describedby={
                  apiFieldMessage(save.error, "curatorSpec") ? `spec-${task.id}-error` : undefined
                }
                onChange={(event) => setSpec(event.target.value)}
              />
              <FieldError id={`spec-${task.id}-error`}>
                {apiFieldMessage(save.error, "curatorSpec")}
              </FieldError>
            </Field>
          </TabsContent>
          <TabsContent value="preview">
            <div
              className="markdown min-h-80 rounded-lg border bg-background p-5"
              // biome-ignore lint/security/noDangerouslySetInnerHtml: renderSafeMarkdown escapes raw HTML and only emits a closed, tested Markdown subset.
              dangerouslySetInnerHTML={{ __html: renderSafeMarkdown(spec) }}
            />
          </TabsContent>
        </Tabs>
        {!task.archivedAt ? (
          <Button
            className="justify-self-start"
            disabled={!dirty || save.isPending}
            onClick={() => save.mutate()}
          >
            <SaveIcon /> {save.isPending ? "Guardando…" : "Guardar Spec"}
          </Button>
        ) : null}
        {save.isError && !conflict ? <ErrorNotice error={save.error} /> : null}
        <UnsavedChangesGuard
          dirty={dirty}
          description="Si sales ahora perderás el borrador local de la Curator Spec."
        />
      </CardContent>
    </Card>
  );
}

function QuestionsSection({
  task,
  onUpdate,
  reload,
  controlsOnly = false,
  openOnly = false,
}: {
  readonly task: Task;
  readonly onUpdate: (task: Task, message?: string) => void;
  readonly reload: () => void;
  readonly controlsOnly?: boolean;
  readonly openOnly?: boolean;
}) {
  const titleId = useId();
  const [editing, setEditing] = useState<Question | null>(null);
  const [open, setOpen] = useState(false);
  const ordered = task.questions
    .filter((question) => !openOnly || question.status === "open")
    .sort(
      (left, right) =>
        Number(right.status === "open") - Number(left.status === "open") ||
        left.createdAt.localeCompare(right.createdAt),
    );
  const canCreate = !task.archivedAt && task.status !== "draft" && task.status !== "done";
  return (
    <section
      id={openOnly ? "open-questions" : undefined}
      className="grid scroll-mt-4 gap-3"
      aria-labelledby={titleId}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id={titleId} className="text-xl font-semibold">
            {openOnly ? "Questions abiertas" : "Questions"}
          </h2>
          <p className="text-sm text-muted-foreground">
            {openOnly
              ? "Responde o descarta la información pendiente antes de añadir más contexto."
              : "Las Questions abiertas bloquean automáticamente la Task."}
          </p>
        </div>
        {canCreate ? (
          <Dialog
            open={open}
            onOpenChange={(next) => {
              setOpen(next);
              if (!next) setEditing(null);
            }}
          >
            <DialogTrigger render={<Button onClick={() => setEditing(null)} />}>
              <PlusIcon /> Crear Question
            </DialogTrigger>
            <QuestionEditorDialog
              task={task}
              question={editing}
              close={() => setOpen(false)}
              onUpdate={onUpdate}
              reload={reload}
            />
          </Dialog>
        ) : null}
      </div>
      {controlsOnly ? null : ordered.length === 0 ? (
        <Empty title={openOnly ? "Sin Questions abiertas" : "Sin Questions"}>
          No hay información pendiente para esta Task.
        </Empty>
      ) : (
        ordered.map((question) => (
          <QuestionCard
            key={question.id}
            task={task}
            question={question}
            onEdit={() => {
              setEditing(question);
              setOpen(true);
            }}
            onUpdate={onUpdate}
            reload={reload}
          />
        ))
      )}
    </section>
  );
}

function QuestionEditorDialog({
  task,
  question,
  close,
  onUpdate,
  reload,
}: {
  readonly task: Task;
  readonly question: Question | null;
  readonly close: () => void;
  readonly onUpdate: (task: Task, message?: string) => void;
  readonly reload: () => void;
}) {
  const id = useId();
  const [type, setType] = useState<QuestionDraft["type"]>(question?.type ?? "text");
  const [text, setText] = useState(question?.text ?? "");
  const [options, setOptions] = useState(
    question?.options.map((item) => item.label).join("\n") ?? "",
  );
  const [allowOther, setAllowOther] = useState(question?.allowOther ?? false);
  const [localError, setLocalError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: () => {
      const payload = questionPayload({
        type,
        text,
        options:
          type === "text"
            ? []
            : options
                .split("\n")
                .map((item) => item.trim())
                .filter(Boolean),
        allowOther,
      });
      return question
        ? api.updateQuestion(task.id, question.id, payload, task.version)
        : api.createQuestion(task.id, payload, task.version);
    },
    onSuccess: (value) => {
      onUpdate(value, question ? "Question guardada" : "Question creada; Task bloqueada");
      close();
    },
    onError: (error) => {
      if (error instanceof Error && error.name === "ZodError")
        setLocalError("Revisa texto y opciones (2–20 para choices).");
    },
  });
  const conflict = preserveConflict(
    mutation.error,
    JSON.stringify({ type, text, options, allowOther }, null, 2),
    task.version,
  );
  useEffect(() => {
    setType(question?.type ?? "text");
    setText(question?.text ?? "");
    setOptions(question?.options.map((item) => item.label).join("\n") ?? "");
    setAllowOther(question?.allowOther ?? false);
  }, [question]);
  useEffect(() => {
    if (localError || mutation.error) focusFirstInvalid();
  }, [localError, mutation.error]);
  const textError = apiFieldMessage(mutation.error, "text");
  const optionsError = apiFieldMessage(mutation.error, "options");
  return (
    <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>{question ? "Editar Question" : "Crear Question"}</DialogTitle>
        <DialogDescription>
          Define qué información necesita el curator o el implementador.
        </DialogDescription>
      </DialogHeader>
      <FieldGroup>
        <Field data-invalid={Boolean(localError || textError)}>
          <FieldLabel htmlFor={`${id}-text`}>Texto</FieldLabel>
          <Textarea
            id={`${id}-text`}
            className="min-h-24"
            value={text}
            aria-invalid={Boolean(localError || textError)}
            aria-describedby={localError || textError ? `${id}-definition-error` : undefined}
            onChange={(event) => setText(event.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${id}-type`}>Tipo</FieldLabel>
          <Select
            items={questionTypeOptions}
            value={type}
            onValueChange={(value) => value && setType(value as QuestionDraft["type"])}
          >
            <SelectTrigger id={`${id}-type`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {questionTypeOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        {type !== "text" ? (
          <Field data-invalid={Boolean(localError || optionsError)}>
            <FieldLabel htmlFor={`${id}-options`}>Opciones</FieldLabel>
            <Textarea
              id={`${id}-options`}
              className="min-h-32"
              value={options}
              aria-invalid={Boolean(localError || optionsError)}
              aria-describedby={[
                `${id}-options-description`,
                localError || optionsError ? `${id}-definition-error` : null,
              ]
                .filter(Boolean)
                .join(" ")}
              onChange={(event) => setOptions(event.target.value)}
            />
            <FieldDescription id={`${id}-options-description`}>
              Una opción por línea; mínimo 2 y máximo 20.
            </FieldDescription>
          </Field>
        ) : null}
        <Field orientation="horizontal">
          <Checkbox id={`${id}-other`} checked={allowOther} onCheckedChange={setAllowOther} />
          <FieldLabel htmlFor={`${id}-other`}>Permitir “Otro”</FieldLabel>
        </Field>
      </FieldGroup>
      {localError || textError || optionsError ? (
        <FieldError id={`${id}-definition-error`}>
          {localError ?? textError ?? optionsError}
        </FieldError>
      ) : null}
      {conflict ? (
        <ConflictBanner
          readVersion={conflict.readVersion}
          currentVersion={conflict.currentVersion}
          text={conflict.draft}
          reload={reload}
        />
      ) : mutation.isError && !localError ? (
        <ErrorNotice error={mutation.error} />
      ) : null}
      <DialogFooter>
        <Button variant="outline" onClick={close}>
          Cancelar
        </Button>
        <Button
          disabled={mutation.isPending}
          onClick={() => {
            setLocalError(null);
            mutation.mutate();
          }}
        >
          {mutation.isPending ? "Guardando…" : question ? "Guardar Question" : "Crear Question"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

function QuestionCard({
  task,
  question,
  onEdit,
  onUpdate,
  reload,
}: {
  readonly task: Task;
  readonly question: Question;
  readonly onEdit?: () => void;
  readonly onUpdate: (task: Task, message?: string) => void;
  readonly reload: () => void;
}) {
  const [selected, setSelected] = useState<string[]>(question.selectedOptionIds);
  const [answer, setAnswer] = useState(question.answerText ?? "");
  const [localError, setLocalError] = useState<string | null>(null);
  const answerMutation = useMutation({
    mutationFn: () =>
      api.answerQuestion(
        task.id,
        question.id,
        answerPayload(question, selected, answer),
        task.version,
      ),
    onSuccess: (value) => {
      const lastOpen = task.questions.filter((item) => item.status === "open").length === 1;
      onUpdate(
        value,
        lastOpen
          ? "Respuestas completas; pendiente de revisión del curator"
          : "Question respondida",
      );
    },
    onError: (error) => {
      if (error instanceof Error && !("code" in error)) setLocalError(error.message);
    },
  });
  const conflict = preserveConflict(
    answerMutation.error,
    JSON.stringify({ selectedOptionIds: selected, answerText: answer }, null, 2),
    task.version,
  );
  const readOnly = Boolean(task.archivedAt);
  const answerErrorId = `answer-${question.id}-error`;
  useEffect(() => {
    if (localError || answerMutation.error) focusFirstInvalid();
  }, [localError, answerMutation.error]);
  const setChoice = (optionId: string, checked: boolean) =>
    setSelected(
      question.type === "single_choice"
        ? checked
          ? [optionId]
          : []
        : checked
          ? [...selected, optionId]
          : selected.filter((value) => value !== optionId),
    );
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>{question.text}</CardTitle>
        <CardDescription>
          {question.type.replaceAll("_", " ")} · creada {formatDate(question.createdAt)}
        </CardDescription>
        <CardAction className="flex gap-2">
          <StatusBadge status={question.status} />
          {question.status === "open" &&
          question.answeredAt === null &&
          !readOnly &&
          onEdit !== undefined ? (
            <Button size="sm" variant="outline" onClick={onEdit}>
              <PencilIcon /> Editar
            </Button>
          ) : null}
        </CardAction>
      </CardHeader>
      <CardContent className="grid gap-4">
        {question.status === "open" ? (
          <>
            <div className="grid gap-3">
              {question.type === "single_choice" ? (
                <RadioGroup
                  value={selected[0] ?? ""}
                  aria-invalid={Boolean(localError)}
                  aria-describedby={localError ? answerErrorId : undefined}
                  onValueChange={(value) => setSelected(value ? [value] : [])}
                >
                  {question.options.map((option) => (
                    <Field orientation="horizontal" key={option.id}>
                      <RadioGroupItem value={option.id} id={option.id} disabled={readOnly} />
                      <FieldLabel htmlFor={option.id}>{option.label}</FieldLabel>
                    </Field>
                  ))}
                </RadioGroup>
              ) : (
                question.options.map((option) => (
                  <Field orientation="horizontal" key={option.id}>
                    <Checkbox
                      id={option.id}
                      checked={selected.includes(option.id)}
                      disabled={readOnly}
                      aria-invalid={Boolean(localError)}
                      aria-describedby={localError ? answerErrorId : undefined}
                      onCheckedChange={(checked) => setChoice(option.id, checked)}
                    />
                    <FieldLabel htmlFor={option.id}>{option.label}</FieldLabel>
                  </Field>
                ))
              )}
            </div>
            <Field data-invalid={Boolean(localError && question.type === "text")}>
              <FieldLabel htmlFor={`answer-${question.id}`}>
                {question.type === "text"
                  ? "Respuesta"
                  : question.allowOther
                    ? "Otro / comentario"
                    : "Comentario opcional"}
              </FieldLabel>
              <Textarea
                id={`answer-${question.id}`}
                value={answer}
                disabled={readOnly}
                aria-invalid={Boolean(localError && question.type === "text")}
                aria-describedby={localError ? answerErrorId : undefined}
                onChange={(event) => setAnswer(event.target.value)}
              />
            </Field>
            {localError ? <FieldError id={answerErrorId}>{localError}</FieldError> : null}
            {conflict ? (
              <ConflictBanner
                readVersion={conflict.readVersion}
                currentVersion={conflict.currentVersion}
                text={conflict.draft}
                reload={reload}
              />
            ) : null}
            {!readOnly ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={answerMutation.isPending}
                  onClick={() => {
                    setLocalError(null);
                    answerMutation.mutate();
                  }}
                >
                  Responder
                </Button>
                <ReasonActionDialog
                  trigger={<Button variant="outline">Descartar</Button>}
                  title="Descartar Question"
                  description="La Question quedará resuelta sin respuesta. Si es la última abierta, la Task volverá a Curating."
                  confirmLabel="Descartar"
                  action={(reason) =>
                    api.dismissQuestion(task.id, question.id, task.version, reason)
                  }
                  onSuccess={(value) => onUpdate(value, "Question descartada")}
                />
              </div>
            ) : null}
          </>
        ) : (
          <>
            <div className="rounded-lg bg-muted/60 p-4">
              <p className="whitespace-pre-wrap">{question.answerText || "Sin texto adicional"}</p>
              {question.selectedOptionIds.length ? (
                <p className="mt-2 text-sm text-muted-foreground">
                  {question.options
                    .filter((option) => question.selectedOptionIds.includes(option.id))
                    .map((option) => option.label)
                    .join(", ")}
                </p>
              ) : null}
            </div>
            {task.status !== "done" && !readOnly ? (
              <ReasonActionDialog
                trigger={
                  <Button className="justify-self-start" variant="outline">
                    <RotateCcwIcon /> Reabrir
                  </Button>
                }
                title="Reabrir Question"
                description="La Task pasará automáticamente a Blocked."
                confirmLabel="Reabrir"
                action={(reason) => api.reopenQuestion(task.id, question.id, task.version, reason)}
                onSuccess={(value) => onUpdate(value, "Question reabierta; Task bloqueada")}
              />
            ) : null}
          </>
        )}
        {answerMutation.isError && !localError && !conflict ? (
          <ErrorNotice error={answerMutation.error} />
        ) : null}
      </CardContent>
    </Card>
  );
}

function AttachmentsSection({
  task,
  onRefresh,
  reload,
}: {
  readonly task: Task;
  readonly onRefresh: () => void;
  readonly reload: () => void;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const queue = useUploadQueue();
  const job = queue.jobs.get(task.id);
  const remove = useMutation({
    mutationFn: (id: string) => api.removeAttachment(task.id, id, task.version),
    onSuccess: () => {
      toast.success("Attachment eliminado");
      onRefresh();
    },
  });
  const removeConflict = preserveConflict(remove.error, "Eliminar attachment", task.version);
  const done =
    job?.entries.filter((entry) => entry.status === "uploaded" || entry.status === "failed")
      .length ?? 0;
  const failed = job?.entries.filter((entry) => entry.status === "failed").length ?? 0;
  const progress = job?.entries.length ? Math.round((done / job.entries.length) * 100) : 0;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Attachments</CardTitle>
        <CardDescription>Ficheros autenticados asociados a la Task.</CardDescription>
      </CardHeader>
      <CardContent className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 overflow-hidden">
        {!task.archivedAt ? (
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <Field className="min-w-0">
              <FieldLabel htmlFor={`attachments-${task.id}`}>Añadir ficheros</FieldLabel>
              <Input
                className="overflow-hidden"
                id={`attachments-${task.id}`}
                type="file"
                multiple
                accept={attachmentAccept}
                aria-invalid={Boolean(fileError)}
                aria-describedby={[
                  `attachments-${task.id}-description`,
                  fileError ? `attachments-${task.id}-error` : null,
                ]
                  .filter(Boolean)
                  .join(" ")}
                onChange={(event) => {
                  const selected = Array.from(event.target.files ?? []);
                  const validation = validateAttachmentFiles(selected, task.attachments.length);
                  setFileError(validation);
                  setFiles(validation ? [] : selected);
                }}
              />
              <FieldDescription id={`attachments-${task.id}-description`}>
                Quedan {Math.max(0, 10 - task.attachments.length)} de 10; máximo 25 MiB por fichero.
              </FieldDescription>
              <FieldError id={`attachments-${task.id}-error`}>{fileError}</FieldError>
            </Field>
            <Button
              disabled={!files.length || job?.running}
              onClick={() => {
                queue.start(task.id, task.version, files);
                setFiles([]);
              }}
            >
              <FileUpIcon /> Subir secuencialmente
            </Button>
            {files.length ? (
              <ul className="grid gap-2 sm:col-span-2" aria-label="Attachments preparados">
                {files.map((file, index) => (
                  <li
                    key={`${file.name}-${file.size}-${index}`}
                    className="flex min-w-0 items-center gap-3 rounded-md border p-2 text-sm"
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {file.name} · {formatFileSize(file.size)}
                    </span>
                    <Badge variant="outline">Pendiente</Badge>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Retirar ${file.name}`}
                      onClick={() =>
                        setFiles((current) => current.filter((_, fileIndex) => fileIndex !== index))
                      }
                    >
                      <Trash2Icon />
                    </Button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
        {job ? (
          <div className="grid gap-3 rounded-lg border bg-muted/30 p-4">
            <Progress value={progress}>
              <ProgressLabel>
                {job.running
                  ? "Subiendo attachments"
                  : failed
                    ? "Upload completado con errores"
                    : "Upload completado"}
              </ProgressLabel>
              <span className="ml-auto text-sm text-muted-foreground">{progress}%</span>
            </Progress>
            <ul className="grid gap-1 text-sm" aria-live="polite">
              {job.entries.map((entry, index) => (
                <li
                  key={`${entry.file.name}-${entry.file.size}-${index}`}
                  className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1"
                >
                  <span className="truncate">
                    {entry.file.name} · {formatFileSize(entry.file.size)}
                  </span>
                  <Badge variant={entry.status === "failed" ? "destructive" : "outline"}>
                    {
                      {
                        pending: "Pendiente",
                        uploading: "Subiendo",
                        uploaded: "Subido",
                        failed: "Fallido",
                      }[entry.status]
                    }
                  </Badge>
                  {entry.error ? (
                    <span className="col-span-2 text-xs text-destructive">{entry.error}</span>
                  ) : null}
                </li>
              ))}
            </ul>
            <div className="flex gap-2">
              {failed && !job.running ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => queue.retryFailed(task.id, task.version)}
                >
                  Reintentar fallidos
                </Button>
              ) : null}
              {!job.running ? (
                <Button size="sm" variant="ghost" onClick={() => queue.clear(task.id)}>
                  Cerrar progreso
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
        {removeConflict ? (
          <ConflictBanner
            readVersion={removeConflict.readVersion}
            currentVersion={removeConflict.currentVersion}
            text={removeConflict.draft}
            reload={reload}
          />
        ) : null}
        {task.attachments.length === 0 ? (
          <Empty title="Sin Attachments">No hay ficheros asociados a esta Task.</Empty>
        ) : (
          <div className="divide-y rounded-lg border">
            {task.attachments.map((attachment) => (
              <div
                className="flex flex-wrap items-center justify-between gap-3 p-4"
                key={attachment.id}
              >
                <div className="flex min-w-0 items-start gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted">
                    <FileIcon className="size-4" />
                  </span>
                  <div className="min-w-0">
                    <strong className="block truncate">{attachment.originalName}</strong>
                    <p className="text-xs text-muted-foreground">
                      {attachment.mimeType} · {formatBytes(attachment.sizeBytes)}
                    </p>
                    <CopyValue label="SHA-256" value={attachment.sha256} />
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <a
                    className={buttonVariants({ variant: "outline", size: "sm" })}
                    href={`/api/v1/tasks/${task.id}/attachments/${attachment.id}/content`}
                  >
                    <DownloadIcon /> Descargar
                  </a>
                  {!task.archivedAt ? (
                    <ConfirmAction
                      trigger={
                        <Button size="sm" variant="destructive">
                          <Trash2Icon /> Eliminar
                        </Button>
                      }
                      title="Eliminar attachment"
                      description={`Se eliminará ${attachment.originalName}. Esta acción no puede deshacerse desde AIWS.`}
                      confirmLabel="Eliminar"
                      destructive
                      disabled={remove.isPending}
                      onConfirm={() => remove.mutate(attachment.id)}
                    />
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
        {remove.isError && !removeConflict ? <ErrorNotice error={remove.error} /> : null}
      </CardContent>
    </Card>
  );
}

function PrSection({
  task,
  onUpdate,
  reload,
}: {
  readonly task: Task;
  readonly onUpdate: (task: Task, message?: string) => void;
  readonly reload: () => void;
}) {
  const [url, setUrl] = useState(task.prUrl ?? "");
  const save = useMutation({
    mutationFn: (clear: boolean) =>
      api.updateTask(task.id, { prUrl: clear ? null : url }, task.version),
    onSuccess: (value) => onUpdate(value, "PR URL actualizada"),
  });
  const conflict = preserveConflict(save.error, url, task.version);
  useEffect(() => setUrl(task.prUrl ?? ""), [task.prUrl]);
  useEffect(() => {
    if (save.error && !conflict) focusFirstInvalid();
  }, [save.error, conflict]);
  return (
    <Card>
      <CardHeader>
        <CardTitle>PR URL</CardTitle>
        <CardDescription>
          AIWS almacena el enlace; no consulta ni sincroniza el proveedor.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {task.prUrl ? (
          <a
            className="inline-flex items-center gap-1 break-all text-sm font-medium text-primary hover:underline"
            href={task.prUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            {task.prUrl}
            <ExternalLinkIcon className="size-3.5 shrink-0" />
          </a>
        ) : null}
        {conflict ? (
          <ConflictBanner
            readVersion={conflict.readVersion}
            currentVersion={conflict.currentVersion}
            text={conflict.draft}
            reload={reload}
          />
        ) : null}
        {!task.archivedAt ? (
          <div className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
            <Field className="min-w-0" data-invalid={Boolean(apiFieldMessage(save.error, "prUrl"))}>
              <FieldLabel className="sr-only" htmlFor={`pr-${task.id}`}>
                PR URL
              </FieldLabel>
              <Input
                id={`pr-${task.id}`}
                type="url"
                maxLength={2048}
                placeholder="https://…"
                value={url}
                aria-invalid={Boolean(apiFieldMessage(save.error, "prUrl"))}
                aria-describedby={
                  apiFieldMessage(save.error, "prUrl") ? `pr-${task.id}-error` : undefined
                }
                onChange={(event) => setUrl(event.target.value)}
              />
              <FieldError id={`pr-${task.id}-error`}>
                {apiFieldMessage(save.error, "prUrl")}
              </FieldError>
            </Field>
            <Button
              disabled={save.isPending || !url || url === task.prUrl}
              onClick={() => save.mutate(false)}
            >
              Guardar
            </Button>
            <Button
              variant="outline"
              disabled={save.isPending || task.prUrl === null}
              onClick={() => save.mutate(true)}
            >
              Limpiar
            </Button>
          </div>
        ) : null}
        {save.isError && !conflict ? <ErrorNotice error={save.error} /> : null}
      </CardContent>
    </Card>
  );
}

function ReasonActionDialog<T>({
  trigger,
  title,
  description,
  confirmLabel,
  destructive = false,
  disabled = false,
  action,
  onSuccess,
}: {
  readonly trigger: ReactElement;
  readonly title: string;
  readonly description: string;
  readonly confirmLabel: string;
  readonly destructive?: boolean;
  readonly disabled?: boolean;
  readonly action: (reason: string | undefined) => Promise<T>;
  readonly onSuccess: (value: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const reasonId = useId();
  const mutation = useMutation({
    mutationFn: () => action(reason.trim() || undefined),
    onSuccess: (value) => {
      onSuccess(value);
      setOpen(false);
      setReason("");
    },
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} disabled={disabled} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel htmlFor={reasonId}>
            Motivo <span className="font-normal text-muted-foreground">(opcional)</span>
          </FieldLabel>
          <Textarea
            id={reasonId}
            maxLength={2000}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
        {mutation.isError ? <ErrorNotice error={mutation.error} /> : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            disabled={mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? "Guardando…" : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function canReady(task: Task): boolean {
  return (
    task.curatorSpec.trim().length > 0 &&
    !task.questions.some((question) => question.status === "open")
  );
}
function transitionDescription(from: TaskStatus, to: TaskStatus): string {
  return `Confirma la transición ${from} → ${to}. La versión de la Task se incrementará una vez.`;
}
function transitionIcon(status: TaskStatus): ReactNode {
  return status === "curating" ? (
    <PencilIcon />
  ) : status === "ready" ? (
    <CheckCircle2Icon />
  ) : status === "implementing" ? (
    <CircleAlertIcon />
  ) : (
    <CheckCircle2Icon />
  );
}
function formatBytes(value: number): string {
  return value < 1024
    ? `${value} B`
    : value < 1048576
      ? `${(value / 1024).toFixed(1)} KiB`
      : `${(value / 1048576).toFixed(1)} MiB`;
}

function taskStatusGuidance(task: Task): string {
  if (task.archivedAt) return "Task archivada · historial disponible en modo de solo lectura.";
  if (task.status === "draft") return "Prepara la petición y envíala a Curation.";
  if (task.status === "curating") return "Curation en curso; revisa el Run o confirma Ready.";
  if (task.status === "blocked") return "Hay Questions abiertas que requieren respuesta.";
  if (task.status === "ready") return "La Task puede reclamarse para Implementation.";
  if (task.status === "implementing") return "Implementation en curso; revisa el Run vigente.";
  return "Trabajo completado; puedes solicitar un cambio incremental.";
}

function runKindLabel(kind: Run["kind"]): string {
  return kind === "curation" ? "Curation" : "Implementation";
}

function runStatusLabel(status: Run["status"]): string {
  const labels: Record<Run["status"], string> = {
    queued: "En cola",
    preparing: "Preparando",
    running: "En ejecución",
    publishing: "Publicando",
    succeeded: "Completado",
    failed: "Fallido",
    cancelled: "Cancelado",
  };
  return labels[status];
}

function questionStatusLabel(status: Question["status"]): string {
  return status === "open" ? "Abierta" : status === "answered" ? "Respondida" : "Descartada";
}
