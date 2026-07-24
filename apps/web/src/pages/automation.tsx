import { type UseQueryResult, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { ErrorNotice, Loading, PageHeader } from "../components/common.tsx";
import { Badge } from "../components/ui/badge.tsx";
import { Button } from "../components/ui/button.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card.tsx";
import { Field, FieldGroup, FieldLabel } from "../components/ui/field.tsx";
import { Input } from "../components/ui/input.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select.tsx";
import { api } from "../lib/api.ts";
import type { Connection, RunnerStatus } from "../lib/types.ts";
import { catalogSelection } from "../lib/model-catalog.ts";

const accountScopeOptions = [
  { value: "personal", label: "Personal" },
  { value: "work", label: "Work" },
];
const authModeOptions = [
  { value: "api_key", label: "API key aislada" },
  { value: "chatgpt_session", label: "Sesión ChatGPT" },
];

export function AutomationPage() {
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
  return (
    <>
      <PageHeader
        title="Automation"
        description="Conecta GitHub, importa repositorios gestionados y configura los perfiles Codex usados para curation e implementación."
        actions={
          <Button disabled={connect.isPending} onClick={() => connect.mutate()}>
            Conectar GitHub
          </Button>
        }
      />
      {connect.isError ? <ErrorNotice error={connect.error} /> : null}
      <RunnerStatusCard query={runner} />
      <section className="grid gap-3">
        <h2 className="text-xl font-semibold">Connections</h2>
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
      <section className="grid gap-3">
        <h2 className="text-xl font-semibold">Agent Profiles</h2>
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
          GitHub · installation {connection.installationId}
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={connection.status !== "active"}
            onClick={() => setShowRepos((value) => !value)}
          >
            {showRepos ? "Ocultar repos" : "Elegir repos"}
          </Button>
          <Button
            variant="destructive"
            disabled={connection.status !== "active" || revoke.isPending}
            onClick={() => revoke.mutate()}
          >
            Revocar
          </Button>
        </div>
        {repos.isError ? (
          <ErrorNotice error={repos.error} />
        ) : repos.isLoading ? (
          <Loading />
        ) : showRepos ? (
          <div className="grid gap-2">
            {repos.data?.map((repo) => (
              <RepositoryRow key={repo.id} connectionId={connection.id} repository={repo} />
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function RepositoryRow({
  connectionId,
  repository,
}: {
  readonly connectionId: string;
  readonly repository: {
    readonly id: string;
    readonly fullName: string;
    readonly private: boolean;
  };
}) {
  const client = useQueryClient();
  const [accountScope, setAccountScope] = useState<"personal" | "work">("personal");
  const imported = useMutation({
    mutationFn: () =>
      api.importRepository(connectionId, {
        repositoryId: repository.id,
        accountScope,
        description: "",
      }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["projects"] });
      toast.success("Repositorio importado como Project");
    },
  });
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
      <span className="min-w-0 truncate font-mono text-sm">
        {repository.fullName} {repository.private ? "· private" : ""}
      </span>
      <Select
        items={accountScopeOptions}
        value={accountScope}
        onValueChange={(value) => value && setAccountScope(value as typeof accountScope)}
      >
        <SelectTrigger className="w-28">
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
      {imported.isError ? <ErrorNotice error={imported.error} /> : null}
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
      toast.success("Agent Profile creado");
    },
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Nuevo perfil Codex</CardTitle>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor={nameId}>Name</FieldLabel>
            <Input id={nameId} value={name} onChange={(event) => setName(event.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor={authModeId}>Auth mode</FieldLabel>
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
            <Field>
              <FieldLabel htmlFor={credentialReferenceId}>Credential env reference</FieldLabel>
              <Input
                id={credentialReferenceId}
                className="font-mono"
                value={credentialReference}
                onChange={(event) => setCredentialReference(event.target.value)}
              />
            </Field>
          ) : (
            <p className="text-sm text-muted-foreground">
              Se usará la sesión ChatGPT configurada en Codex.
            </p>
          )}
          <Field>
            <FieldLabel htmlFor={modelId}>Model</FieldLabel>
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
              <SelectTrigger id={modelId}>
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
              <p className="text-sm text-muted-foreground">{selectedModel.description}</p>
            ) : null}
          </Field>
          <Field>
            <FieldLabel htmlFor={reasoningEffortId}>Reasoning effort</FieldLabel>
            <Select
              items={reasoningEffortOptions}
              value={reasoningEffort}
              disabled={selectedModel === undefined}
              onValueChange={(value) => value && setReasoningEffort(value)}
            >
              <SelectTrigger id={reasoningEffortId}>
                <SelectValue placeholder="Selecciona el effort" />
              </SelectTrigger>
              <SelectContent>
                {reasoningEffortOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {catalog.isLoading ? <Loading /> : null}
          {catalog.isError ? (
            <ErrorNotice error={catalog.error} retry={() => void catalog.refetch()} />
          ) : null}
          {create.isError ? <ErrorNotice error={create.error} /> : null}
          <Button
            className="justify-self-start"
            disabled={
              !name ||
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
