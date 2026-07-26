import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  ArchiveIcon,
  ArrowRightIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CircleXIcon,
  PlusIcon,
  RotateCcwIcon,
  StethoscopeIcon,
} from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import {
  ActiveFilters,
  ConfirmAction,
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
import { Badge } from "../components/ui/badge.tsx";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert.tsx";
import { Button } from "../components/ui/button.tsx";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "../components/ui/card.tsx";
import { Checkbox } from "../components/ui/checkbox.tsx";
import { Combobox } from "../components/ui/combobox.tsx";
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
import { Switch } from "../components/ui/switch.tsx";
import { api, apiFieldMessage } from "../lib/api.ts";
import { focusFirstInvalid, UnsavedChangesBadge, UnsavedChangesGuard } from "../lib/form-state.tsx";
import { mergePageItems, parseProjectFilters, serializeProjectFilters } from "../lib/query.ts";
import { cn } from "../lib/utils.ts";
import type { Project, ProjectReadinessReport, VerificationCommand } from "../lib/types.ts";

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
  { value: "other", label: "Otro" },
];
const providerFilterOptions = [{ value: "all", label: "Todos los providers" }, ...providerOptions];
const accountScopeOptions = [
  { value: "personal", label: "Personal" },
  { value: "work", label: "Trabajo" },
];
const accountScopeFilterOptions = [
  { value: "all", label: "Todos los ámbitos" },
  ...accountScopeOptions,
];

interface ProjectFilterState {
  gitProvider: string;
  accountScope: string;
  archived: boolean;
}

export function ProjectsPage({ search }: { readonly search: Record<string, unknown> }) {
  const archivedId = useId();
  const providerId = useId();
  const scopeId = useId();
  const navigate = useNavigate();
  const filters = useMemo(() => parseProjectFilters(search), [search]);
  const applied = projectFilterState(filters);
  const [draft, setDraft] = useState<ProjectFilterState>(() => applied);
  const suffix = serializeProjectFilters(filters);
  useEffect(() => setDraft(projectFilterState(filters)), [filters]);
  const query = useQuery({ queryKey: ["projects", suffix], queryFn: () => api.projects(suffix) });
  const queryClient = useQueryClient();
  const more = useMutation({
    mutationFn: (cursor: string) =>
      api.projects(`${suffix}${suffix ? "&" : "?"}cursor=${encodeURIComponent(cursor)}`),
    onSuccess: (page) =>
      query.data &&
      queryClient.setQueryData(["projects", suffix], {
        items: mergePageItems(query.data.items, page.items),
        nextCursor: page.nextCursor,
      }),
  });

  const navigateToFilters = (next: ProjectFilterState) =>
    navigate({
      to: "/projects",
      search: {
        gitProvider: next.gitProvider === "all" ? undefined : next.gitProvider,
        accountScope: next.accountScope === "all" ? undefined : next.accountScope,
        archived: next.archived || undefined,
      },
    });
  const clear = () => {
    setDraft(defaultProjectFilterState());
    void navigate({ to: "/projects", search: {} });
  };
  const activeFilters = [
    ...(applied.gitProvider !== "all"
      ? [{ key: "gitProvider", label: `Proveedor: ${providerLabel(applied.gitProvider)}` }]
      : []),
    ...(applied.accountScope !== "all"
      ? [
          {
            key: "accountScope",
            label: `Ámbito: ${applied.accountScope === "work" ? "Trabajo" : "Personal"}`,
          },
        ]
      : []),
    ...(applied.archived ? [{ key: "archived", label: "Archivados" }] : []),
  ];
  const removeFilter = (key: string) => {
    const next = { ...applied };
    if (key === "gitProvider") next.gitProvider = "all";
    if (key === "accountScope") next.accountScope = "all";
    if (key === "archived") next.archived = false;
    void navigateToFilters(next);
  };

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
        <CardContent className="grid gap-3">
          <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto_auto] md:items-end">
            <Field>
              <FieldLabel htmlFor={providerId}>Proveedor Git</FieldLabel>
              <Select
                items={providerFilterOptions}
                value={draft.gitProvider}
                onValueChange={(value) => setDraft({ ...draft, gitProvider: value ?? "all" })}
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
              <FieldLabel htmlFor={scopeId}>Ámbito de cuenta</FieldLabel>
              <Select
                items={accountScopeFilterOptions}
                value={draft.accountScope}
                onValueChange={(value) => setDraft({ ...draft, accountScope: value ?? "all" })}
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
              <Checkbox
                id={archivedId}
                checked={draft.archived}
                onCheckedChange={(archived) => setDraft({ ...draft, archived })}
              />
              <FieldLabel htmlFor={archivedId}>Mostrar archivados</FieldLabel>
            </Field>
            <div className="flex gap-2">
              <Button variant="outline" onClick={clear}>
                Limpiar filtros
              </Button>
              <Button onClick={() => void navigateToFilters(draft)}>Aplicar</Button>
            </div>
          </div>
          <ActiveFilters filters={activeFilters} onRemove={removeFilter} onClear={clear} />
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

function ProjectAutomation({
  project,
  sectionId,
  onDirtyChange,
}: {
  readonly project: Project;
  readonly sectionId: string;
  readonly onDirtyChange: (dirty: boolean) => void;
}) {
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
  const [automationEnabled, setAutomationEnabled] = useState(project.automationEnabled);
  const [readyPolicy, setReadyPolicy] = useState(project.readyPolicy);
  const profileOptions = [
    { value: "none", label: "Sin perfil" },
    ...(profiles.data
      ?.filter((profile) => profile.enabled)
      .map((profile) => ({ value: profile.id, label: profile.name })) ?? []),
  ];
  const dirty =
    defaultBranch !== (project.defaultBranch ?? "") ||
    curationAgentProfileId !== (project.curationAgentProfileId ?? "none") ||
    implementationAgentProfileId !== (project.implementationAgentProfileId ?? "none") ||
    scheduleCron !== (project.scheduleCron ?? "") ||
    scheduleTimezone !== project.scheduleTimezone ||
    maxConcurrency !== String(project.maxConcurrency) ||
    automationEnabled !== project.automationEnabled ||
    readyPolicy !== project.readyPolicy;
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);
  useEffect(() => {
    setDefaultBranch(project.defaultBranch ?? "");
    setCurationAgentProfileId(project.curationAgentProfileId ?? "none");
    setImplementationAgentProfileId(project.implementationAgentProfileId ?? "none");
    setScheduleCron(project.scheduleCron ?? "");
    setScheduleTimezone(project.scheduleTimezone);
    setMaxConcurrency(String(project.maxConcurrency));
    setAutomationEnabled(project.automationEnabled);
    setReadyPolicy(project.readyPolicy);
  }, [project]);
  const localError =
    Number.isInteger(Number(maxConcurrency)) &&
    Number(maxConcurrency) >= 1 &&
    Number(maxConcurrency) <= 16
      ? null
      : "La concurrencia debe ser un entero entre 1 y 16.";
  const blockers = projectConfigurationBlockers({
    localError,
    automationEnabled,
    implementationAgentProfileId,
    managed: project.repositoryMode === "managed",
    branchesLoading: branches.isLoading,
    branchesError: branches.isError,
    defaultBranch,
  });
  const save = useMutation({
    mutationFn: () =>
      api.updateProject(project.id, {
        automationEnabled,
        ...(project.repositoryMode === "managed" ? { defaultBranch } : {}),
        curationAgentProfileId: curationAgentProfileId === "none" ? null : curationAgentProfileId,
        implementationAgentProfileId:
          implementationAgentProfileId === "none" ? null : implementationAgentProfileId,
        scheduleCron: scheduleCron || null,
        scheduleTimezone,
        maxConcurrency: Number(maxConcurrency),
        readyPolicy,
      }),
    onSuccess: (value) => {
      client.setQueryData(["project", project.id], value);
      toast.success(
        value.automationEnabled ? "Automatización activada" : "Automatización guardada",
      );
    },
  });
  useEffect(() => {
    if (save.error) focusFirstInvalid();
  }, [save.error]);
  return (
    <section
      id={sectionId}
      className="grid scroll-mt-4 gap-4"
      aria-labelledby={`configuration-${project.id}`}
    >
      <div className="flex flex-wrap items-center gap-3">
        <h2 id={`configuration-${project.id}`} className="text-xl font-semibold">
          Configuración
        </h2>
        <UnsavedChangesBadge dirty={dirty} />
      </div>
      <Card>
        <CardHeader>
          <CardTitle as="h3">Curation</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <p className="text-sm text-muted-foreground">
            Curation usa su propio perfil y puede funcionar aunque Implementation esté desactivada.
          </p>
          {project.repositoryMode === "managed" ? (
            <Field data-invalid={Boolean(apiFieldMessage(save.error, "defaultBranch"))}>
              <FieldLabel htmlFor={`default-branch-${project.id}`}>
                Base Branch por defecto
              </FieldLabel>
              <Combobox
                id={`default-branch-${project.id}`}
                options={
                  branches.data?.map((branch) => ({
                    value: branch.name,
                    label: branch.name,
                    ...(branch.protected ? { description: "Protegida" } : {}),
                  })) ?? []
                }
                value={defaultBranch}
                disabled={branches.isLoading || branches.isError}
                invalid={Boolean(apiFieldMessage(save.error, "defaultBranch"))}
                aria-describedby={[
                  `default-branch-description-${project.id}`,
                  apiFieldMessage(save.error, "defaultBranch")
                    ? `default-branch-error-${project.id}`
                    : null,
                ]
                  .filter(Boolean)
                  .join(" ")}
                placeholder={branches.isLoading ? "Cargando ramas…" : "Seleccionar Base Branch…"}
                searchPlaceholder="Buscar rama…"
                onValueChange={setDefaultBranch}
              />
              <FieldDescription id={`default-branch-description-${project.id}`}>
                Se copiará en las nuevas Tasks. Cambiarla no modifica Tasks ya creadas.
              </FieldDescription>
              <FieldError id={`default-branch-error-${project.id}`}>
                {apiFieldMessage(save.error, "defaultBranch")}
              </FieldError>
            </Field>
          ) : null}
          {branches.isError ? (
            <ErrorNotice error={branches.error} retry={() => void branches.refetch()} />
          ) : null}
          <Field data-invalid={Boolean(apiFieldMessage(save.error, "curationAgentProfileId"))}>
            <FieldLabel htmlFor={`curation-profile-${project.id}`}>Perfil de Curation</FieldLabel>
            <Combobox
              id={`curation-profile-${project.id}`}
              options={profileOptions}
              value={curationAgentProfileId}
              searchPlaceholder="Buscar perfil…"
              invalid={Boolean(apiFieldMessage(save.error, "curationAgentProfileId"))}
              aria-describedby={
                apiFieldMessage(save.error, "curationAgentProfileId")
                  ? `curation-profile-error-${project.id}`
                  : undefined
              }
              onValueChange={setCurationAgentProfileId}
            />
            <FieldError id={`curation-profile-error-${project.id}`}>
              {apiFieldMessage(save.error, "curationAgentProfileId")}
            </FieldError>
          </Field>
          {project.repositoryMode === "managed" ? (
            <Field data-invalid={Boolean(apiFieldMessage(save.error, "readyPolicy"))}>
              <FieldLabel htmlFor={`ready-policy-${project.id}`}>Decisión de Ready</FieldLabel>
              <Select
                items={[
                  { value: "curator_decides", label: "El curator decide" },
                  { value: "manual_approval_required", label: "Requiere aprobación manual" },
                ]}
                value={readyPolicy}
                onValueChange={(value) =>
                  value && setReadyPolicy(value as "curator_decides" | "manual_approval_required")
                }
              >
                <SelectTrigger id={`ready-policy-${project.id}`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="curator_decides">El curator decide</SelectItem>
                  <SelectItem value="manual_approval_required">
                    Requiere aprobación manual
                  </SelectItem>
                </SelectContent>
              </Select>
              <FieldDescription>
                Se captura al iniciar cada Run de Curation y no reinterpreta Runs existentes.
              </FieldDescription>
              <FieldError>{apiFieldMessage(save.error, "readyPolicy")}</FieldError>
            </Field>
          ) : null}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle as="h3">Implementation e infraestructura</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <Field orientation="horizontal">
            <Switch
              id={`implementation-enabled-${project.id}`}
              checked={automationEnabled}
              onCheckedChange={setAutomationEnabled}
              aria-describedby={`implementation-enabled-description-${project.id}`}
            />
            <div>
              <FieldLabel htmlFor={`implementation-enabled-${project.id}`}>
                Implementation {automationEnabled ? "activada" : "desactivada"}
              </FieldLabel>
              <FieldDescription id={`implementation-enabled-description-${project.id}`}>
                El cambio solo se aplica al pulsar Guardar configuración.
              </FieldDescription>
            </div>
          </Field>
          <Field
            data-invalid={Boolean(apiFieldMessage(save.error, "implementationAgentProfileId"))}
          >
            <FieldLabel htmlFor={`implementation-profile-${project.id}`}>
              Perfil de Implementation
            </FieldLabel>
            <Combobox
              id={`implementation-profile-${project.id}`}
              options={profileOptions}
              value={implementationAgentProfileId}
              searchPlaceholder="Buscar perfil…"
              invalid={Boolean(apiFieldMessage(save.error, "implementationAgentProfileId"))}
              aria-describedby={
                apiFieldMessage(save.error, "implementationAgentProfileId")
                  ? `implementation-profile-error-${project.id}`
                  : undefined
              }
              onValueChange={setImplementationAgentProfileId}
            />
            <FieldError id={`implementation-profile-error-${project.id}`}>
              {apiFieldMessage(save.error, "implementationAgentProfileId")}
            </FieldError>
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field>
              <FieldLabel htmlFor={`cron-${project.id}`}>Cron de Implementation</FieldLabel>
              <Input
                id={`cron-${project.id}`}
                className="font-mono"
                placeholder="*/15 * * * *"
                value={scheduleCron}
                onChange={(event) => setScheduleCron(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={`timezone-${project.id}`}>Timezone</FieldLabel>
              <Input
                id={`timezone-${project.id}`}
                value={scheduleTimezone}
                onChange={(event) => setScheduleTimezone(event.target.value)}
              />
            </Field>
            <Field
              data-invalid={Boolean(localError || apiFieldMessage(save.error, "maxConcurrency"))}
            >
              <FieldLabel htmlFor={`concurrency-${project.id}`}>Concurrencia compartida</FieldLabel>
              <Input
                id={`concurrency-${project.id}`}
                type="number"
                min="1"
                max="16"
                value={maxConcurrency}
                onChange={(event) => setMaxConcurrency(event.target.value)}
                aria-invalid={Boolean(localError || apiFieldMessage(save.error, "maxConcurrency"))}
                aria-describedby={[
                  `concurrency-description-${project.id}`,
                  localError || apiFieldMessage(save.error, "maxConcurrency")
                    ? `concurrency-error-${project.id}`
                    : null,
                ]
                  .filter(Boolean)
                  .join(" ")}
              />
              <FieldDescription id={`concurrency-description-${project.id}`}>
                Afecta a Runs de Curation e Implementation.
              </FieldDescription>
              <FieldError id={`concurrency-error-${project.id}`}>
                {localError ?? apiFieldMessage(save.error, "maxConcurrency")}
              </FieldError>
            </Field>
          </div>
          {save.isError ? <ErrorNotice error={save.error} /> : null}
          {dirty && blockers.length > 0 ? (
            <Alert id={`configuration-blockers-${project.id}`}>
              <CircleAlertIcon />
              <AlertTitle>No se puede guardar la configuración</AlertTitle>
              <AlertDescription>
                <ul className="list-disc space-y-1 pl-5">
                  {blockers.map((blocker) => (
                    <li key={blocker}>{blocker}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          ) : null}
          <Button
            className="justify-self-start"
            disabled={!dirty || save.isPending || blockers.length > 0}
            aria-describedby={
              dirty && blockers.length > 0 ? `configuration-blockers-${project.id}` : undefined
            }
            onClick={() => save.mutate()}
          >
            Guardar configuración
          </Button>
        </CardContent>
      </Card>
    </section>
  );
}

interface ProjectConfigurationBlockerInput {
  readonly localError: string | null;
  readonly automationEnabled: boolean;
  readonly implementationAgentProfileId: string;
  readonly managed: boolean;
  readonly branchesLoading: boolean;
  readonly branchesError: boolean;
  readonly defaultBranch: string;
}

export function projectConfigurationBlockers(input: ProjectConfigurationBlockerInput): string[] {
  const blockers: string[] = [];
  if (input.managed && input.branchesLoading) {
    blockers.push("Espera a que se carguen las ramas.");
  } else if (input.managed && input.branchesError) {
    blockers.push("Vuelve a cargar las ramas antes de guardar.");
  } else if (input.managed && input.defaultBranch.trim() === "") {
    blockers.push("Selecciona una Base Branch.");
  }
  if (input.automationEnabled && input.implementationAgentProfileId === "none") {
    blockers.push("Selecciona un Perfil de Implementation para activar Implementation.");
  }
  if (input.localError) blockers.push(input.localError);
  return blockers;
}

function ProjectList({ projects }: { readonly projects: readonly Project[] }) {
  return (
    <>
      <Card className="hidden md:flex" size="sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Project</TableHead>
              <TableHead>Ruta del repositorio</TableHead>
              <TableHead>Proveedor Git</TableHead>
              <TableHead>Ámbito</TableHead>
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
                    className="block max-w-64 truncate font-medium hover:underline"
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
                  <div className="mt-1">
                    <CopyValue label="Project ID" value={project.id} />
                  </div>
                </TableCell>
                <TableCell
                  className="max-w-72 truncate font-mono text-xs"
                  title={project.repositoryPath}
                >
                  {project.repositoryPath}
                </TableCell>
                <TableCell>
                  <span className="block">{providerLabel(project.gitProvider)}</span>
                  <span className="text-xs text-muted-foreground">
                    {project.repositoryMode === "managed" ? "Gestionado" : "Local"}
                  </span>
                </TableCell>
                <TableCell>{scopeLabel(project.accountScope)}</TableCell>
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
          <article
            key={project.id}
            className="min-w-0 rounded-xl bg-card p-4 ring-1 ring-foreground/10"
          >
            <div className="flex items-start justify-between gap-3">
              <Link
                to="/projects/$projectId"
                params={{ projectId: project.id }}
                className="min-w-0 truncate font-semibold hover:underline"
              >
                {project.name}
              </Link>
              {project.archivedAt ? <Badge variant="outline">Archivado</Badge> : null}
            </div>
            <div className="mt-1">
              <CopyValue label="Project ID" value={project.id} />
            </div>
            <p
              className="mt-2 truncate font-mono text-xs text-muted-foreground"
              title={project.repositoryPath}
            >
              {project.repositoryPath}
            </p>
            <div className="mt-3 flex flex-wrap gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <span>{project.repositoryMode === "managed" ? "Gestionado" : "Local"}</span>
              <span>{providerLabel(project.gitProvider)}</span>
              <span>{scopeLabel(project.accountScope)}</span>
              <span>{formatDate(project.updatedAt)}</span>
            </div>
          </article>
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
    <>
      <PageBreadcrumb parent={{ to: "/projects", label: "Projects" }} current="Crear Project" />
      <ProjectForm
        title="Crear Project"
        description="Registra un repositorio Git bajo uno de los roots permitidos."
        submitLabel="Crear Project"
        pending={create.isPending}
        error={create.error}
        onSubmit={(value) => create.mutate(value)}
      />
    </>
  );
}

function ProjectSectionNav({
  repositoryId,
  repositoryDirty,
  configurationId,
  configurationDirty,
  verificationId,
  verificationDirty,
  readinessId,
  tasksId,
}: {
  readonly repositoryId: string;
  readonly repositoryDirty: boolean;
  readonly configurationId: string;
  readonly configurationDirty: boolean;
  readonly verificationId: string;
  readonly verificationDirty: boolean;
  readonly readinessId: string;
  readonly tasksId: string;
}) {
  const sections = [
    { id: repositoryId, label: "Repositorio", dirty: repositoryDirty },
    { id: configurationId, label: "Configuración", dirty: configurationDirty },
    { id: verificationId, label: "Verificación", dirty: verificationDirty },
    { id: readinessId, label: "Comprobación", dirty: false },
    { id: tasksId, label: "Tasks", dirty: false },
  ];
  return (
    <nav
      className="overflow-x-auto border-y bg-muted/30 px-3 py-2"
      aria-label="Secciones del Project"
    >
      <ul className="flex min-w-max items-center gap-2">
        {sections.map((section) => (
          <li key={section.id}>
            <a
              className="inline-flex h-8 items-center gap-2 px-2 text-sm font-medium text-muted-foreground hover:bg-background hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2"
              href={`#${section.id}`}
            >
              {section.label}
              {section.dirty ? <Badge variant="outline">Modificado</Badge> : null}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function ProjectDetailPage({ projectId }: { readonly projectId: string }) {
  const tasksTitleId = useId();
  const [repositoryDirty, setRepositoryDirty] = useState(false);
  const [configurationDirty, setConfigurationDirty] = useState(false);
  const [verificationDirty, setVerificationDirty] = useState(false);
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
  const repositorySectionId = `project-repository-${project.id}`;
  const configurationSectionId = `project-configuration-${project.id}`;
  const verificationSectionId = `project-verification-${project.id}`;
  const readinessSectionId = `project-readiness-${project.id}`;
  const tasksSectionId = `project-tasks-${project.id}`;
  return (
    <>
      <PageBreadcrumb parent={{ to: "/projects", label: "Projects" }} current={project.name} />
      <PageHeader
        title={project.name}
        description="Inventario, Curation e Implementation del Project."
      />
      <ProjectSectionNav
        repositoryId={repositorySectionId}
        repositoryDirty={repositoryDirty}
        configurationId={configurationSectionId}
        configurationDirty={configurationDirty}
        verificationId={verificationSectionId}
        verificationDirty={verificationDirty}
        readinessId={readinessSectionId}
        tasksId={tasksSectionId}
      />
      <ProjectForm
        title="Repositorio"
        headingLevel={2}
        sectionId={repositorySectionId}
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
        guard={false}
        onDirtyChange={setRepositoryDirty}
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
      <ProjectAutomation
        project={project}
        sectionId={configurationSectionId}
        onDirtyChange={setConfigurationDirty}
      />
      <ProjectVerificationContract
        project={project}
        sectionId={verificationSectionId}
        onDirtyChange={setVerificationDirty}
      />
      <ProjectReadiness project={project} sectionId={readinessSectionId} />
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
      <section
        id={tasksSectionId}
        className="grid scroll-mt-4 gap-3"
        aria-labelledby={tasksTitleId}
      >
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
                <StatusBadge status={task.status} />
              </Link>
            ))}
            {tasks.data.nextCursor ? (
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/30 p-3">
                <p className="text-sm text-muted-foreground">
                  Mostrando las primeras {tasks.data.items.length} Tasks.
                </p>
                <Link
                  className={buttonVariants({ variant: "outline", size: "sm" })}
                  to="/tasks"
                  search={{ projectId }}
                >
                  Ver todas las Tasks
                </Link>
              </div>
            ) : null}
          </div>
        ) : (
          <Empty title="Sin Tasks" headingLevel={3}>
            Este Project todavía no tiene Tasks activas.
          </Empty>
        )}
      </section>
      <UnsavedChangesGuard dirty={repositoryDirty || configurationDirty || verificationDirty} />
    </>
  );
}

function ProjectVerificationContract({
  project,
  sectionId,
  onDirtyChange,
}: {
  readonly project: Project;
  readonly sectionId: string;
  readonly onDirtyChange: (dirty: boolean) => void;
}) {
  const client = useQueryClient();
  const state = useQuery({
    queryKey: ["verification-contract", project.id],
    queryFn: () => api.verificationContract(project.id),
  });
  const history = useQuery({
    queryKey: ["verification-contract-history", project.id],
    queryFn: () => api.verificationContractHistory(project.id),
  });
  const [commandsJson, setCommandsJson] = useState("[]");
  const [edited, setEdited] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  useEffect(() => {
    if (!edited && state.data !== undefined) {
      setCommandsJson(JSON.stringify(state.data.active?.commands ?? [], null, 2));
    }
  }, [edited, state.data]);
  useEffect(() => onDirtyChange(edited), [edited, onDirtyChange]);
  const synchronize = (value: Awaited<ReturnType<typeof api.verificationContract>>) => {
    client.setQueryData(["verification-contract", project.id], value);
    void client.invalidateQueries({ queryKey: ["verification-contract-history", project.id] });
    setCommandsJson(JSON.stringify(value.active?.commands ?? [], null, 2));
    setEdited(false);
    setLocalError(null);
  };
  const replace = useMutation({
    mutationFn: (commands: VerificationCommand[]) =>
      api.replaceVerificationContract(project.id, {
        expectedRevision: state.data?.latestRevision ?? null,
        commands,
      }),
    onSuccess: (value) => {
      synchronize(value);
      toast.success(`Verification Contract revision ${value.latestRevision} guardada`);
    },
  });
  const disable = useMutation({
    mutationFn: () => {
      const revision = state.data?.latestRevision;
      if (revision == null) throw new Error("No active Verification Contract.");
      return api.disableVerificationContract(project.id, revision);
    },
    onSuccess: (value) => {
      synchronize(value);
      toast.success("Verification Contract desactivado");
    },
  });
  const save = () => {
    try {
      const parsed: unknown = JSON.parse(commandsJson);
      if (!Array.isArray(parsed)) throw new Error("El documento debe ser un array JSON.");
      setLocalError(null);
      replace.mutate(parsed as VerificationCommand[]);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "JSON inválido.");
    }
  };
  if (state.isError) {
    return <ErrorNotice error={state.error} retry={() => void state.refetch()} />;
  }
  return (
    <Card id={sectionId} className="scroll-mt-4" size="sm">
      <CardHeader>
        <CardTitle>Verification Contract</CardTitle>
        <CardAction>
          <UnsavedChangesBadge dirty={edited} />
        </CardAction>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={state.data?.active ? "default" : "outline"}>
            {state.data?.active
              ? `Activo · revision ${state.data.active.revision}`
              : "No configurado"}
          </Badge>
          <span className="text-sm text-muted-foreground">
            Cada guardado crea una revisión inmutable.
          </span>
        </div>
        <Field data-invalid={Boolean(localError)}>
          <FieldLabel htmlFor={`verification-contract-${project.id}`}>Comandos JSON</FieldLabel>
          <Textarea
            id={`verification-contract-${project.id}`}
            className="min-h-56 font-mono text-xs"
            value={commandsJson}
            disabled={project.archivedAt !== null}
            aria-invalid={Boolean(localError)}
            onChange={(event) => {
              setCommandsJson(event.target.value);
              setEdited(true);
              setLocalError(null);
            }}
          />
          <FieldDescription>
            Array de name, executable, args, required y timeoutSeconds. Se ejecutará como argv desde
            el root del repositorio, sin shell, entorno ni working directory alternativo.
          </FieldDescription>
          <FieldError>{localError}</FieldError>
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={project.archivedAt !== null || replace.isPending || !edited}
            onClick={save}
          >
            Guardar nueva revisión
          </Button>
          {state.data?.active ? (
            <ConfirmAction
              trigger={
                <Button
                  variant="outline"
                  disabled={project.archivedAt !== null || disable.isPending}
                >
                  Desactivar contrato
                </Button>
              }
              title="Desactivar Verification Contract"
              description="Se conservará toda la historia y los Runs ya creados mantendrán su revisión."
              confirmLabel="Desactivar"
              onConfirm={() => disable.mutate()}
            />
          ) : null}
        </div>
        {replace.isError ? <ErrorNotice error={replace.error} /> : null}
        {disable.isError ? <ErrorNotice error={disable.error} /> : null}
        <details className="group rounded-lg border bg-muted/20">
          <summary className="cursor-pointer list-none px-3 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2">
            Historial de revisiones
            {history.data ? ` (${history.data.length})` : ""}
          </summary>
          <div className="grid gap-2 border-t p-3">
            {history.isError ? (
              <ErrorNotice error={history.error} retry={() => void history.refetch()} />
            ) : history.data?.length ? (
              <div className="grid gap-2">
                {history.data.map((revision) => (
                  <div
                    key={revision.revision}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm"
                  >
                    <span>
                      Revision {revision.revision} ·{" "}
                      {revision.enabled ? `${revision.commands.length} comandos` : "desactivada"}
                    </span>
                    <span className="text-muted-foreground">{formatDate(revision.createdAt)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Todavía no hay revisiones.</p>
            )}
          </div>
        </details>
      </CardContent>
    </Card>
  );
}

function ProjectReadiness({
  project,
  sectionId,
}: {
  readonly project: Project;
  readonly sectionId: string;
}) {
  const [report, setReport] = useState<ProjectReadinessReport | null>(null);
  const check = useMutation({
    mutationFn: (depth: "standard" | "deep") => api.projectReadiness(project.id, depth),
    onSuccess: (value) => {
      setReport(value);
      toast[value.ok ? "success" : "error"](
        value.ok ? "Project preparado" : "Project necesita atención",
      );
    },
  });
  const disabled = project.repositoryMode !== "managed" || project.archivedAt !== null;
  return (
    <Card id={sectionId} className="scroll-mt-4" size="sm">
      <CardHeader>
        <CardTitle>Comprobar Project</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        <p className="text-sm text-muted-foreground">
          Comprueba configuración, provider, rama, perfiles y runner sin crear una Task ni un Run.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={disabled || check.isPending}
            onClick={() => check.mutate("standard")}
          >
            <StethoscopeIcon /> Comprobar
          </Button>
          <ConfirmAction
            trigger={
              <Button variant="outline" disabled={disabled || check.isPending}>
                Probe profundo
              </Button>
            }
            title="Ejecutar probe profundo"
            description="Creará y eliminará contenedores efímeros para validar imagen, red, workspace, toolchain y autenticación de modelos."
            confirmLabel="Ejecutar probe"
            onConfirm={() => check.mutate("deep")}
          />
        </div>
        {project.repositoryMode !== "managed" ? (
          <p className="text-sm text-muted-foreground">
            Project Readiness se aplica únicamente a Projects gestionados.
          </p>
        ) : null}
        {check.isError ? <ErrorNotice error={check.error} /> : null}
        {report ? <ReadinessReport report={report} /> : null}
      </CardContent>
    </Card>
  );
}

function ReadinessReport({ report }: { readonly report: ProjectReadinessReport }) {
  return (
    <section className="grid gap-2" aria-label="Resultado de Project Readiness">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <strong>{report.ok ? "Preparado" : "Necesita atención"}</strong>
        <span className="text-xs text-muted-foreground">
          {report.depth === "deep" ? "Profundo" : "Estándar"} · {report.durationMs} ms ·{" "}
          {formatDate(report.checkedAt)}
        </span>
      </div>
      <ul className="grid gap-2">
        {report.checks.map((item) => (
          <li className="flex items-start gap-2 rounded-lg bg-muted/40 p-3" key={item.id}>
            {item.status === "pass" ? (
              <CircleCheckIcon className="mt-0.5 size-4 shrink-0 text-primary" />
            ) : item.status === "fail" ? (
              <CircleXIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
            ) : (
              <span aria-hidden className="mt-0.5 w-4 shrink-0 text-center">
                •
              </span>
            )}
            <span>
              <strong className="block text-sm">{item.id.replaceAll("_", " ")}</strong>
              <span className="text-sm text-muted-foreground">{item.message}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function defaultProjectFilterState(): ProjectFilterState {
  return { gitProvider: "all", accountScope: "all", archived: false };
}

function projectFilterState(filters: {
  readonly gitProvider?: string;
  readonly accountScope?: string;
  readonly archived?: boolean;
}): ProjectFilterState {
  return {
    gitProvider: filters.gitProvider ?? "all",
    accountScope: filters.accountScope ?? "all",
    archived: filters.archived ?? false,
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

function scopeLabel(value: string): string {
  return value === "work" ? "Trabajo" : value === "personal" ? "Personal" : value;
}

function ProjectForm({
  title,
  headingLevel = 1,
  sectionId,
  description,
  submitLabel,
  project,
  pending,
  error,
  disabled = false,
  guard = true,
  onDirtyChange,
  onSubmit,
}: {
  readonly title: string;
  readonly headingLevel?: 1 | 2;
  readonly sectionId?: string;
  readonly description: string;
  readonly submitLabel: string;
  readonly project?: Project;
  readonly pending: boolean;
  readonly error: unknown;
  readonly disabled?: boolean;
  readonly guard?: boolean;
  readonly onDirtyChange?: (dirty: boolean) => void;
  readonly onSubmit: (value: ProjectFields) => void;
}) {
  const id = useId();
  const {
    register,
    control,
    handleSubmit,
    reset,
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
  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);
  useEffect(() => {
    if (project) reset(project);
  }, [project, reset]);
  useEffect(() => {
    if (error) focusFirstInvalid();
  }, [error]);
  return (
    <>
      <Card id={sectionId} className={sectionId ? "scroll-mt-4" : undefined}>
        <CardHeader>
          <PageHeader
            title={title}
            description={description}
            headingLevel={headingLevel}
            actions={<UnsavedChangesBadge dirty={isDirty} />}
          />
        </CardHeader>
        <CardContent>
          <form className="grid gap-5" onSubmit={handleSubmit(onSubmit)}>
            <FieldGroup>
              <Field data-invalid={Boolean(errors.name || apiFieldMessage(error, "name"))}>
                <FieldLabel htmlFor={`${id}-name`}>Nombre</FieldLabel>
                <Input
                  id={`${id}-name`}
                  disabled={disabled}
                  aria-invalid={Boolean(errors.name || apiFieldMessage(error, "name"))}
                  aria-describedby={
                    errors.name || apiFieldMessage(error, "name") ? `${id}-name-error` : undefined
                  }
                  {...register("name", {
                    required: "El nombre es obligatorio.",
                    maxLength: { value: 120, message: "Máximo 120 caracteres." },
                  })}
                />
                <FieldError id={`${id}-name-error`}>
                  {errors.name?.message ?? apiFieldMessage(error, "name")}
                </FieldError>
              </Field>
              <Field
                data-invalid={Boolean(errors.description || apiFieldMessage(error, "description"))}
              >
                <FieldLabel htmlFor={`${id}-description`}>Descripción</FieldLabel>
                <Textarea
                  id={`${id}-description`}
                  disabled={disabled}
                  className="min-h-24"
                  aria-invalid={Boolean(
                    errors.description || apiFieldMessage(error, "description"),
                  )}
                  aria-describedby={
                    errors.description || apiFieldMessage(error, "description")
                      ? `${id}-description-error`
                      : undefined
                  }
                  {...register("description", {
                    maxLength: { value: 10000, message: "Máximo 10 000 caracteres." },
                  })}
                />
                <FieldError id={`${id}-description-error`}>
                  {errors.description?.message ?? apiFieldMessage(error, "description")}
                </FieldError>
              </Field>
              <Field
                data-invalid={Boolean(
                  errors.repositoryPath || apiFieldMessage(error, "repositoryPath"),
                )}
              >
                <FieldLabel htmlFor={`${id}-repository`}>Ruta del repositorio</FieldLabel>
                <Input
                  id={`${id}-repository`}
                  disabled={disabled || project?.repositoryMode === "managed"}
                  className="font-mono"
                  aria-invalid={Boolean(
                    errors.repositoryPath || apiFieldMessage(error, "repositoryPath"),
                  )}
                  aria-describedby={[
                    `${id}-repository-description`,
                    errors.repositoryPath || apiFieldMessage(error, "repositoryPath")
                      ? `${id}-repository-error`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  {...register("repositoryPath", { required: "La ruta es obligatoria." })}
                />
                <FieldDescription id={`${id}-repository-description`}>
                  Ruta absoluta canonicalizada dentro de un root permitido.
                </FieldDescription>
                <FieldError id={`${id}-repository-error`}>
                  {errors.repositoryPath?.message ?? apiFieldMessage(error, "repositoryPath")}
                </FieldError>
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor={`${id}-provider`}>Proveedor Git</FieldLabel>
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
                  <FieldLabel htmlFor={`${id}-scope`}>Ámbito de cuenta</FieldLabel>
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
      {guard ? (
        <>
          <UnsavedChangesBadge dirty={isDirty} />
          <UnsavedChangesGuard dirty={isDirty && !pending} />
        </>
      ) : null}
    </>
  );
}
