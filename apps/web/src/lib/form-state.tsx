import { useBlocker } from "@tanstack/react-router";
import { useEffect } from "react";
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
import { ApiError } from "./api.ts";

export function UnsavedChangesBadge({ dirty }: { readonly dirty: boolean }) {
  return dirty ? <Badge variant="outline">Cambios sin guardar</Badge> : null;
}

export function UnsavedChangesGuard({
  dirty,
  description = "Si sales ahora perderás los cambios locales que todavía no has guardado.",
}: {
  readonly dirty: boolean;
  readonly description?: string;
}) {
  const blocker = useBlocker({
    shouldBlockFn: () => dirty,
    enableBeforeUnload: dirty,
    withResolver: true,
  });

  return (
    <AlertDialog
      open={blocker.status === "blocked"}
      onOpenChange={(open) => {
        if (!open && blocker.status === "blocked") blocker.reset();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Hay cambios sin guardar</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
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
  );
}

export function focusFirstInvalid(root: ParentNode = document): boolean {
  const element = root.querySelector<HTMLElement>(
    '[aria-invalid="true"], [data-invalid="true"] input, [data-invalid="true"] textarea, [data-invalid="true"] button',
  );
  element?.focus();
  return element !== null;
}

export function firstApiErrorPath(error: unknown): string | null {
  if (!(error instanceof ApiError)) return null;
  const fields = error.details?.fields;
  if (!Array.isArray(fields)) return null;
  for (const field of fields) {
    if (
      typeof field === "object" &&
      field !== null &&
      "path" in field &&
      typeof field.path === "string"
    ) {
      return field.path;
    }
  }
  return null;
}

export function focusApiError(
  error: unknown,
  fields: Readonly<Record<string, HTMLElement | null>>,
): boolean {
  const path = firstApiErrorPath(error);
  if (path === null) return false;
  const direct = fields[path];
  const topLevel = fields[path.split(/[.[\]]/u)[0] ?? ""];
  const target = direct ?? topLevel;
  target?.focus();
  return target != null;
}

export function useFocusApiError(
  error: unknown,
  fields: Readonly<Record<string, HTMLElement | null>>,
) {
  useEffect(() => {
    if (error) focusApiError(error, fields);
  }, [error, fields]);
}
