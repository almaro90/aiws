import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { ErrorNotice, Loading, PageHeader } from "../components/common.tsx";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert.tsx";
import { Button } from "../components/ui/button.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card.tsx";
import { Checkbox } from "../components/ui/checkbox.tsx";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "../components/ui/field.tsx";
import { Input } from "../components/ui/input.tsx";
import { api } from "../lib/api.ts";

type TokenMode = "preserve" | "replace" | "clear";

export function NotificationsPage() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["notification-settings"],
    queryFn: api.notificationSettings,
  });
  const id = useId();
  const [enabled, setEnabled] = useState(false);
  const [baseUrl, setBaseUrl] = useState("https://ntfy.sh");
  const [topic, setTopic] = useState("");
  const [tokenMode, setTokenMode] = useState<TokenMode>("preserve");
  const [accessToken, setAccessToken] = useState("");

  useEffect(() => {
    if (query.data === undefined) return;
    setEnabled(query.data.enabled);
    setBaseUrl(query.data.baseUrl);
    setTopic(query.data.topic);
    setTokenMode("preserve");
    setAccessToken("");
  }, [query.data]);

  const validation = validate(enabled, baseUrl, topic, tokenMode, accessToken);
  const save = useMutation({
    mutationFn: () =>
      api.updateNotificationSettings({
        enabled,
        baseUrl,
        topic,
        ...(tokenMode === "replace"
          ? { accessToken }
          : tokenMode === "clear"
            ? { accessToken: null }
            : {}),
      }),
    onSuccess: async (settings) => {
      queryClient.setQueryData(["notification-settings"], settings);
      setTokenMode("preserve");
      setAccessToken("");
      toast.success("Configuración de notificaciones guardada");
    },
  });
  const test = useMutation({
    mutationFn: api.testNotifications,
    onSuccess: () => toast.success("Notificación de prueba entregada"),
  });

  if (query.isLoading) return <Loading label="Cargando notificaciones" />;
  if (query.isError) {
    return <ErrorNotice error={query.error} retry={() => void query.refetch()} />;
  }
  const settings = query.data;
  if (settings === undefined) return null;

  return (
    <>
      <PageHeader
        title="Notificaciones"
        description="Publica cada cambio de estado de una Task en un único topic global de ntfy."
      />
      <Alert>
        <AlertTitle>Privacidad del topic</AlertTitle>
        <AlertDescription>
          Un topic sin autenticación puede ser público. Usa un nombre difícil de adivinar o
          configura un token Bearer en un servidor ntfy con HTTPS.
        </AlertDescription>
      </Alert>
      <Card>
        <CardHeader>
          <CardTitle>Canal ntfy</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-5"
            onSubmit={(event) => {
              event.preventDefault();
              if (validation === null) save.mutate();
            }}
          >
            <Field orientation="horizontal">
              <Checkbox
                id={`${id}-enabled`}
                checked={enabled}
                onCheckedChange={setEnabled}
                disabled={save.isPending}
              />
              <div>
                <FieldLabel htmlFor={`${id}-enabled`}>Activar notificaciones</FieldLabel>
                <FieldDescription>
                  Solo se encolarán transiciones que ocurran después de activarlo.
                </FieldDescription>
              </div>
            </Field>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor={`${id}-url`}>URL base</FieldLabel>
                <Input
                  id={`${id}-url`}
                  inputMode="url"
                  value={baseUrl}
                  onChange={(event) => setBaseUrl(event.target.value)}
                  aria-invalid={validation?.field === "baseUrl"}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={`${id}-topic`}>Topic</FieldLabel>
                <Input
                  id={`${id}-topic`}
                  value={topic}
                  maxLength={64}
                  onChange={(event) => setTopic(event.target.value)}
                  aria-invalid={validation?.field === "topic"}
                />
                <FieldDescription>1–64 letras, números, guiones o guiones bajos.</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor={`${id}-token`}>Token Bearer opcional</FieldLabel>
                {settings.accessTokenConfigured && tokenMode === "preserve" ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-md border px-3 py-2 font-mono text-sm">
                      •••••••••••• configurado
                    </span>
                    <Button type="button" variant="outline" onClick={() => setTokenMode("replace")}>
                      Reemplazar
                    </Button>
                    <Button type="button" variant="outline" onClick={() => setTokenMode("clear")}>
                      Eliminar
                    </Button>
                  </div>
                ) : tokenMode === "clear" ? (
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span>El token se eliminará al guardar.</span>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setTokenMode("preserve")}
                    >
                      Conservar
                    </Button>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    <Input
                      id={`${id}-token`}
                      type="password"
                      autoComplete="new-password"
                      value={accessToken}
                      onChange={(event) => {
                        setTokenMode("replace");
                        setAccessToken(event.target.value);
                      }}
                      aria-invalid={validation?.field === "accessToken"}
                    />
                    {settings.accessTokenConfigured ? (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          setTokenMode("preserve");
                          setAccessToken("");
                        }}
                      >
                        Cancelar
                      </Button>
                    ) : null}
                  </div>
                )}
              </Field>
            </FieldGroup>
            {validation !== null ? (
              <p role="alert" className="text-sm text-destructive">
                {validation.message}
              </p>
            ) : null}
            {save.isError ? <ErrorNotice error={save.error} /> : null}
            {test.isError ? <ErrorNotice error={test.error} /> : null}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={save.isPending || validation !== null}>
                {save.isPending ? "Guardando…" : "Guardar"}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={test.isPending || save.isPending}
                onClick={() => test.mutate()}
              >
                {test.isPending ? "Enviando prueba…" : "Enviar prueba"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Última actualización: {new Date(settings.updatedAt).toLocaleString()}
            </p>
          </form>
        </CardContent>
      </Card>
    </>
  );
}

function validate(
  enabled: boolean,
  baseUrl: string,
  topic: string,
  tokenMode: TokenMode,
  accessToken: string,
): { readonly field: string; readonly message: string } | null {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return { field: "baseUrl", message: "Introduce una URL HTTP o HTTPS válida." };
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    return {
      field: "baseUrl",
      message: "La URL debe ser HTTP/HTTPS y no incluir credenciales, query ni fragment.",
    };
  }
  if ((enabled || topic.length > 0) && !/^[-_A-Za-z0-9]{1,64}$/u.test(topic)) {
    return { field: "topic", message: "El topic no tiene un formato válido." };
  }
  if (tokenMode === "replace" && accessToken.trim().length === 0) {
    return { field: "accessToken", message: "El token de reemplazo no puede estar vacío." };
  }
  if (tokenMode === "replace" && url.protocol !== "https:") {
    return { field: "accessToken", message: "El token solo puede enviarse mediante HTTPS." };
  }
  return null;
}
