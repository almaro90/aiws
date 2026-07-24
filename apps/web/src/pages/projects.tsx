import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { ArchiveIcon, ArrowRightIcon, PlusIcon, RotateCcwIcon } from "lucide-react";
import { useId, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import {
  ConfirmAction,
  Empty,
  ErrorNotice,
  formatDate,
  Loading,
  PageHeader,
  buttonVariants,
} from "../components/common.tsx";
import { Badge } from "../components/ui/badge.tsx";
import { Button } from "../components/ui/button.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card.tsx";
import { Checkbox } from "../components/ui/checkbox.tsx";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
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
import { cn } from "../lib/utils.ts";
import type { Project } from "../lib/types.ts";

interface ProjectFields {
  name: string;
  description: string;
  repositoryPath: string;
  gitProvider: "github" | "azure_devops" | "gitlab" | "other";
  accountScope: "personal" | "work";
}

const providerOptions = [
  { value: "github", label: "GitHub" },
  { value: "azure_devops", label: "Azure DevOps" },
  { value: "gitlab", label: "GitLab" },
  { value: "other", label: "Other" },
];
const providerFilterOptions = [{ value: "all", label: "Todos los providers" }, ...providerOptions];
const accountScopeOptions = [
  { value: "personal", label: "Personal" },
  { value: "work", label: "Work" },
];
const accountScopeFilterOptions = [
  { value: "all", label: "Todos los ámbitos" },
  ...accountScopeOptions,
];

export function ProjectsPage({ search }: { readonly search: Record<string, unknown> }) {
  const archivedId = useId();
  const providerId = useId();
  const scopeId = useId();
  const navigate = useNavigate();
  const archived = search.archived === true || search.archived === "true";
  const initialProvider =
    typeof search.gitProvider === "string" && search.gitProvider ? search.gitProvider : "all";
  const initialScope =
    typeof search.accountScope === "string" && search.accountScope ? search.accountScope : "all";
  const [gitProvider, setGitProvider] = useState(initialProvider);
  const [accountScope, setAccountScope] = useState(initialScope);
  const [showArchived, setShowArchived] = useState(archived);
  const params = new URLSearchParams();
  if (archived) params.set("archived", "true");
  if (initialProvider !== "all") params.set("gitProvider", initialProvider);
  if (initialScope !== "all") params.set("accountScope", initialScope);
  const suffix = params.size ? `?${params}` : "";
  const query = useQuery({ queryKey: ["projects", suffix], queryFn: () => api.projects(suffix) });
  const queryClient = useQueryClient();
  const more = useMutation({
    mutationFn: (cursor: string) =>
      api.projects(`${suffix}${suffix ? "&" : "?"}cursor=${encodeURIComponent(cursor)}`),
    onSuccess: (page) =>
      query.data &&
      queryClient.setQueryData(["projects", suffix], {
        items: [...query.data.items, ...page.items],
        nextCursor: page.nextCursor,
      }),
  });

  const applyFilters = () =>
    void navigate({
      to: "/projects",
      search: {
        gitProvider: gitProvider === "all" ? undefined : gitProvider,
        accountScope: accountScope === "all" ? undefined : accountScope,
        archived: showArchived || undefined,
      },
    });

  return (
    <>
      <PageHeader
        title="Projects"
        description="Repositorios locales disponibles para crear y ejecutar Tasks."
        actions={
          <Link className={buttonVariants()} to="/projects/new">
            <PlusIcon /> Crear Project
          </Link>
        }
      />
      <Card size="sm">
        <CardContent className="grid gap-3 md:grid-cols-[1fr_1fr_auto_auto] md:items-end">
          <Field>
            <FieldLabel htmlFor={providerId}>Git provider</FieldLabel>
            <Select
              items={providerFilterOptions}
              value={gitProvider}
              onValueChange={(value) => setGitProvider(value ?? "all")}
            >
              <SelectTrigger id={providerId} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {providerFilterOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor={scopeId}>Account scope</FieldLabel>
            <Select
              items={accountScopeFilterOptions}
              value={accountScope}
              onValueChange={(value) => setAccountScope(value ?? "all")}
            >
              <SelectTrigger id={scopeId} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {accountScopeFilterOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field orientation="horizontal" className="min-h-8">
            <Checkbox id={archivedId} checked={showArchived} onCheckedChange={setShowArchived} />
            <FieldLabel htmlFor={archivedId}>Mostrar archivados</FieldLabel>
          </Field>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setGitProvider("all");
                setAccountScope("all");
                setShowArchived(false);
                void navigate({ to: "/projects", search: {} });
              }}
            >
              Limpiar
            </Button>
            <Button onClick={applyFilters}>Aplicar</Button>
          </div>
        </CardContent>
      </Card>

      {query.isError ? (
        <ErrorNotice error={query.error} retry={() => void query.refetch()} />
      ) : query.data === undefined ? (
        <Loading label="Cargando Projects" />
      ) : query.data.items.length === 0 ? (
        <Empty
          title="No hay Projects"
          action={
            <Link className={buttonVariants()} to="/projects/new">
              Crear el primero
            </Link>
          }
        >
          No existen Projects para los filtros seleccionados.
        </Empty>
      ) : (
        <ProjectList projects={query.data.items} />
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

function ProjectAutomation({ project }: { readonly project: Project }) {
  const client = useQueryClient();
  const profiles = useQuery({ queryKey: ["agent-profiles"], queryFn: api.agentProfiles });
  const branches = useQuery({
    queryKey: ["project-branches", project.id],
    queryFn: () => api.projectBranches(project.id),
    enabled: project.repositoryMode === "managed",
  });
  const [defaultBranch, setDefaultBranch] = useState(project.defaultBranch ?? "");
  const [curationAgentProfileId, setCurationAgentProfileId] = useState(
    project.curationAgentProfileId ?? "none",
  );
  const [implementationAgentProfileId, setImplementationAgentProfileId] = useState(
    project.implementationAgentProfileId ?? "none",
  );
  const [scheduleCron, setScheduleCron] = useState(project.scheduleCron ?? "");
  const [scheduleTimezone, setScheduleTimezone] = useState(project.scheduleTimezone);
  const [maxConcurrency, setMaxConcurrency] = useState(String(project.maxConcurrency));
  const profileOptions = [
    { value: "none", label: "Sin perfil" },
    ...(profiles.data
      ?.filter((profile) => profile.enabled)
      .map((profile) => ({ value: profile.id, label: profile.name })) ?? []),
  ];
  const save = useMutation({
    mutationFn: (automationEnabled: boolean) =>
      api.updateProject(project.id, {
        automationEnabled,
        ...(project.repositoryMode === "managed" ? { defaultBranch } : {}),
        curationAgentProfileId: curationAgentProfileId === "none" ? null : curationAgentProfileId,
        implementationAgentProfileId:
          implementationAgentProfileId === "none" ? null : implementationAgentProfileId,
        scheduleCron: scheduleCron || null,
        scheduleTimezone,
        maxConcurrency: Number(maxConcurrency),
      }),
    onSuccess: (value) => {
      client.setQueryData(["project", project.id], value);
      toast.success(
        value.automationEnabled ? "Automatización activada" : "Automatización guardada",
      );
    },
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Automatización de implementación</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        <p className="text-sm text-muted-foreground">
          Curation e Implementation pueden usar perfiles distintos. El horario solo se aplica a
          Implementation; el límite de concurrencia se comparte entre ambos tipos de Run.
        </p>
        {project.repositoryMode === "managed" ? (
          <Field data-invalid={Boolean(apiFieldMessage(save.error, "defaultBranch"))}>
            <FieldLabel>Rama de referencia por defecto</FieldLabel>
            <Select
              items={
                branches.data?.map((branch) => ({
                  value: branch.name,
                  label: branch.name,
                })) ?? []
              }
              value={defaultBranch || null}
              disabled={branches.isLoading || branches.isError}
              onValueChange={(value) => setDefaultBranch(value ?? "")}
            >
              <SelectTrigger className="w-full">
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
            <FieldDescription>
              Se copiará en las nuevas Tasks. Cambiarla no modifica Tasks ya creadas.
            </FieldDescription>
            <FieldError>{apiFieldMessage(save.error, "defaultBranch")}</FieldError>
          </Field>
        ) : null}
        {branches.isError ? (
          <ErrorNotice error={branches.error} retry={() => void branches.refetch()} />
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field data-invalid={Boolean(apiFieldMessage(save.error, "curationAgentProfileId"))}>
            <FieldLabel>Perfil de Curation</FieldLabel>
            <Select
              items={profileOptions}
              value={curationAgentProfileId}
              onValueChange={(value) => setCurationAgentProfileId(value ?? "none")}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {profileOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldError>{apiFieldMessage(save.error, "curationAgentProfileId")}</FieldError>
          </Field>
          <Field
            data-invalid={Boolean(apiFieldMessage(save.error, "implementationAgentProfileId"))}
          >
            <FieldLabel>Perfil de Implementation</FieldLabel>
            <Select
              items={profileOptions}
              value={implementationAgentProfileId}
              onValueChange={(value) => setImplementationAgentProfileId(value ?? "none")}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {profileOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldError>{apiFieldMessage(save.error, "implementationAgentProfileId")}</FieldError>
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field>
            <FieldLabel>Cron (opcional)</FieldLabel>
            <Input
              className="font-mono"
              placeholder="*/15 * * * *"
              value={scheduleCron}
              onChange={(event) => setScheduleCron(event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel>Timezone</FieldLabel>
            <Input
              value={scheduleTimezone}
              onChange={(event) => setScheduleTimezone(event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel>Concurrencia</FieldLabel>
            <Input
              type="number"
              min="1"
              max="16"
              value={maxConcurrency}
              onChange={(event) => setMaxConcurrency(event.target.value)}
            />
          </Field>
        </div>
        {save.isError ? <ErrorNotice error={save.error} /> : null}
        <div className="flex gap-2">
          <Button
            disabled={
              save.isPending ||
              (project.repositoryMode === "managed" &&
                (branches.isLoading || branches.isError || !defaultBranch))
            }
            onClick={() => save.mutate(project.automationEnabled)}
          >
            Guardar configuración
          </Button>
          {!project.automationEnabled ? (
            <Button
              variant="outline"
              disabled={
                save.isPending ||
                implementationAgentProfileId === "none" ||
                (project.repositoryMode === "managed" &&
                  (branches.isLoading || branches.isError || !defaultBranch))
              }
              onClick={() => save.mutate(true)}
            >
              Activar Implementation
            </Button>
          ) : (
            <Button variant="outline" disabled={save.isPending} onClick={() => save.mutate(false)}>
              Desactivar Implementation
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function ProjectList({ projects }: { readonly projects: readonly Project[] }) {
  return (
    <>
      <Card className="hidden md:flex" size="sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Project</TableHead>
              <TableHead>Repository path</TableHead>
              <TableHead>Provider</TableHead>
              <TableHead>Scope</TableHead>
              <TableHead>Actualizado</TableHead>
              <TableHead>
                <span className="sr-only">Abrir</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {projects.map((project) => (
              <TableRow key={project.id}>
                <TableCell>
                  <Link
                    className="font-medium hover:underline"
                    to="/projects/$projectId"
                    params={{ projectId: project.id }}
                  >
                    {project.name}
                  </Link>
                  {project.archivedAt ? (
                    <Badge className="ml-2" variant="outline">
                      Archivado
                    </Badge>
                  ) : null}
                </TableCell>
                <TableCell
                  className="max-w-72 truncate font-mono text-xs"
                  title={project.repositoryPath}
                >
                  {project.repositoryPath}
                </TableCell>
                <TableCell>{project.gitProvider}</TableCell>
                <TableCell>{project.accountScope}</TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {formatDate(project.updatedAt)}
                </TableCell>
                <TableCell>
                  <Link
                    className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
                    to="/projects/$projectId"
                    params={{ projectId: project.id }}
                  >
                    <ArrowRightIcon />
                    <span className="sr-only">Abrir {project.name}</span>
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
      <div className="grid gap-3 md:hidden">
        {projects.map((project) => (
          <Link
            key={project.id}
            to="/projects/$projectId"
            params={{ projectId: project.id }}
            className="rounded-xl bg-card p-4 ring-1 ring-foreground/10 transition hover:ring-primary/40"
          >
            <div className="flex items-start justify-between gap-3">
              <strong>{project.name}</strong>
              {project.archivedAt ? <Badge variant="outline">Archivado</Badge> : null}
            </div>
            <p className="mt-2 break-all font-mono text-xs text-muted-foreground">
              {project.repositoryPath}
            </p>
            <p className="mt-3 text-xs text-muted-foreground">
              {project.gitProvider} · {project.accountScope} · {formatDate(project.updatedAt)}
            </p>
          </Link>
        ))}
      </div>
    </>
  );
}

export function ProjectFormPage() {
  const navigate = useNavigate();
  const create = useMutation({
    mutationFn: api.createProject,
    onSuccess: async (project) => {
      toast.success("Project creado");
      await navigate({ to: "/projects/$projectId", params: { projectId: project.id } });
    },
  });
  return (
    <ProjectForm
      title="Crear Project"
      description="Registra un repositorio Git bajo uno de los roots permitidos."
      submitLabel="Crear Project"
      pending={create.isPending}
      error={create.error}
      onSubmit={(value) => create.mutate(value)}
    />
  );
}

export function ProjectDetailPage({ projectId }: { readonly projectId: string }) {
  const tasksTitleId = useId();
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => api.project(projectId),
  });
  const tasks = useQuery({
    queryKey: ["tasks", projectId],
    queryFn: () => api.tasks(`?projectId=${encodeURIComponent(projectId)}`),
  });
  const save = useMutation({
    mutationFn: (value: ProjectFields) =>
      api.updateProject(
        projectId,
        query.data?.repositoryMode === "managed"
          ? { name: value.name, description: value.description }
          : value,
      ),
    onSuccess: (value) => {
      client.setQueryData(["project", projectId], value);
      toast.success("Project guardado");
    },
  });
  const archive = useMutation({
    mutationFn: () =>
      query.data?.archivedAt ? api.unarchiveProject(projectId) : api.archiveProject(projectId),
    onSuccess: (value) => {
      client.setQueryData(["project", projectId], value);
      toast.success(value.archivedAt ? "Project archivado" : "Project restaurado");
    },
  });
  if (query.isError) return <ErrorNotice error={query.error} retry={() => void query.refetch()} />;
  if (query.data === undefined) return <Loading label="Cargando Project" />;
  const project = query.data;
  return (
    <>
      <ProjectForm
        title={project.name}
        description={
          project.archivedAt
            ? "Project archivado: solo puede restaurarse."
            : "Edita los datos del repositorio."
        }
        submitLabel="Guardar cambios"
        project={project}
        pending={save.isPending}
        error={save.error}
        disabled={project.archivedAt !== null}
        onSubmit={(value) => save.mutate(value)}
      />
      <Card size="sm">
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <strong>{project.archivedAt ? "Project archivado" : "Project activo"}</strong>
            <p className="text-sm text-muted-foreground">
              {project.archivedAt
                ? "Restaura el Project para volver a editarlo."
                : "Solo puede archivarse cuando no tiene Tasks activas."}
            </p>
          </div>
          {project.archivedAt ? (
            <Button disabled={archive.isPending} onClick={() => archive.mutate()}>
              <RotateCcwIcon /> Restaurar
            </Button>
          ) : (
            <ConfirmAction
              trigger={
                <Button variant="destructive">
                  <ArchiveIcon /> Archivar
                </Button>
              }
              title="Archivar Project"
              description="El Project dejará de aparecer en los listados activos. Debes archivar antes todas sus Tasks."
              confirmLabel="Archivar"
              destructive
              disabled={archive.isPending}
              onConfirm={() => archive.mutate()}
            />
          )}
        </CardContent>
      </Card>
      <ProjectAutomation project={project} />
      {archive.isError ? (
        <>
          <ErrorNotice error={archive.error} />
          <Link
            className={cn(buttonVariants({ variant: "outline" }), "justify-self-start")}
            to="/tasks"
            search={{ projectId }}
          >
            Ver Tasks activas
          </Link>
        </>
      ) : null}
      <section className="grid gap-3" aria-labelledby={tasksTitleId}>
        <div className="flex items-center justify-between">
          <h2 id={tasksTitleId} className="text-xl font-semibold">
            Tasks del Project
          </h2>
          {!project.archivedAt ? (
            <Link
              className={buttonVariants({ variant: "outline" })}
              to="/tasks/new"
              search={{ projectId }}
            >
              <PlusIcon /> Crear Task
            </Link>
          ) : null}
        </div>
        {tasks.isError ? (
          <ErrorNotice error={tasks.error} retry={() => void tasks.refetch()} />
        ) : tasks.data === undefined ? (
          <Loading />
        ) : tasks.data.items.length ? (
          <div className="grid gap-2">
            {tasks.data.items.map((task) => (
              <Link
                className="flex items-center justify-between gap-3 rounded-lg bg-card p-3 ring-1 ring-foreground/10 hover:ring-primary/40"
                key={task.id}
                to="/tasks/$taskId"
                params={{ taskId: task.id }}
              >
                <span className="min-w-0 truncate font-medium">{task.title}</span>
                <Badge variant="outline">{task.status}</Badge>
              </Link>
            ))}
          </div>
        ) : (
          <Empty title="Sin Tasks">Este Project todavía no tiene Tasks activas.</Empty>
        )}
      </section>
    </>
  );
}

function ProjectForm({
  title,
  description,
  submitLabel,
  project,
  pending,
  error,
  disabled = false,
  onSubmit,
}: {
  readonly title: string;
  readonly description: string;
  readonly submitLabel: string;
  readonly project?: Project;
  readonly pending: boolean;
  readonly error: unknown;
  readonly disabled?: boolean;
  readonly onSubmit: (value: ProjectFields) => void;
}) {
  const id = useId();
  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isDirty },
  } = useForm<ProjectFields>({
    defaultValues: project ?? {
      name: "",
      description: "",
      repositoryPath: "",
      gitProvider: "github",
      accountScope: "personal",
    },
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <PageHeader title={title} description={description} />
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form className="grid gap-5" onSubmit={handleSubmit(onSubmit)}>
          <FieldGroup>
            <Field data-invalid={Boolean(errors.name || apiFieldMessage(error, "name"))}>
              <FieldLabel htmlFor={`${id}-name`}>Name</FieldLabel>
              <Input
                id={`${id}-name`}
                disabled={disabled}
                aria-invalid={Boolean(errors.name || apiFieldMessage(error, "name"))}
                {...register("name", {
                  required: "Name es obligatorio.",
                  maxLength: { value: 120, message: "Máximo 120 caracteres." },
                })}
              />
              <FieldError>{errors.name?.message ?? apiFieldMessage(error, "name")}</FieldError>
            </Field>
            <Field
              data-invalid={Boolean(errors.description || apiFieldMessage(error, "description"))}
            >
              <FieldLabel htmlFor={`${id}-description`}>Description</FieldLabel>
              <Textarea
                id={`${id}-description`}
                disabled={disabled}
                className="min-h-24"
                aria-invalid={Boolean(errors.description || apiFieldMessage(error, "description"))}
                {...register("description", {
                  maxLength: { value: 10000, message: "Máximo 10 000 caracteres." },
                })}
              />
              <FieldError>
                {errors.description?.message ?? apiFieldMessage(error, "description")}
              </FieldError>
            </Field>
            <Field
              data-invalid={Boolean(
                errors.repositoryPath || apiFieldMessage(error, "repositoryPath"),
              )}
            >
              <FieldLabel htmlFor={`${id}-repository`}>Repository path</FieldLabel>
              <Input
                id={`${id}-repository`}
                disabled={disabled || project?.repositoryMode === "managed"}
                className="font-mono"
                aria-invalid={Boolean(
                  errors.repositoryPath || apiFieldMessage(error, "repositoryPath"),
                )}
                {...register("repositoryPath", { required: "La ruta es obligatoria." })}
              />
              <FieldDescription>
                Ruta absoluta canonicalizada dentro de un root permitido.
              </FieldDescription>
              <FieldError>
                {errors.repositoryPath?.message ?? apiFieldMessage(error, "repositoryPath")}
              </FieldError>
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor={`${id}-provider`}>Git provider</FieldLabel>
                <Controller
                  name="gitProvider"
                  control={control}
                  render={({ field }) => (
                    <Select
                      items={providerOptions}
                      value={field.value}
                      onValueChange={(value) => value && field.onChange(value)}
                      disabled={disabled || project?.repositoryMode === "managed"}
                    >
                      <SelectTrigger id={`${id}-provider`} className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {providerOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={`${id}-scope`}>Account scope</FieldLabel>
                <Controller
                  name="accountScope"
                  control={control}
                  render={({ field }) => (
                    <Select
                      items={accountScopeOptions}
                      value={field.value}
                      onValueChange={(value) => value && field.onChange(value)}
                      disabled={disabled || project?.repositoryMode === "managed"}
                    >
                      <SelectTrigger id={`${id}-scope`} className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {accountScopeOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </Field>
            </div>
          </FieldGroup>
          {error ? <ErrorNotice error={error} /> : null}
          {!disabled ? (
            <Button
              className="justify-self-start"
              disabled={pending || (project !== undefined && !isDirty)}
              type="submit"
            >
              {pending ? "Guardando…" : submitLabel}
            </Button>
          ) : null}
        </form>
      </CardContent>
    </Card>
  );
}
