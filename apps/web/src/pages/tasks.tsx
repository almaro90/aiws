import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowRightIcon, FileUpIcon, FilterXIcon, PlusIcon } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import {
  Empty,
  ErrorNotice,
  formatDate,
  Loading,
  PageHeader,
  StatusBadge,
  buttonVariants,
} from "../components/common.tsx";
import { Button } from "../components/ui/button.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card.tsx";
import { Checkbox } from "../components/ui/checkbox.tsx";
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
import { serializeTaskFilters, type TaskFilters } from "../lib/query.ts";
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
  const filters = searchToFilters(search);
  const [draft, setDraft] = useState<FilterState>({
    projectId: filters.projectId ?? "all",
    statuses: [...(filters.status ?? [])],
    accountScope: filters.accountScope ?? "all",
    gitProvider: filters.gitProvider ?? "all",
    archived: filters.archived ?? false,
    sort: filters.sort ?? "updatedAt",
    order: filters.order ?? "desc",
  });
  const suffix = serializeTaskFilters(filters);
  const query = useQuery({ queryKey: ["tasks", suffix], queryFn: () => api.tasks(suffix) });
  const queryClient = useQueryClient();
  const more = useMutation({
    mutationFn: (cursor: string) =>
      api.tasks(`${suffix}${suffix ? "&" : "?"}cursor=${encodeURIComponent(cursor)}`),
    onSuccess: (page) =>
      query.data &&
      queryClient.setQueryData(["tasks", suffix], {
        items: [...query.data.items, ...page.items],
        nextCursor: page.nextCursor,
      }),
  });
  const projects = useQuery({ queryKey: ["projects", "active"], queryFn: () => api.projects() });

  const apply = () =>
    void navigate({
      to: "/tasks",
      search: {
        projectId: draft.projectId === "all" ? undefined : draft.projectId,
        status: draft.statuses.length ? draft.statuses : undefined,
        accountScope: draft.accountScope === "all" ? undefined : draft.accountScope,
        gitProvider: draft.gitProvider === "all" ? undefined : draft.gitProvider,
        archived: draft.archived || undefined,
        sort: draft.sort === "updatedAt" ? undefined : draft.sort,
        order: draft.order === "desc" ? undefined : draft.order,
      },
    });
  const clear = () => {
    setDraft({
      projectId: "all",
      statuses: [],
      accountScope: "all",
      gitProvider: "all",
      archived: false,
      sort: "updatedAt",
      order: "desc",
    });
    void navigate({ to: "/tasks", search: {} });
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
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
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
            <FilterSelect
              label="Account scope"
              value={draft.accountScope}
              onChange={(value) => setDraft({ ...draft, accountScope: value })}
              options={[
                { value: "all", label: "Todos los ámbitos" },
                { value: "personal", label: "Personal" },
                { value: "work", label: "Work" },
              ]}
            />
            <FilterSelect
              label="Git provider"
              value={draft.gitProvider}
              onChange={(value) => setDraft({ ...draft, gitProvider: value })}
              options={[
                { value: "all", label: "Todos los providers" },
                { value: "github", label: "GitHub" },
                { value: "azure_devops", label: "Azure DevOps" },
                { value: "gitlab", label: "GitLab" },
                { value: "other", label: "Other" },
              ]}
            />
            <Field orientation="horizontal" className="self-end pb-1">
              <Checkbox
                id={archivedId}
                checked={draft.archived}
                onCheckedChange={(checked) => setDraft({ ...draft, archived: checked })}
              />
              <FieldLabel htmlFor={archivedId}>Mostrar archivadas</FieldLabel>
            </Field>
          </div>
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
                    <FieldLabel htmlFor={`status-${status}`}>{status}</FieldLabel>
                  </Field>
                );
              })}
            </div>
          </FieldSet>
          <div className="flex flex-wrap items-end gap-3">
            <FilterSelect
              label="Ordenar por"
              value={draft.sort}
              onChange={(value) => setDraft({ ...draft, sort: value as FilterState["sort"] })}
              options={[
                { value: "updatedAt", label: "Actualización" },
                { value: "createdAt", label: "Creación" },
              ]}
              compact
            />
            <FilterSelect
              label="Dirección"
              value={draft.order}
              onChange={(value) => setDraft({ ...draft, order: value as FilterState["order"] })}
              options={[
                { value: "desc", label: "Descendente" },
                { value: "asc", label: "Ascendente" },
              ]}
              compact
            />
            <div className="ml-auto flex gap-2">
              <Button variant="outline" onClick={clear}>
                <FilterXIcon /> Limpiar
              </Button>
              <Button onClick={apply}>Aplicar filtros</Button>
            </div>
          </div>
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
      {query.data?.nextCursor ? (
        <Button
          className="justify-self-center"
          variant="outline"
          disabled={more.isPending}
          onClick={() => more.mutate(query.data.nextCursor as string)}
        >
          {more.isPending ? "Cargando…" : "Cargar más"}
        </Button>
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
                <TableCell>
                  <Link
                    className="font-medium hover:underline"
                    to="/tasks/$taskId"
                    params={{ taskId: task.id }}
                  >
                    {task.title}
                  </Link>
                  <p className="mt-1 font-mono text-xs text-muted-foreground">{task.id}</p>
                </TableCell>
                <TableCell>{task.projectName}</TableCell>
                <TableCell>
                  <StatusBadge status={task.status} />
                </TableCell>
                <TableCell>
                  v{task.version}
                  {task.prUrl ? " · PR" : ""}
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
          <Link
            key={task.id}
            to="/tasks/$taskId"
            params={{ taskId: task.id }}
            className="rounded-xl bg-card p-4 ring-1 ring-foreground/10 hover:ring-primary/40"
          >
            <div className="flex items-start justify-between gap-3">
              <strong className="min-w-0 truncate">{task.title}</strong>
              <StatusBadge status={task.status} />
            </div>
            <p className="mt-1 font-mono text-xs text-muted-foreground">{task.id}</p>
            <p className="mt-3 text-xs text-muted-foreground">
              {task.projectName} · v{task.version}
              {task.prUrl ? " · PR" : ""} · {formatDate(task.updatedAt)}
            </p>
          </Link>
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
const allowedExtensions = new Set([
  "png",
  "jpg",
  "jpeg",
  "webp",
  "gif",
  "pdf",
  "txt",
  "log",
  "md",
  "markdown",
  "json",
  "jsonl",
  "csv",
  "tsv",
  "xml",
  "yaml",
  "yml",
]);

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
    formState: { errors },
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
    const error = validateFiles(selected);
    setFileError(error);
    setFiles(error ? [] : selected);
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <PageHeader
            title="Crear Task"
            description="La User Request quedará inmutable después de crear la Task."
          />
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-5"
          onSubmit={handleSubmit((value) => {
            if (!fileError) create.mutate(value);
          })}
        >
          <FieldGroup>
            <Field
              data-invalid={Boolean(errors.projectId || apiFieldMessage(create.error, "projectId"))}
            >
              <FieldLabel htmlFor={`${id}-project`}>Project</FieldLabel>
              <Controller
                name="projectId"
                control={control}
                rules={{ required: "Selecciona un Project." }}
                render={({ field }) => (
                  <Select
                    items={projectOptions}
                    value={field.value || null}
                    onValueChange={(value) => field.onChange(value ?? "")}
                  >
                    <SelectTrigger
                      id={`${id}-project`}
                      className="w-full"
                      aria-invalid={Boolean(
                        errors.projectId || apiFieldMessage(create.error, "projectId"),
                      )}
                    >
                      <SelectValue placeholder="Seleccionar…" />
                    </SelectTrigger>
                    <SelectContent>
                      {projectOptions.map((option) => (
                        <SelectItem value={option.value} key={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              <FieldError>
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
                    <Select
                      items={
                        branches.data?.map((branch) => ({
                          value: branch.name,
                          label: branch.name,
                        })) ?? []
                      }
                      value={field.value || null}
                      disabled={branches.isLoading || branches.isError}
                      onValueChange={(value) => field.onChange(value ?? "")}
                    >
                      <SelectTrigger id={`${id}-base-branch`} className="w-full">
                        <SelectValue
                          placeholder={branches.isLoading ? "Cargando ramas…" : "Seleccionar…"}
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {branches.data?.map((branch) => (
                          <SelectItem key={branch.name} value={branch.name}>
                            {branch.name}
                            {branch.protected ? " · protegida" : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
                <FieldDescription>
                  Curation, Implementation y la Pull Request usarán esta rama.
                </FieldDescription>
                <FieldError>
                  {errors.baseBranch?.message ?? apiFieldMessage(create.error, "baseBranch")}
                </FieldError>
              </Field>
            ) : null}
            <Field data-invalid={Boolean(apiFieldMessage(create.error, "title"))}>
              <FieldLabel htmlFor={`${id}-title`}>
                Title <span className="font-normal text-muted-foreground">(opcional)</span>
              </FieldLabel>
              <Input
                id={`${id}-title`}
                maxLength={200}
                aria-invalid={Boolean(apiFieldMessage(create.error, "title"))}
                {...register("title")}
              />
              <FieldDescription>
                Si se omite, se generará desde la primera línea de la User Request.
              </FieldDescription>
              <FieldError>{apiFieldMessage(create.error, "title")}</FieldError>
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
                {...register("userRequest", { required: "La petición es obligatoria." })}
              />
              <FieldError>
                {errors.userRequest?.message ?? apiFieldMessage(create.error, "userRequest")}
              </FieldError>
            </Field>
            <Field data-invalid={Boolean(fileError)}>
              <FieldLabel htmlFor={`${id}-files`}>
                Attachments <span className="font-normal text-muted-foreground">(opcionales)</span>
              </FieldLabel>
              <Input
                id={`${id}-files`}
                type="file"
                multiple
                accept={Array.from(allowedExtensions)
                  .map((extension) => `.${extension}`)
                  .join(",")}
                onChange={(event) => selectFiles(Array.from(event.target.files ?? []))}
              />
              <FieldDescription>
                Hasta 10 ficheros de 25 MiB. Se subirán secuencialmente en el detalle de la Task.
              </FieldDescription>
              <FieldError>{fileError}</FieldError>
              {files.length ? (
                <p className="text-sm text-muted-foreground">
                  <FileUpIcon className="mr-1 inline size-4" />
                  {files.length} fichero(s) preparados
                </p>
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
  );
}

export function validateFiles(files: readonly File[]): string | null {
  if (files.length > 10) return "Solo pueden añadirse 10 attachments por Task.";
  for (const file of files) {
    if (file.size === 0) return `${file.name}: el fichero está vacío.`;
    if (file.size > 26_214_400) return `${file.name}: supera 25 MiB.`;
    const extension = file.name.split(".").at(-1)?.toLowerCase() ?? "";
    if (!allowedExtensions.has(extension)) return `${file.name}: extensión no permitida.`;
  }
  return null;
}

function searchToFilters(search: Record<string, unknown>): TaskFilters {
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
    ...(typeof search.cursor === "string" ? { cursor: search.cursor } : {}),
  };
}
