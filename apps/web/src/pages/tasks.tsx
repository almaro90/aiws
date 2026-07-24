import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowRightIcon,
  FileUpIcon,
  FilterXIcon,
  PlusIcon,
  SlidersHorizontalIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import {
  ActiveFilters,
  CopyValue,
  Empty,
  ErrorNotice,
  formatDate,
  LoadMoreFooter,
  Loading,
  PageBreadcrumb,
  PageHeader,
  StatusBadge,
  buttonVariants,
} from "../components/common.tsx";
import { Button } from "../components/ui/button.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card.tsx";
import { Checkbox } from "../components/ui/checkbox.tsx";
import { Combobox } from "../components/ui/combobox.tsx";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "../components/ui/field.tsx";
import { Input } from "../components/ui/input.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table.tsx";
import { Textarea } from "../components/ui/textarea.tsx";
import { api, apiFieldMessage } from "../lib/api.ts";
import {
  allowedAttachmentExtensions,
  attachmentAccept,
  formatFileSize,
  validateAttachmentFiles,
} from "../lib/attachment-files.ts";
import { focusFirstInvalid, UnsavedChangesBadge, UnsavedChangesGuard } from "../lib/form-state.tsx";
import {
  mergePageItems,
  parseTaskFilters,
  serializeTaskFilters,
  type TaskFilters,
} from "../lib/query.ts";
import type { TaskSummary } from "../lib/types.ts";
import { useUploadQueue } from "../lib/upload-queue.tsx";

const statuses = ["draft", "curating", "blocked", "ready", "implementing", "done"] as const;

interface FilterState {
  projectId: string;
  statuses: string[];
  accountScope: string;
  gitProvider: string;
  archived: boolean;
  sort: "updatedAt" | "createdAt";
  order: "asc" | "desc";
}

export function TasksPage({ search }: { readonly search: Record<string, unknown> }) {
  const archivedId = useId();
  const navigate = useNavigate();
  const filters = useMemo(() => parseTaskFilters(search), [search]);
  const [draft, setDraft] = useState<FilterState>(() => filterStateFromTaskFilters(filters));
  const suffix = serializeTaskFilters(filters);
  useEffect(() => setDraft(filterStateFromTaskFilters(filters)), [filters]);
  const query = useQuery({ queryKey: ["tasks", suffix], queryFn: () => api.tasks(suffix) });
  const queryClient = useQueryClient();
  const more = useMutation({
    mutationFn: (cursor: string) =>
      api.tasks(`${suffix}${suffix ? "&" : "?"}cursor=${encodeURIComponent(cursor)}`),
    onSuccess: (page) =>
      query.data &&
      queryClient.setQueryData(["tasks", suffix], {
        items: mergePageItems(query.data.items, page.items),
        nextCursor: page.nextCursor,
      }),
  });
  const projects = useQuery({ queryKey: ["projects", "active"], queryFn: () => api.projects() });

  const navigateToFilters = (next: FilterState) =>
    navigate({
      to: "/tasks",
      search: {
        projectId: next.projectId === "all" ? undefined : next.projectId,
        status: next.statuses.length ? next.statuses : undefined,
        accountScope: next.accountScope === "all" ? undefined : next.accountScope,
        gitProvider: next.gitProvider === "all" ? undefined : next.gitProvider,
        archived: next.archived || undefined,
        sort: next.sort === "updatedAt" ? undefined : next.sort,
        order: next.order === "desc" ? undefined : next.order,
      },
    });
  const apply = () => void navigateToFilters(draft);
  const clear = () => {
    setDraft(defaultFilterState());
    void navigate({ to: "/tasks", search: {} });
  };
  const applied = filterStateFromTaskFilters(filters);
  const projectName =
    projects.data?.items.find((project) => project.id === applied.projectId)?.name ??
    applied.projectId;
  const activeFilters = [
    ...(applied.projectId !== "all"
      ? [{ key: "projectId", label: `Project: ${projectName}` }]
      : []),
    ...applied.statuses.map((status) => ({
      key: `status:${status}`,
      label: `Estado: ${status[0]?.toUpperCase()}${status.slice(1)}`,
    })),
    ...(applied.accountScope !== "all"
      ? [
          {
            key: "accountScope",
            label: `Ámbito: ${applied.accountScope === "work" ? "Trabajo" : "Personal"}`,
          },
        ]
      : []),
    ...(applied.gitProvider !== "all"
      ? [{ key: "gitProvider", label: `Proveedor: ${providerLabel(applied.gitProvider)}` }]
      : []),
    ...(applied.archived ? [{ key: "archived", label: "Archivadas" }] : []),
    ...(applied.sort !== "updatedAt" ? [{ key: "sort", label: "Orden: creación" }] : []),
    ...(applied.order !== "desc" ? [{ key: "order", label: "Dirección: ascendente" }] : []),
  ];
  const removeFilter = (key: string) => {
    const next = { ...applied, statuses: [...applied.statuses] };
    if (key.startsWith("status:")) {
      next.statuses = next.statuses.filter((status) => status !== key.slice("status:".length));
    } else if (key === "projectId") next.projectId = "all";
    else if (key === "accountScope") next.accountScope = "all";
    else if (key === "gitProvider") next.gitProvider = "all";
    else if (key === "archived") next.archived = false;
    else if (key === "sort") next.sort = "updatedAt";
    else if (key === "order") next.order = "desc";
    void navigateToFilters(next);
  };

  return (
    <>
      <PageHeader
        title="Tasks"
        description="Consulta el workflow, filtra colas de trabajo y abre el agregado completo."
        actions={
          <Link className={buttonVariants()} to="/tasks/new" search={{ projectId: undefined }}>
            <PlusIcon /> Crear Task
          </Link>
        }
      />
      <Card size="sm">
        <CardContent className="grid gap-4">
          <div className="grid gap-3 lg:grid-cols-[minmax(14rem,1fr)_minmax(0,3fr)]">
            <FilterSelect
              label="Project"
              value={draft.projectId}
              onChange={(value) => setDraft({ ...draft, projectId: value })}
              options={[
                { value: "all", label: "Todos los Projects" },
                ...(projects.data?.items.map((project) => ({
                  value: project.id,
                  label: project.name,
                })) ?? []),
              ]}
            />
            <FieldSet>
              <FieldLegend variant="label">Estados</FieldLegend>
              <div className="flex flex-wrap gap-2">
                {statuses.map((status) => {
                  const checked = draft.statuses.includes(status);
                  return (
                    <Field
                      orientation="horizontal"
                      key={status}
                      className="flex cursor-pointer items-center gap-2 rounded-lg border bg-background px-3 py-2 text-sm has-[[data-checked]]:border-primary/40 has-[[data-checked]]:bg-accent"
                    >
                      <Checkbox
                        id={`status-${status}`}
                        checked={checked}
                        onCheckedChange={(next) =>
                          setDraft({
                            ...draft,
                            statuses: next
                              ? [...draft.statuses, status]
                              : draft.statuses.filter((item) => item !== status),
                          })
                        }
                      />
                      <FieldLabel htmlFor={`status-${status}`}>
                        {status[0]?.toUpperCase()}
                        {status.slice(1)}
                      </FieldLabel>
                    </Field>
                  );
                })}
              </div>
            </FieldSet>
          </div>
          <details className="group rounded-lg border bg-background">
            <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg px-3 py-2 font-medium focus-visible:outline-2 focus-visible:outline-offset-2">
              <SlidersHorizontalIcon className="size-4" />
              Opciones avanzadas
            </summary>
            <div className="grid gap-3 border-t p-3 sm:grid-cols-2 xl:grid-cols-4">
              <FilterSelect
                label="Ámbito de cuenta"
                value={draft.accountScope}
                onChange={(value) => setDraft({ ...draft, accountScope: value })}
                options={[
                  { value: "all", label: "Todos los ámbitos" },
                  { value: "personal", label: "Personal" },
                  { value: "work", label: "Trabajo" },
                ]}
              />
              <FilterSelect
                label="Proveedor Git"
                value={draft.gitProvider}
                onChange={(value) => setDraft({ ...draft, gitProvider: value })}
                options={[
                  { value: "all", label: "Todos los providers" },
                  { value: "github", label: "GitHub" },
                  { value: "azure_devops", label: "Azure DevOps" },
                  { value: "gitlab", label: "GitLab" },
                  { value: "other", label: "Otro" },
                ]}
              />
              <FilterSelect
                label="Ordenar por"
                value={draft.sort}
                onChange={(value) => setDraft({ ...draft, sort: value as FilterState["sort"] })}
                options={[
                  { value: "updatedAt", label: "Actualización" },
                  { value: "createdAt", label: "Creación" },
                ]}
              />
              <FilterSelect
                label="Dirección"
                value={draft.order}
                onChange={(value) => setDraft({ ...draft, order: value as FilterState["order"] })}
                options={[
                  { value: "desc", label: "Descendente" },
                  { value: "asc", label: "Ascendente" },
                ]}
              />
              <Field orientation="horizontal" className="sm:col-span-2 xl:col-span-4">
                <Checkbox
                  id={archivedId}
                  checked={draft.archived}
                  onCheckedChange={(checked) => setDraft({ ...draft, archived: checked })}
                />
                <FieldLabel htmlFor={archivedId}>Mostrar archivadas</FieldLabel>
              </Field>
            </div>
          </details>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={clear}>
              <FilterXIcon /> Limpiar
            </Button>
            <Button onClick={apply}>Aplicar filtros</Button>
          </div>
          <ActiveFilters filters={activeFilters} onRemove={removeFilter} onClear={clear} />
        </CardContent>
      </Card>
      {query.isError ? (
        <ErrorNotice error={query.error} retry={() => void query.refetch()} />
      ) : query.data === undefined ? (
        <Loading label="Cargando Tasks" />
      ) : query.data.items.length === 0 ? (
        <Empty
          title="No hay Tasks"
          action={
            <Link
              className={buttonVariants()}
              to="/tasks/new"
              search={{ projectId: filters.projectId }}
            >
              Crear Task
            </Link>
          }
        >
          No existen Tasks para los filtros seleccionados.
        </Empty>
      ) : (
        <TaskList tasks={query.data.items} />
      )}
      {query.data?.items.length ? (
        <LoadMoreFooter
          count={query.data.items.length}
          hasMore={Boolean(query.data.nextCursor)}
          pending={more.isPending}
          error={more.error}
          onLoadMore={() => query.data?.nextCursor && more.mutate(query.data.nextCursor)}
        />
      ) : null}
    </>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
  compact = false,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly options: readonly { value: string; label: string }[];
  readonly compact?: boolean;
}) {
  const id = useId();
  return (
    <Field className={compact ? "w-44" : undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Select items={options} value={value} onValueChange={(next) => next && onChange(next)}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

function TaskList({ tasks }: { readonly tasks: readonly TaskSummary[] }) {
  return (
    <>
      <Card className="hidden lg:flex" size="sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Task</TableHead>
              <TableHead>Project</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead>Versión</TableHead>
              <TableHead>Actualizada</TableHead>
              <TableHead>
                <span className="sr-only">Abrir</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tasks.map((task) => (
              <TableRow key={task.id}>
                <TableCell className="max-w-md">
                  <Link
                    className="block truncate font-medium hover:underline"
                    to="/tasks/$taskId"
                    params={{ taskId: task.id }}
                  >
                    {task.title}
                  </Link>
                  <div className="mt-1">
                    <CopyValue label="Task ID" value={task.id} />
                  </div>
                </TableCell>
                <TableCell className="max-w-56 truncate" title={task.projectName}>
                  {task.projectName}
                </TableCell>
                <TableCell>
                  <StatusBadge status={task.status} />
                </TableCell>
                <TableCell>
                  <span className="whitespace-nowrap">v{task.version}</span>
                  {task.prUrl ? (
                    <a
                      className="ml-2 font-medium text-primary hover:underline"
                      href={task.prUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      PR
                    </a>
                  ) : null}
                </TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {formatDate(task.updatedAt)}
                </TableCell>
                <TableCell>
                  <Link
                    className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
                    to="/tasks/$taskId"
                    params={{ taskId: task.id }}
                  >
                    <ArrowRightIcon />
                    <span className="sr-only">Abrir {task.title}</span>
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
      <div className="grid gap-3 lg:hidden">
        {tasks.map((task) => (
          <article
            key={task.id}
            className="min-w-0 rounded-xl bg-card p-4 ring-1 ring-foreground/10"
          >
            <div className="flex items-start justify-between gap-3">
              <Link
                to="/tasks/$taskId"
                params={{ taskId: task.id }}
                className="min-w-0 truncate font-semibold hover:underline"
              >
                {task.title}
              </Link>
              <StatusBadge status={task.status} />
            </div>
            <div className="mt-1">
              <CopyValue label="Task ID" value={task.id} />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <span className="min-w-0 max-w-full truncate" title={task.projectName}>
                {task.projectName}
              </span>
              <span>v{task.version}</span>
              {task.prUrl ? (
                <a
                  className="font-medium text-primary hover:underline"
                  href={task.prUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  PR
                </a>
              ) : null}
              <span>{formatDate(task.updatedAt)}</span>
            </div>
          </article>
        ))}
      </div>
    </>
  );
}

interface NewTaskFields {
  projectId: string;
  title: string;
  userRequest: string;
  baseBranch: string;
}
export function NewTaskPage({ projectId }: { readonly projectId?: string | undefined }) {
  const id = useId();
  const navigate = useNavigate();
  const queue = useUploadQueue();
  const projects = useQuery({ queryKey: ["projects", "active"], queryFn: () => api.projects() });
  const projectOptions =
    projects.data?.items.map((project) => ({ value: project.id, label: project.name })) ?? [];
  const [files, setFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const {
    register,
    control,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isDirty },
  } = useForm<NewTaskFields>({
    defaultValues: { projectId: projectId ?? "", title: "", userRequest: "", baseBranch: "" },
  });
  const selectedProjectId = watch("projectId");
  const selectedProject = projects.data?.items.find((project) => project.id === selectedProjectId);
  const selectedDefaultBranch = selectedProject?.defaultBranch;
  const branches = useQuery({
    queryKey: ["project-branches", selectedProjectId],
    queryFn: () => api.projectBranches(selectedProjectId),
    enabled: selectedProject?.repositoryMode === "managed",
  });
  useEffect(() => {
    setValue("baseBranch", selectedProjectId === "" ? "" : (selectedDefaultBranch ?? ""));
  }, [selectedDefaultBranch, selectedProjectId, setValue]);
  const create = useMutation({
    mutationFn: (fields: NewTaskFields) =>
      api.createTask({
        projectId: fields.projectId,
        title: fields.title.trim() || null,
        userRequest: fields.userRequest,
        ...(selectedProject?.repositoryMode === "managed" ? { baseBranch: fields.baseBranch } : {}),
      }),
    onSuccess: async (task) => {
      if (files.length) queue.start(task.id, task.version, files);
      await navigate({ to: "/tasks/$taskId", params: { taskId: task.id } });
    },
  });
  const selectFiles = (selected: File[]) => {
    const error = validateAttachmentFiles(selected);
    setFileError(error);
    setFiles(error ? [] : selected);
  };
  const dirty = isDirty || files.length > 0;
  return (
    <>
      <PageBreadcrumb parent={{ to: "/tasks", label: "Tasks" }} current="Crear Task" />
      <Card>
        <CardHeader>
          <CardTitle>
            <PageHeader
              title="Crear Task"
              description="Podrás editar la User Request mientras la Task siga en Draft; se congelará al enviarla a Curation."
            />
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-5"
            onSubmit={handleSubmit((value) => {
              if (!fileError) create.mutate(value);
              else focusFirstInvalid();
            })}
          >
            <FieldGroup>
              <Field
                data-invalid={Boolean(
                  errors.projectId || apiFieldMessage(create.error, "projectId"),
                )}
              >
                <FieldLabel htmlFor={`${id}-project`}>Project</FieldLabel>
                <Controller
                  name="projectId"
                  control={control}
                  rules={{ required: "Selecciona un Project." }}
                  render={({ field }) => (
                    <Combobox
                      id={`${id}-project`}
                      options={projectOptions}
                      value={field.value}
                      placeholder="Seleccionar Project…"
                      searchPlaceholder="Buscar Project…"
                      invalid={Boolean(
                        errors.projectId || apiFieldMessage(create.error, "projectId"),
                      )}
                      aria-describedby={
                        errors.projectId || apiFieldMessage(create.error, "projectId")
                          ? `${id}-project-error`
                          : undefined
                      }
                      onValueChange={field.onChange}
                    />
                  )}
                />
                <FieldError id={`${id}-project-error`}>
                  {errors.projectId?.message ?? apiFieldMessage(create.error, "projectId")}
                </FieldError>
              </Field>
              {selectedProject?.repositoryMode === "managed" ? (
                <Field
                  data-invalid={Boolean(
                    errors.baseBranch || apiFieldMessage(create.error, "baseBranch"),
                  )}
                >
                  <FieldLabel htmlFor={`${id}-base-branch`}>Rama de referencia</FieldLabel>
                  <Controller
                    name="baseBranch"
                    control={control}
                    rules={{ required: "Selecciona una rama de referencia." }}
                    render={({ field }) => (
                      <Combobox
                        id={`${id}-base-branch`}
                        options={
                          branches.data?.map((branch) => ({
                            value: branch.name,
                            label: branch.name,
                            ...(branch.protected ? { description: "Protegida" } : {}),
                          })) ?? []
                        }
                        value={field.value}
                        disabled={branches.isLoading || branches.isError}
                        placeholder={branches.isLoading ? "Cargando ramas…" : "Seleccionar rama…"}
                        searchPlaceholder="Buscar rama…"
                        invalid={Boolean(
                          errors.baseBranch || apiFieldMessage(create.error, "baseBranch"),
                        )}
                        aria-describedby={[
                          `${id}-base-branch-description`,
                          errors.baseBranch || apiFieldMessage(create.error, "baseBranch")
                            ? `${id}-base-branch-error`
                            : null,
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        onValueChange={field.onChange}
                      />
                    )}
                  />
                  <FieldDescription id={`${id}-base-branch-description`}>
                    Curation, Implementation y la Pull Request usarán esta rama.
                  </FieldDescription>
                  <FieldError id={`${id}-base-branch-error`}>
                    {errors.baseBranch?.message ?? apiFieldMessage(create.error, "baseBranch")}
                  </FieldError>
                </Field>
              ) : null}
              <Field data-invalid={Boolean(apiFieldMessage(create.error, "title"))}>
                <FieldLabel htmlFor={`${id}-title`}>
                  Título <span className="font-normal text-muted-foreground">(opcional)</span>
                </FieldLabel>
                <Input
                  id={`${id}-title`}
                  maxLength={200}
                  aria-invalid={Boolean(apiFieldMessage(create.error, "title"))}
                  aria-describedby={[
                    `${id}-title-description`,
                    apiFieldMessage(create.error, "title") ? `${id}-title-error` : null,
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  {...register("title")}
                />
                <FieldDescription id={`${id}-title-description`}>
                  Si se omite, se generará desde la primera línea de la User Request.
                </FieldDescription>
                <FieldError id={`${id}-title-error`}>
                  {apiFieldMessage(create.error, "title")}
                </FieldError>
              </Field>
              <Field
                data-invalid={Boolean(
                  errors.userRequest || apiFieldMessage(create.error, "userRequest"),
                )}
              >
                <FieldLabel htmlFor={`${id}-request`}>User Request</FieldLabel>
                <Textarea
                  id={`${id}-request`}
                  className="min-h-52"
                  maxLength={100000}
                  aria-invalid={Boolean(
                    errors.userRequest || apiFieldMessage(create.error, "userRequest"),
                  )}
                  aria-describedby={
                    errors.userRequest || apiFieldMessage(create.error, "userRequest")
                      ? `${id}-request-error`
                      : undefined
                  }
                  {...register("userRequest", { required: "La petición es obligatoria." })}
                />
                <FieldError id={`${id}-request-error`}>
                  {errors.userRequest?.message ?? apiFieldMessage(create.error, "userRequest")}
                </FieldError>
              </Field>
              <Field data-invalid={Boolean(fileError)}>
                <FieldLabel htmlFor={`${id}-files`}>
                  Attachments{" "}
                  <span className="font-normal text-muted-foreground">(opcionales)</span>
                </FieldLabel>
                <Input
                  id={`${id}-files`}
                  type="file"
                  multiple
                  accept={attachmentAccept}
                  aria-invalid={Boolean(fileError)}
                  aria-describedby={[
                    `${id}-files-description`,
                    fileError ? `${id}-files-error` : null,
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onChange={(event) => selectFiles(Array.from(event.target.files ?? []))}
                />
                <FieldDescription id={`${id}-files-description`}>
                  Hasta 10 ficheros de 25 MiB. Se subirán secuencialmente en el detalle de la Task.
                </FieldDescription>
                <FieldError id={`${id}-files-error`}>{fileError}</FieldError>
                {files.length ? (
                  <ul className="grid gap-2" aria-label="Attachments preparados">
                    {files.map((file, index) => (
                      <li
                        key={`${file.name}-${file.size}-${index}`}
                        className="flex min-w-0 items-center gap-3 rounded-md border p-2 text-sm"
                      >
                        <FileUpIcon className="size-4 shrink-0" />
                        <span className="min-w-0 flex-1 truncate">
                          {file.name} · {formatFileSize(file.size)}
                        </span>
                        <span className="text-xs text-muted-foreground">Pendiente</span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Retirar ${file.name}`}
                          onClick={() =>
                            setFiles((current) =>
                              current.filter((_, fileIndex) => fileIndex !== index),
                            )
                          }
                        >
                          <XIcon />
                        </Button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </Field>
            </FieldGroup>
            {projects.isError ? (
              <ErrorNotice error={projects.error} retry={() => void projects.refetch()} />
            ) : null}
            {branches.isError ? (
              <ErrorNotice error={branches.error} retry={() => void branches.refetch()} />
            ) : null}
            {create.isError ? <ErrorNotice error={create.error} /> : null}
            <Button
              className="justify-self-start"
              disabled={
                create.isPending ||
                projects.isLoading ||
                (selectedProject?.repositoryMode === "managed" &&
                  (branches.isLoading || branches.isError))
              }
              type="submit"
            >
              {create.isPending ? "Creando…" : "Crear Task"}
            </Button>
          </form>
        </CardContent>
      </Card>
      <UnsavedChangesBadge dirty={dirty} />
      <UnsavedChangesGuard dirty={dirty && !create.isPending && !create.isSuccess} />
    </>
  );
}

export const validateFiles = validateAttachmentFiles;
export { allowedAttachmentExtensions };

function defaultFilterState(): FilterState {
  return {
    projectId: "all",
    statuses: [],
    accountScope: "all",
    gitProvider: "all",
    archived: false,
    sort: "updatedAt",
    order: "desc",
  };
}

function filterStateFromTaskFilters(filters: TaskFilters): FilterState {
  return {
    ...defaultFilterState(),
    projectId: filters.projectId ?? "all",
    statuses: [...(filters.status ?? [])],
    accountScope: filters.accountScope ?? "all",
    gitProvider: filters.gitProvider ?? "all",
    archived: filters.archived ?? false,
    sort: filters.sort ?? "updatedAt",
    order: filters.order ?? "desc",
  };
}

function providerLabel(value: string): string {
  return (
    {
      github: "GitHub",
      azure_devops: "Azure DevOps",
      gitlab: "GitLab",
      other: "Otro",
    }[value] ?? value
  );
}
