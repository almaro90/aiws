import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useBlocker } from "@tanstack/react-router";
import {
  ArchiveIcon,
  CheckCircle2Icon,
  CircleAlertIcon,
  DownloadIcon,
  ExternalLinkIcon,
  FileIcon,
  FileUpIcon,
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
  useState,
} from "react";
import { toast } from "sonner";
import {
  ConflictBanner,
  ConfirmAction,
  CopyValue,
  Empty,
  ErrorNotice,
  formatDate,
  Loading,
  PageHeader,
  StatusBadge,
  buttonVariants,
} from "../components/common.tsx";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert.tsx";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../components/ui/alert-dialog.tsx";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs.tsx";
import { Textarea } from "../components/ui/textarea.tsx";
import { ApiError, api } from "../lib/api.ts";
import { preserveConflict } from "../lib/conflict.ts";
import { renderSafeMarkdown } from "../lib/markdown.ts";
import { answerPayload, questionPayload, type QuestionDraft } from "../lib/questions.ts";
import type { Question, Run, Task, TaskStatus, TimelineItem } from "../lib/types.ts";
import { useUploadQueue } from "../lib/upload-queue.tsx";

const questionTypeOptions = [
  { value: "text", label: "Text" },
  { value: "single_choice", label: "Single choice" },
  { value: "multiple_choice", label: "Multiple choice" },
];

export function TaskDetailPage({ taskId }: { readonly taskId: string }) {
  const client = useQueryClient();
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const query = useQuery({
    queryKey: ["task", taskId],
    queryFn: () => api.task(taskId),
    refetchInterval: (current) => {
      const status = current.state.data?.status;
      return status === "curating" || status === "implementing" ? 5_000 : false;
    },
  });
  const update = (task: Task, message?: string) => {
    client.setQueryData(["task", taskId], task);
    void client.invalidateQueries({ queryKey: ["timeline", taskId] });
    void client.invalidateQueries({ queryKey: ["activity", taskId] });
    if (message) toast.success(message);
  };
  if (query.isError) return <ErrorNotice error={query.error} retry={() => void query.refetch()} />;
  if (query.data === undefined) return <Loading label="Cargando Task" />;
  const task = query.data;
  return (
    <>
      {task.archivedAt ? (
        <Alert>
          <ArchiveIcon />
          <AlertTitle>Task archivada</AlertTitle>
          <AlertDescription>
            El agregado está en modo de solo lectura. Restáuralo para volver a modificarlo.
          </AlertDescription>
        </Alert>
      ) : null}
      <TaskHeader task={task} onUpdate={update} reload={() => void query.refetch()} />
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-4 overflow-x-hidden lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="grid min-w-0 gap-4">
          <UserRequestSection task={task} onUpdate={update} reload={() => void query.refetch()} />
          <ConversationTimeline task={task} onUpdate={update} reload={() => void query.refetch()} />
          <MessageComposer
            task={task}
            refresh={() => {
              void query.refetch();
              void client.invalidateQueries({ queryKey: ["timeline", task.id] });
            }}
          />
          {task.project.repositoryMode === "local" ? (
            <QuestionsSection
              task={task}
              onUpdate={update}
              reload={() => void query.refetch()}
              controlsOnly
            />
          ) : null}
        </div>
        <aside className="min-w-0 lg:sticky lg:top-4">
          <Button
            className="mb-3 lg:hidden"
            variant="outline"
            aria-expanded={inspectorOpen}
            onClick={() => setInspectorOpen((value) => !value)}
          >
            {inspectorOpen ? "Cerrar inspector" : "Abrir inspector"}
          </Button>
          <div className={inspectorOpen ? "block" : "hidden lg:block"}>
            <TaskInspector task={task} onUpdate={update} reload={() => void query.refetch()} />
          </div>
        </aside>
      </div>
    </>
  );
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
      <CycleInspector task={task} />
      <SpecSection task={task} onUpdate={onUpdate} reload={reload} />
      <AttachmentsSection task={task} onRefresh={reload} reload={reload} />
      <PrSection task={task} onUpdate={onUpdate} reload={reload} />
    </div>
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
              <CopyValue label="Branch" value={task.currentDelivery.branchName} />
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
  onUpdate,
  reload,
}: {
  readonly task: Task;
  readonly onUpdate: (task: Task, message?: string) => void;
  readonly reload: () => void;
}) {
  const [logsRun, setLogsRun] = useState<Run | null>(null);
  const [editingQuestion, setEditingQuestion] = useState<Question | null>(null);
  const timeline = useInfiniteQuery({
    queryKey: ["timeline", task.id],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => api.timeline(task.id, pageParam),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    refetchInterval: task.status === "curating" || task.status === "implementing" ? 5_000 : false,
  });
  if (timeline.isError)
    return <ErrorNotice error={timeline.error} retry={() => void timeline.refetch()} />;
  if (timeline.data === undefined) return <Loading label="Cargando timeline" />;
  const items = [...timeline.data.pages].reverse().flatMap((page) => page.items);
  let previousCycle = "";
  return (
    <section className="grid gap-3" aria-label="Timeline de la Task">
      {timeline.hasNextPage ? (
        <Button
          variant="outline"
          disabled={timeline.isFetchingNextPage}
          onClick={() => void timeline.fetchNextPage()}
        >
          Cargar historial anterior
        </Button>
      ) : null}
      {items.map((item) => {
        const cycleId = item.cycleId ?? previousCycle;
        const separator = cycleId !== previousCycle;
        previousCycle = cycleId;
        return (
          <div key={timelineKey(item)} className="grid gap-3">
            {separator ? (
              <div className="flex items-center gap-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <span className="h-px flex-1 bg-border" />
                Cycle {cycleId === task.currentCycle.id ? task.currentCycle.number : cycleId}
                <span className="h-px flex-1 bg-border" />
              </div>
            ) : null}
            <TimelineCard
              item={item}
              task={task}
              onUpdate={onUpdate}
              reload={reload}
              openLogs={setLogsRun}
              editQuestion={setEditingQuestion}
            />
          </div>
        );
      })}
      {logsRun ? <RunLogsDialog run={logsRun} close={() => setLogsRun(null)} /> : null}
      {editingQuestion ? (
        <Dialog open onOpenChange={(open) => !open && setEditingQuestion(null)}>
          <QuestionEditorDialog
            task={task}
            question={editingQuestion}
            close={() => setEditingQuestion(null)}
            onUpdate={onUpdate}
            reload={reload}
          />
        </Dialog>
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
  task,
  onUpdate,
  reload,
  openLogs,
  editQuestion,
}: {
  readonly item: TimelineItem;
  readonly task: Task;
  readonly onUpdate: (task: Task, message?: string) => void;
  readonly reload: () => void;
  readonly openLogs: (run: Run) => void;
  readonly editQuestion: (question: Question) => void;
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
          <CardTitle className="text-base">Spec revision {item.revision}</CardTitle>
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
    if (item.cycleId === task.currentCycle.id)
      return (
        <QuestionCard
          task={task}
          question={item.question}
          onEdit={() => editQuestion(item.question)}
          onUpdate={onUpdate}
          reload={reload}
        />
      );
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Question histórica</CardTitle>
          <CardDescription>{item.question.status}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2">
          <p>{item.question.text}</p>
          {item.answers.map((answer) => (
            <p key={answer.id} className="rounded bg-muted p-2 text-sm">
              Respuesta {answer.revision}:{" "}
              {answer.answerText ?? answer.selectedOptionIds.join(", ")}
            </p>
          ))}
        </CardContent>
      </Card>
    );
  }
  if (item.kind === "run")
    return <RunTimelineCard run={item.run} task={task} reload={reload} openLogs={openLogs} />;
  return (
    <div className="mx-auto rounded-full border bg-muted/50 px-3 py-1 text-center text-xs text-muted-foreground">
      {item.event.type} · {formatDate(item.createdAt)}
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
    <Card>
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
  task,
  reload,
  openLogs,
}: {
  readonly run: Run;
  readonly task: Task;
  readonly reload: () => void;
  readonly openLogs: (run: Run) => void;
}) {
  const client = useQueryClient();
  const refresh = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ["task", task.id] }),
      client.invalidateQueries({ queryKey: ["timeline", task.id] }),
    ]);
    reload();
  };
  const retry = useMutation({
    mutationFn: (mode: "auto" | "full") => api.retryRun(run.id, task.version, mode),
    onSuccess: refresh,
  });
  const cancel = useMutation({
    mutationFn: () => api.cancelRun(run.id, "Cancelled from Web.", task.version),
    onSuccess: refresh,
  });
  const active = ["queued", "preparing", "running", "publishing"].includes(run.status);
  const retryable =
    ["failed", "cancelled"].includes(run.status) &&
    (task.status === "ready" || task.status === "curating");
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          Run {run.kind} · attempt {run.attempt}
        </CardTitle>
        <CardDescription>
          {run.status} · etapa {run.executionStage}
          {run.outcome ? ` · ${run.outcome}` : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <p className="text-sm text-muted-foreground">
          {run.summary ?? run.errorMessage ?? "Sin resumen"}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => openLogs(run)}>
            Logs
          </Button>
          {retryable ? (
            <Button size="sm" disabled={retry.isPending} onClick={() => retry.mutate("auto")}>
              Retry
            </Button>
          ) : null}
          {retryable && run.executionStage === "publishing" ? (
            <Button
              variant="outline"
              size="sm"
              disabled={retry.isPending}
              onClick={() => retry.mutate("full")}
            >
              Retry completo
            </Button>
          ) : null}
          {active ? (
            <Button
              variant="destructive"
              size="sm"
              disabled={cancel.isPending}
              onClick={() => cancel.mutate()}
            >
              Cancelar
            </Button>
          ) : null}
        </div>
        {retry.isError ? <ErrorNotice error={retry.error} /> : null}
        {cancel.isError ? <ErrorNotice error={cancel.error} /> : null}
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
      query.state.data !== undefined && isActiveRun(query.state.data.status) ? 3_000 : false,
  });
  const active = isActiveRun(current.data.status);
  const logs = useQuery({
    queryKey: ["run-logs", run.id],
    queryFn: () => api.runLogs(run.id),
    retry: false,
    refetchInterval: active ? 3_000 : false,
  });
  const missing = logs.error instanceof ApiError && logs.error.code === "not_found";
  const logText = logs.data ?? "";
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : close())}>
      <DialogContent showCloseButton={false} className="max-h-[90svh] overflow-hidden sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Logs · Attempt {run.attempt}</DialogTitle>
          <DialogDescription>
            Eventos NDJSON del Run {run.kind}. Los secretos permanecen redactados.
          </DialogDescription>
        </DialogHeader>
        {logs.isLoading ? (
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
        ) : logs.isError ? (
          <ErrorNotice error={logs.error} retry={() => void logs.refetch()} />
        ) : logText.trim() === "" ? (
          <Empty title={active ? "Iniciando captura de logs…" : "Logs vacíos"}>
            {active ? "Los eventos aparecerán automáticamente." : "El Run no produjo eventos."}
          </Empty>
        ) : (
          <pre className="max-h-[65svh] overflow-auto rounded-lg bg-muted p-3 font-mono text-xs whitespace-pre-wrap">
            {formatRunLogs(logText)}
          </pre>
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

function isActiveRun(status: Run["status"]): boolean {
  return ["queued", "preparing", "running", "publishing"].includes(status);
}

export function formatRunLogs(value: string): string {
  return value
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => {
      try {
        return JSON.stringify(JSON.parse(line), null, 2);
      } catch {
        return line;
      }
    })
    .join("\n\n");
}

function TaskHeader({
  task,
  onUpdate,
  reload,
}: {
  readonly task: Task;
  readonly onUpdate: (task: Task, message?: string) => void;
  readonly reload: () => void;
}) {
  const titleId = useId();
  const [title, setTitle] = useState(task.title);
  const save = useMutation({
    mutationFn: () => api.updateTask(task.id, { title }, task.version),
    onSuccess: (value) => onUpdate(value, "Title guardado"),
  });
  const restore = useMutation({
    mutationFn: () => api.unarchiveTask(task.id, task.version),
    onSuccess: (value) => onUpdate(value, "Task restaurada"),
  });
  const resumeAutomation = useMutation({
    mutationFn: () => api.resumeTaskAutomation(task.id, task.version),
    onSuccess: (value) => onUpdate(value, "Automatización reanudada"),
  });
  const titleConflict = preserveConflict(save.error, title, task.version);
  const next = explicitTransition(task);
  useEffect(() => setTitle(task.title), [task.title]);
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <PageHeader
            title={task.title}
            description={`Task · v${task.version}`}
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
                No se crearán nuevos Runs para esta Task hasta reanudarla. Revisa antes el último
                fallo en la timeline.
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
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <CopyValue label="ID" value={task.id} />
          <Link
            className="text-sm font-medium text-primary hover:underline"
            to="/projects/$projectId"
            params={{ projectId: task.project.id }}
          >
            {task.project.name}
          </Link>
          {task.archivedAt ? (
            <Badge variant="outline">Archivada {formatDate(task.archivedAt)}</Badge>
          ) : null}
        </div>
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
            <Field className="min-w-0 flex-1 basis-64">
              <FieldLabel className="sr-only" htmlFor={titleId}>
                Title
              </FieldLabel>
              <Input
                id={titleId}
                maxLength={200}
                value={title}
                disabled={task.status !== "draft"}
                onChange={(event) => setTitle(event.target.value)}
              />
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
              <SaveIcon /> Guardar title
            </Button>
          </form>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {next ? (
            <ReasonActionDialog
              trigger={
                <Button>
                  {transitionIcon(next)}
                  {transitionLabel(next)}
                </Button>
              }
              title={transitionLabel(next)}
              description={transitionDescription(task.status, next)}
              confirmLabel={transitionLabel(next)}
              disabled={next === "ready" && !canReady(task)}
              action={(reason) =>
                api.transitionTask(
                  task.id,
                  { from: task.status, to: next, ...(reason ? { reason } : {}) },
                  task.version,
                )
              }
              onSuccess={(value) => onUpdate(value, `Task movida a ${next}`)}
            />
          ) : null}
          {task.archivedAt ? (
            <Button disabled={restore.isPending} onClick={() => restore.mutate()}>
              <RotateCcwIcon /> Restaurar Task
            </Button>
          ) : (
            <ReasonActionDialog
              trigger={
                <Button variant="destructive">
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
          )}
        </div>
        {next === "ready" && !canReady(task) && !task.archivedAt ? (
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
        <Field>
          <FieldLabel htmlFor={requestId}>User Request</FieldLabel>
          <Textarea
            id={requestId}
            className="min-h-40"
            maxLength={100000}
            value={request}
            onChange={(event) => setRequest(event.target.value)}
          />
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
  const blocker = useBlocker({
    shouldBlockFn: () => dirty,
    disabled: !dirty,
    enableBeforeUnload: dirty,
    withResolver: true,
  });
  useEffect(() => {
    if (!dirty) setSpec(task.curatorSpec);
  }, [task.curatorSpec, dirty]);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Curator Spec</CardTitle>
        <CardDescription>
          Markdown implementable para el agente externo. El guardado es explícito.
        </CardDescription>
        {dirty ? (
          <CardAction>
            <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-800">
              Cambios sin guardar
            </Badge>
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
            <Field>
              <FieldLabel className="sr-only" htmlFor={`spec-${task.id}`}>
                Curator Spec Markdown
              </FieldLabel>
              <Textarea
                id={`spec-${task.id}`}
                className="min-h-80 font-mono"
                maxLength={1048576}
                value={spec}
                disabled={Boolean(task.archivedAt)}
                onChange={(event) => setSpec(event.target.value)}
              />
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
        <AlertDialog
          open={blocker.status === "blocked"}
          onOpenChange={(open) => {
            if (!open && blocker.status === "blocked") blocker.reset();
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Hay cambios sin guardar</AlertDialogTitle>
              <AlertDialogDescription>
                Si sales ahora perderás el borrador local de la Curator Spec.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => blocker.status === "blocked" && blocker.reset()}>
                Seguir editando
              </AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                onClick={() => blocker.status === "blocked" && blocker.proceed()}
              >
                Salir sin guardar
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}

function QuestionsSection({
  task,
  onUpdate,
  reload,
  controlsOnly = false,
}: {
  readonly task: Task;
  readonly onUpdate: (task: Task, message?: string) => void;
  readonly reload: () => void;
  readonly controlsOnly?: boolean;
}) {
  const titleId = useId();
  const [editing, setEditing] = useState<Question | null>(null);
  const [open, setOpen] = useState(false);
  const ordered = [...task.questions].sort(
    (left, right) =>
      Number(right.status === "open") - Number(left.status === "open") ||
      left.createdAt.localeCompare(right.createdAt),
  );
  const canCreate = !task.archivedAt && task.status !== "draft" && task.status !== "done";
  return (
    <section className="grid gap-3" aria-labelledby={titleId}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id={titleId} className="text-xl font-semibold">
            Questions
          </h2>
          <p className="text-sm text-muted-foreground">
            Las Questions abiertas bloquean automáticamente la Task.
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
        <Empty title="Sin Questions">No hay información pendiente para esta Task.</Empty>
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
  return (
    <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>{question ? "Editar Question" : "Crear Question"}</DialogTitle>
        <DialogDescription>
          Define qué información necesita el curator o el implementador.
        </DialogDescription>
      </DialogHeader>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor={`${id}-text`}>Texto</FieldLabel>
          <Textarea
            id={`${id}-text`}
            className="min-h-24"
            value={text}
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
          <Field>
            <FieldLabel htmlFor={`${id}-options`}>Opciones</FieldLabel>
            <Textarea
              id={`${id}-options`}
              className="min-h-32"
              value={options}
              onChange={(event) => setOptions(event.target.value)}
            />
            <FieldDescription>Una opción por línea; mínimo 2 y máximo 20.</FieldDescription>
          </Field>
        ) : null}
        <Field orientation="horizontal">
          <Checkbox id={`${id}-other`} checked={allowOther} onCheckedChange={setAllowOther} />
          <FieldLabel htmlFor={`${id}-other`}>Permitir “Otro”</FieldLabel>
        </Field>
      </FieldGroup>
      {localError ? <FieldError>{localError}</FieldError> : null}
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
          disabled={mutation.isPending || !text.trim()}
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
                      onCheckedChange={(checked) => setChoice(option.id, checked)}
                    />
                    <FieldLabel htmlFor={option.id}>{option.label}</FieldLabel>
                  </Field>
                ))
              )}
            </div>
            <Field>
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
                onChange={(event) => setAnswer(event.target.value)}
              />
            </Field>
            {localError ? <FieldError>{localError}</FieldError> : null}
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
                  description="La Question quedará resuelta sin respuesta. Si es la última abierta, la Task volverá a Draft."
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
                onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
              />
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
              {job.entries.map((entry) => (
                <li key={entry.file.name} className="flex items-center justify-between gap-3">
                  <span className="truncate">{entry.file.name}</span>
                  <Badge variant={entry.status === "failed" ? "destructive" : "outline"}>
                    {entry.status}
                  </Badge>
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
            <Field className="min-w-0">
              <FieldLabel className="sr-only" htmlFor={`pr-${task.id}`}>
                PR URL
              </FieldLabel>
              <Input
                id={`pr-${task.id}`}
                type="url"
                maxLength={2048}
                placeholder="https://…"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
              />
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

function _ActivitySection({
  taskId,
  initial,
  error,
  loading,
}: {
  readonly taskId: string;
  readonly initial: Awaited<ReturnType<typeof api.activity>> | undefined;
  readonly error: unknown;
  readonly loading: boolean;
}) {
  const [pages, setPages] = useState(initial ? [initial] : []);
  const cursor = pages.at(-1)?.nextCursor;
  const more = useMutation({
    mutationFn: () => api.activity(taskId, cursor ?? undefined),
    onSuccess: (page) => setPages((current) => [...current, page]),
  });
  useEffect(() => {
    if (initial) setPages([initial]);
  }, [initial]);
  if (loading) return <Loading label="Cargando actividad" />;
  if (error) return <ErrorNotice error={error} />;
  const events = pages.flatMap((page) => page.items);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Activity</CardTitle>
        <CardDescription>Historial append-only de mutaciones relevantes.</CardDescription>
      </CardHeader>
      <CardContent>
        {events.length === 0 ? (
          <Empty title="Sin actividad">Todavía no se han registrado eventos.</Empty>
        ) : (
          <ol className="relative ml-2 grid gap-5 border-l pl-5">
            {events.map((event) => (
              <li key={event.id} className="relative">
                <span className="absolute -left-[1.55rem] top-1.5 size-2 rounded-full bg-primary ring-4 ring-background" />
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <strong className="text-sm">{eventLabel(event.type)}</strong>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Actor: {event.actorType}
                      {typeof event.metadata.reason === "string"
                        ? ` · ${event.metadata.reason}`
                        : ""}
                      {typeof event.metadata.from === "string" &&
                      typeof event.metadata.to === "string"
                        ? ` · ${event.metadata.from} → ${event.metadata.to}`
                        : ""}
                    </p>
                  </div>
                  <time className="text-xs text-muted-foreground">
                    {formatDate(event.createdAt)}
                  </time>
                </div>
              </li>
            ))}
          </ol>
        )}
        {cursor ? (
          <Button
            className="mt-5"
            variant="outline"
            disabled={more.isPending}
            onClick={() => more.mutate()}
          >
            {more.isPending ? "Cargando…" : "Cargar más"}
          </Button>
        ) : null}
        {more.isError ? <ErrorNotice error={more.error} /> : null}
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

function explicitTransition(task: Task): TaskStatus | null {
  if (task.archivedAt) return null;
  if (task.status === "draft") return "curating";
  if (task.status === "curating") return "ready";
  if (task.status === "ready") return "implementing";
  if (task.status === "implementing") return "done";
  return null;
}
function canReady(task: Task): boolean {
  return (
    task.curatorSpec.trim().length > 0 &&
    !task.questions.some((question) => question.status === "open")
  );
}
function transitionLabel(status: TaskStatus): string {
  return status === "curating"
    ? "Enviar a curator"
    : status === "ready"
      ? "Marcar Ready"
      : status === "implementing"
        ? "Claim Task"
        : "Completar Task";
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
function eventLabel(type: string): string {
  const labels: Record<string, string> = {
    task_created: "Task creada",
    task_updated: "Task actualizada",
    spec_updated: "Curator Spec actualizada",
    status_changed: "Estado cambiado",
    question_created: "Question creada",
    question_updated: "Question actualizada",
    question_answered: "Question respondida",
    question_dismissed: "Question descartada",
    question_reopened: "Question reabierta",
    attachment_added: "Attachment añadido",
    attachment_removed: "Attachment eliminado",
    pr_url_updated: "PR URL actualizada",
    task_archived: "Task archivada",
    task_unarchived: "Task restaurada",
  };
  return labels[type] ?? type.replaceAll("_", " ");
}
