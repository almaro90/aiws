import { type UseQueryResult, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useId, useState } from "react";
import { toast } from "sonner";
import {
  ConfirmAction,
  ErrorNotice,
  Loading,
  PageHeader,
  buttonVariants,
} from "../components/common.tsx";
import { Badge } from "../components/ui/badge.tsx";
import { Button } from "../components/ui/button.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card.tsx";
import { Combobox } from "../components/ui/combobox.tsx";
import { Field, FieldError, FieldGroup, FieldLabel } from "../components/ui/field.tsx";
import { Input } from "../components/ui/input.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select.tsx";
import { api, apiFieldMessage } from "../lib/api.ts";
import { focusFirstInvalid, UnsavedChangesBadge, UnsavedChangesGuard } from "../lib/form-state.tsx";
import type { Connection, Project, RemoteRepository, RunnerStatus } from "../lib/types.ts";
import { catalogSelection } from "../lib/model-catalog.ts";

const accountScopeOptions = [
  { value: "personal", label: "Personal" },
  { value: "work", label: "Trabajo" },
];
const authModeOptions = [
  { value: "api_key", label: "API key aislada" },
  { value: "chatgpt_session", label: "Sesión ChatGPT" },
];

export function AutomationPage() {
  const infrastructureId = useId();
  const repositoriesId = useId();
  const profilesId = useId();
  const connections = useQuery({ queryKey: ["connections"], queryFn: api.connections });
  const profiles = useQuery({ queryKey: ["agent-profiles"], queryFn: api.agentProfiles });
  const runner = useQuery({
    queryKey: ["runner-status"],
    queryFn: api.runnerStatus,
    refetchInterval: 15_000,
    staleTime: 0,
  });
  const connect = useMutation({
    mutationFn: api.githubInstallUrl,
    onSuccess: ({ url }) => window.location.assign(url),
  });
  const connectAzure = useMutation({
    mutationFn: api.azureAuthorizeUrl,
    onSuccess: ({ url }) => window.location.assign(url),
  });
  const azureAuthorizationId =
    typeof window === "undefined"
      ? null
      : new URLSearchParams(window.location.search).get("azureAuthorizationId");
  return (
    <>
      <PageHeader
        title="Automatización"
        description="Conecta GitHub o Azure DevOps Services, importa repositorios gestionados y configura los perfiles Codex usados para curation e implementación."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button disabled={connect.isPending} onClick={() => connect.mutate()}>
              Conectar GitHub
            </Button>
            <Button
              variant="outline"
              disabled={connectAzure.isPending}
              onClick={() => connectAzure.mutate()}
            >
              Conectar Azure DevOps
            </Button>
          </div>
        }
      />
      {connect.isError ? <ErrorNotice error={connect.error} /> : null}
      {connectAzure.isError ? <ErrorNotice error={connectAzure.error} /> : null}
      <section className="grid gap-3" aria-labelledby={infrastructureId}>
        <h2 id={infrastructureId} className="text-xl font-semibold">
          Infraestructura
        </h2>
        <RunnerStatusCard query={runner} />
      </section>
      <section className="grid gap-3" aria-labelledby={repositoriesId}>
        <h2 id={repositoriesId} className="text-xl font-semibold">
          Conexiones y repositorios gestionados
        </h2>
        {azureAuthorizationId ? (
          <AzureOrganizationSelector authorizationId={azureAuthorizationId} />
        ) : null}
        {connections.isError ? (
          <ErrorNotice error={connections.error} retry={() => void connections.refetch()} />
        ) : connections.data === undefined ? (
          <Loading />
        ) : connections.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">No hay cuentas conectadas.</p>
        ) : (
          connections.data.map((connection) => (
            <ConnectionCard key={connection.id} connection={connection} />
          ))
        )}
      </section>
      <section className="grid gap-3" aria-labelledby={profilesId}>
        <h2 id={profilesId} className="text-xl font-semibold">
          Perfiles de agente
        </h2>
        <ProfileForm />
        {profiles.isError ? (
          <ErrorNotice error={profiles.error} retry={() => void profiles.refetch()} />
        ) : profiles.data === undefined ? (
          <Loading />
        ) : (
          profiles.data.map((profile) => (
            <Card key={profile.id} size="sm">
              <CardContent className="flex items-center justify-between gap-3">
                <div>
                  <strong>{profile.name}</strong>
                  <p className="text-sm text-muted-foreground">
                    Codex · {profile.authMode} · {profile.model ?? "modelo automático"} ·{" "}
                    {profile.reasoningEffort ?? "effort automático"} · referencia{" "}
                    {profile.credentialReference}
                  </p>
                </div>
                <ProfileToggle id={profile.id} enabled={profile.enabled} />
              </CardContent>
            </Card>
          ))
        )}
      </section>
    </>
  );
}

function AzureOrganizationSelector({ authorizationId }: { readonly authorizationId: string }) {
  const organizationFieldId = useId();
  const client = useQueryClient();
  const [organizationId, setOrganizationId] = useState("");
  const organizations = useQuery({
    queryKey: ["azure-organizations", authorizationId],
    queryFn: () => api.azureOrganizations(authorizationId),
  });
  const complete = useMutation({
    mutationFn: () => api.completeAzureAuthorization(authorizationId, organizationId),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["connections"] });
      const url = new URL(window.location.href);
      url.searchParams.delete("azureAuthorizationId");
      window.history.replaceState(null, "", url);
      toast.success("Organización de Azure DevOps conectada");
    },
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Seleccionar organización de Azure DevOps</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        {organizations.isError ? (
          <ErrorNotice error={organizations.error} retry={() => void organizations.refetch()} />
        ) : organizations.data === undefined ? (
          <Loading />
        ) : (
          <>
            <Field>
              <FieldLabel htmlFor={organizationFieldId}>Organización</FieldLabel>
              <Combobox
                id={organizationFieldId}
                options={organizations.data.map((organization) => ({
                  value: organization.id,
                  label: organization.name,
                }))}
                value={organizationId}
                placeholder="Seleccionar organización…"
                searchPlaceholder="Buscar organización…"
                onValueChange={setOrganizationId}
              />
            </Field>
            <Button
              className="justify-self-start"
              disabled={!organizationId || complete.isPending}
              onClick={() => complete.mutate()}
            >
              Completar conexión
            </Button>
          </>
        )}
        {complete.isError ? <ErrorNotice error={complete.error} /> : null}
      </CardContent>
    </Card>
  );
}

function RunnerStatusCard({ query }: { readonly query: UseQueryResult<RunnerStatus> }) {
  const status = query.data?.status ?? (query.isError ? "offline" : "unknown");
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          Runner manager
          <Badge variant={status === "online" ? "secondary" : "destructive"}>{status}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        <p className="text-muted-foreground">
          {status === "online"
            ? "El runner está consultando y reconciliando Runs."
            : status === "offline"
              ? "No se ha recibido actividad dentro de la ventana esperada."
              : "Todavía no se ha recibido una señal del runner desde que arrancó la API."}
        </p>
        {query.data?.lastSeenAt ? (
          <p className="text-xs text-muted-foreground">
            Última señal: {new Date(query.data.lastSeenAt).toLocaleString()}
          </p>
        ) : null}
        {status !== "online" ? (
          <p>
            Comprueba el servicio <code>runner-manager</code>. Las Tasks pausadas se pueden reanudar
            desde su detalle cuando el runner vuelva a estar disponible.
          </p>
        ) : null}
        <Button
          className="justify-self-start"
          size="sm"
          variant="outline"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          Comprobar ahora
        </Button>
      </CardContent>
    </Card>
  );
}

function ConnectionCard({ connection }: { readonly connection: Connection }) {
  const [showRepos, setShowRepos] = useState(false);
  const [selectedRepositoryId, setSelectedRepositoryId] = useState("");
  const repos = useQuery({
    queryKey: ["connection-repositories", connection.id],
    queryFn: () => api.connectionRepositories(connection.id),
    enabled: showRepos && connection.status === "active",
  });
  const client = useQueryClient();
  const revoke = useMutation({
    mutationFn: () => api.revokeConnection(connection.id),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["connections"] });
      toast.success("Connection revocada");
    },
  });
  const reauthorize = useMutation({
    mutationFn: () => api.reauthorizeConnection(connection.id),
    onSuccess: ({ url }) => window.location.assign(url),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-3">
          <span>{connection.displayName}</span>
          <Badge variant="outline">{connection.status}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        <p className="text-sm text-muted-foreground">
          {connection.provider === "github" && "installationId" in connection
            ? `GitHub · instalación ${connection.installationId}`
            : connection.provider === "azure_devops" && "organizationName" in connection
              ? `Azure DevOps · organización ${connection.organizationName}`
              : "Proveedor gestionado"}
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={connection.status !== "active"}
            onClick={() => setShowRepos((value) => !value)}
          >
            {showRepos ? "Ocultar repos" : "Elegir repos"}
          </Button>
          <ConfirmAction
            trigger={<Button variant="destructive">Revocar</Button>}
            title="Revocar Connection"
            description="AIWS dejará de importar repositorios y obtener credenciales efímeras desde esta instalación."
            confirmLabel="Revocar"
            destructive
            disabled={connection.status !== "active" || revoke.isPending}
            onConfirm={() => revoke.mutate()}
          />
          {connection.status === "reauthorization_required" ? (
            <Button
              variant="outline"
              disabled={reauthorize.isPending}
              onClick={() => reauthorize.mutate()}
            >
              Reautorizar
            </Button>
          ) : null}
        </div>
        {repos.isError ? (
          <ErrorNotice error={repos.error} />
        ) : repos.isLoading ? (
          <Loading />
        ) : showRepos && repos.data ? (
          repos.data.length ? (
            <div className="grid gap-3">
              <Field>
                <FieldLabel htmlFor={`repository-${connection.id}`}>
                  Repositorio gestionado
                </FieldLabel>
                <Combobox
                  id={`repository-${connection.id}`}
                  options={repos.data.map((repo) => ({
                    value: repo.id,
                    label: repo.fullName,
                    description: repo.private ? "Privado" : "Público",
                  }))}
                  value={selectedRepositoryId}
                  placeholder="Seleccionar repositorio…"
                  searchPlaceholder="Buscar repositorio…"
                  onValueChange={setSelectedRepositoryId}
                />
              </Field>
              {repos.data.find((repo) => repo.id === selectedRepositoryId) ? (
                <RepositoryRow
                  connectionId={connection.id}
                  repository={
                    repos.data.find((repo) => repo.id === selectedRepositoryId) as RemoteRepository
                  }
                />
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              La instalación no expone repositorios importables.
            </p>
          )
        ) : null}
        {revoke.isError ? <ErrorNotice error={revoke.error} /> : null}
        {reauthorize.isError ? <ErrorNotice error={reauthorize.error} /> : null}
      </CardContent>
    </Card>
  );
}

function RepositoryRow({
  connectionId,
  repository,
}: {
  readonly connectionId: string;
  readonly repository: RemoteRepository;
}) {
  const client = useQueryClient();
  const [accountScope, setAccountScope] = useState<"personal" | "work">("personal");
  const [createdProject, setCreatedProject] = useState<Project | null>(null);
  const imported = useMutation({
    mutationFn: () =>
      api.importRepository(connectionId, {
        repositoryId: repository.id,
        accountScope,
        description: "",
      }),
    onSuccess: async (project) => {
      await client.invalidateQueries({ queryKey: ["projects"] });
      setCreatedProject(project);
      toast.success("Repositorio importado como Project");
    },
  });
  return (
    <div className="grid gap-3 rounded-lg border p-3 sm:grid-cols-[minmax(0,1fr)_8rem_auto] sm:items-end">
      <span className="min-w-0 break-all font-mono text-sm">
        {repository.fullName} {repository.private ? "· privado" : ""}
      </span>
      <Select
        items={accountScopeOptions}
        value={accountScope}
        onValueChange={(value) => value && setAccountScope(value as typeof accountScope)}
      >
        <SelectTrigger className="w-full">
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
      <Button size="sm" disabled={imported.isPending} onClick={() => imported.mutate()}>
        Importar
      </Button>
      {imported.isError ? (
        <div className="sm:col-span-3">
          <ErrorNotice error={imported.error} />
        </div>
      ) : null}
      {createdProject ? (
        <Link
          className={`${buttonVariants({ variant: "outline", size: "sm" })} sm:col-span-3 sm:justify-self-start`}
          to="/projects/$projectId"
          params={{ projectId: createdProject.id }}
        >
          Abrir Project {createdProject.name}
        </Link>
      ) : null}
    </div>
  );
}

function ProfileForm() {
  const chatgptSessionReference = "CODEX_SESSION";
  const client = useQueryClient();
  const id = useId();
  const nameId = `${id}-name`;
  const authModeId = `${id}-auth-mode`;
  const credentialReferenceId = `${id}-credential-reference`;
  const modelId = `${id}-model`;
  const reasoningEffortId = `${id}-reasoning-effort`;
  const [name, setName] = useState("");
  const [authMode, setAuthMode] = useState<"api_key" | "chatgpt_session">("api_key");
  const [credentialReference, setCredentialReference] = useState("OPENAI_API_KEY");
  const [model, setModel] = useState("");
  const [reasoningEffort, setReasoningEffort] = useState("");
  const effectiveCredentialReference =
    authMode === "chatgpt_session" ? chatgptSessionReference : credentialReference;
  const credentialValid = /^[A-Z][A-Z0-9_]*$/u.test(effectiveCredentialReference);
  const catalog = useQuery({
    queryKey: ["agent-profile-model-catalog", authMode, effectiveCredentialReference],
    queryFn: () => api.agentProfileModels(authMode, effectiveCredentialReference),
    enabled: credentialValid,
    retry: false,
  });
  const selectedModel = catalog.data?.models.find((candidate) => candidate.id === model);
  const defaultSelection = catalog.data ? catalogSelection(catalog.data.models, "", "") : null;
  const dirty =
    name !== "" ||
    authMode !== "api_key" ||
    credentialReference !== "OPENAI_API_KEY" ||
    (defaultSelection !== null &&
      (model !== defaultSelection.modelId || reasoningEffort !== defaultSelection.reasoningEffort));
  const modelOptions =
    catalog.data?.models.map((candidate) => ({ value: candidate.id, label: candidate.name })) ?? [];
  const reasoningEffortOptions =
    selectedModel?.supportedReasoningEfforts.map((effort) => ({ value: effort, label: effort })) ??
    [];
  useEffect(() => {
    const models = catalog.data?.models;
    if (models === undefined || models.length === 0) return;
    const next = catalogSelection(models, model, reasoningEffort);
    if (next === null) return;
    if (next.modelId !== model) setModel(next.modelId);
    if (next.reasoningEffort !== reasoningEffort) setReasoningEffort(next.reasoningEffort);
  }, [catalog.data, model, reasoningEffort]);
  const create = useMutation({
    mutationFn: () =>
      api.createAgentProfile({
        name,
        runtime: "codex",
        authMode,
        credentialReference: effectiveCredentialReference,
        model,
        reasoningEffort,
      }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["agent-profiles"] });
      setName("");
      setAuthMode("api_key");
      setCredentialReference("OPENAI_API_KEY");
      setModel("");
      setReasoningEffort("");
      toast.success("Agent Profile creado");
    },
  });
  const nameError = name.trim()
    ? apiFieldMessage(create.error, "name")
    : "El nombre es obligatorio.";
  const credentialError = credentialValid
    ? apiFieldMessage(create.error, "credentialReference")
    : "Usa un nombre de variable como OPENAI_API_KEY.";
  useEffect(() => {
    if (create.error) focusFirstInvalid();
  }, [create.error]);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-3">
          Nuevo perfil Codex
          <UnsavedChangesBadge dirty={dirty} />
        </CardTitle>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          <Field data-invalid={Boolean(nameError && (create.isError || name.length > 0))}>
            <FieldLabel htmlFor={nameId}>Nombre</FieldLabel>
            <Input
              id={nameId}
              value={name}
              aria-invalid={Boolean(nameError && (create.isError || name.length > 0))}
              aria-describedby={
                nameError && (create.isError || name.length > 0) ? `${nameId}-error` : undefined
              }
              onChange={(event) => setName(event.target.value)}
            />
            <FieldError id={`${nameId}-error`}>
              {create.isError || name.length > 0 ? nameError : null}
            </FieldError>
          </Field>
          <Field>
            <FieldLabel htmlFor={authModeId}>Modo de autenticación</FieldLabel>
            <Select
              items={authModeOptions}
              value={authMode}
              onValueChange={(value) => value && setAuthMode(value as typeof authMode)}
            >
              <SelectTrigger id={authModeId}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {authModeOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {authMode === "api_key" ? (
            <Field data-invalid={Boolean(credentialError)}>
              <FieldLabel htmlFor={credentialReferenceId}>
                Referencia de credencial de entorno
              </FieldLabel>
              <Input
                id={credentialReferenceId}
                className="font-mono"
                value={credentialReference}
                aria-invalid={Boolean(credentialError)}
                aria-describedby={credentialError ? `${credentialReferenceId}-error` : undefined}
                onChange={(event) => setCredentialReference(event.target.value)}
              />
              <FieldError id={`${credentialReferenceId}-error`}>{credentialError}</FieldError>
            </Field>
          ) : (
            <p className="text-sm text-muted-foreground">
              Se usará la sesión ChatGPT configurada en Codex.
            </p>
          )}
          <Field data-invalid={Boolean(apiFieldMessage(create.error, "model"))}>
            <FieldLabel htmlFor={modelId}>Modelo</FieldLabel>
            <Select
              items={modelOptions}
              value={model}
              disabled={catalog.data === undefined}
              onValueChange={(value) => {
                if (!value) return;
                const next = catalog.data?.models.find((candidate) => candidate.id === value);
                setModel(value);
                if (next !== undefined) setReasoningEffort(next.defaultReasoningEffort);
              }}
            >
              <SelectTrigger
                id={modelId}
                aria-invalid={Boolean(apiFieldMessage(create.error, "model"))}
                aria-describedby={[
                  selectedModel?.description ? `${modelId}-description` : null,
                  apiFieldMessage(create.error, "model") ? `${modelId}-error` : null,
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                <SelectValue placeholder="Selecciona un modelo" />
              </SelectTrigger>
              <SelectContent>
                {modelOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedModel?.description ? (
              <p id={`${modelId}-description`} className="text-sm text-muted-foreground">
                {selectedModel.description}
              </p>
            ) : null}
            <FieldError id={`${modelId}-error`}>
              {apiFieldMessage(create.error, "model")}
            </FieldError>
          </Field>
          <Field data-invalid={Boolean(apiFieldMessage(create.error, "reasoningEffort"))}>
            <FieldLabel htmlFor={reasoningEffortId}>Esfuerzo de razonamiento</FieldLabel>
            <Select
              items={reasoningEffortOptions}
              value={reasoningEffort}
              disabled={selectedModel === undefined}
              onValueChange={(value) => value && setReasoningEffort(value)}
            >
              <SelectTrigger
                id={reasoningEffortId}
                aria-invalid={Boolean(apiFieldMessage(create.error, "reasoningEffort"))}
                aria-describedby={
                  apiFieldMessage(create.error, "reasoningEffort")
                    ? `${reasoningEffortId}-error`
                    : undefined
                }
              >
                <SelectValue placeholder="Selecciona el esfuerzo" />
              </SelectTrigger>
              <SelectContent>
                {reasoningEffortOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldError id={`${reasoningEffortId}-error`}>
              {apiFieldMessage(create.error, "reasoningEffort")}
            </FieldError>
          </Field>
          {catalog.isLoading ? <Loading /> : null}
          {catalog.isError ? (
            <ErrorNotice error={catalog.error} retry={() => void catalog.refetch()} />
          ) : null}
          {create.isError ? <ErrorNotice error={create.error} /> : null}
          <Button
            className="justify-self-start"
            disabled={
              !name.trim() ||
              create.isPending ||
              catalog.data === undefined ||
              selectedModel === undefined ||
              !selectedModel.supportedReasoningEfforts.includes(reasoningEffort)
            }
            onClick={() => create.mutate()}
          >
            Crear perfil
          </Button>
        </FieldGroup>
      </CardContent>
      <UnsavedChangesGuard dirty={dirty && !create.isPending} />
    </Card>
  );
}

function ProfileToggle({ id, enabled }: { readonly id: string; readonly enabled: boolean }) {
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => api.setAgentProfileEnabled(id, !enabled),
    onSuccess: async () => client.invalidateQueries({ queryKey: ["agent-profiles"] }),
  });
  return (
    <Button variant="outline" disabled={mutation.isPending} onClick={() => mutation.mutate()}>
      {enabled ? "Desactivar" : "Activar"}
    </Button>
  );
}
