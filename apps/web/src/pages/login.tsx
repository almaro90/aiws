import { useMutation } from "@tanstack/react-query";
import { LockKeyholeIcon } from "lucide-react";
import { useId } from "react";
import { useForm } from "react-hook-form";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert.tsx";
import { Button } from "../components/ui/button.tsx";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../components/ui/card.tsx";
import { Field, FieldError, FieldGroup, FieldLabel } from "../components/ui/field.tsx";
import { Input } from "../components/ui/input.tsx";
import { api, ApiError } from "../lib/api.ts";

interface LoginFields {
  username: string;
  password: string;
}

export function LoginPage({ redirect }: { readonly redirect?: string | undefined }) {
  const usernameId = useId();
  const passwordId = useId();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFields>();
  const login = useMutation({
    mutationFn: api.login,
    onSuccess: () => window.location.assign(safeRedirect(redirect, window.location.origin)),
  });
  const rateLimited = login.error instanceof ApiError && login.error.status === 429;

  return (
    <main className="grid min-h-svh place-items-center bg-[radial-gradient(circle_at_top,var(--accent),transparent_42%)] px-4 py-10">
      <Card className="w-full max-w-sm shadow-lg">
        <CardHeader>
          <div className="mb-3 grid size-10 place-items-center rounded-xl bg-primary text-primary-foreground">
            <LockKeyholeIcon className="size-5" />
          </div>
          <CardTitle className="text-xl">Iniciar sesión</CardTitle>
          <CardDescription>Accede al workspace local de AIWS.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-5" onSubmit={handleSubmit((values) => login.mutate(values))}>
            <FieldGroup>
              <Field data-invalid={Boolean(errors.username)}>
                <FieldLabel htmlFor={usernameId}>Usuario</FieldLabel>
                <Input
                  id={usernameId}
                  autoComplete="username"
                  aria-invalid={Boolean(errors.username)}
                  aria-describedby={errors.username ? `${usernameId}-error` : undefined}
                  {...register("username", { required: "Introduce el usuario." })}
                />
                <FieldError id={`${usernameId}-error`} errors={[errors.username]} />
              </Field>
              <Field data-invalid={Boolean(errors.password)}>
                <FieldLabel htmlFor={passwordId}>Contraseña</FieldLabel>
                <Input
                  id={passwordId}
                  type="password"
                  autoComplete="current-password"
                  aria-invalid={Boolean(errors.password)}
                  aria-describedby={errors.password ? `${passwordId}-error` : undefined}
                  {...register("password", { required: "Introduce la contraseña." })}
                />
                <FieldError id={`${passwordId}-error`} errors={[errors.password]} />
              </Field>
            </FieldGroup>
            {login.isError ? (
              <Alert variant="destructive">
                <AlertTitle>
                  {rateLimited ? "Demasiados intentos" : "No se pudo iniciar sesión"}
                </AlertTitle>
                <AlertDescription>
                  {rateLimited
                    ? "Espera antes de volver a intentarlo."
                    : "Usuario o contraseña incorrectos."}
                </AlertDescription>
              </Alert>
            ) : null}
            <Button className="w-full" disabled={login.isPending} type="submit">
              {login.isPending ? "Entrando…" : "Entrar"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}

export function safeRedirect(value: string | undefined, origin: string): string {
  if (!value?.startsWith("/") || value.startsWith("//")) return "/tasks";
  try {
    const parsed = new URL(value, origin);
    return parsed.origin === origin ? `${parsed.pathname}${parsed.search}${parsed.hash}` : "/tasks";
  } catch {
    return "/tasks";
  }
}
