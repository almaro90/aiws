import { useInfiniteQuery } from "@tanstack/react-query";
import { CircleAlertIcon } from "lucide-react";
import { Empty, ErrorNotice, Loading, PageHeader, formatDate } from "../components/common.tsx";
import { Badge } from "../components/ui/badge.tsx";
import { Button, buttonVariants } from "../components/ui/button.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card.tsx";
import { api } from "../lib/api.ts";

export function AttentionPage() {
  const query = useInfiniteQuery({
    queryKey: ["attention"],
    queryFn: ({ pageParam }) => api.attention(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    refetchInterval: 15_000,
  });
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <>
      <PageHeader
        title="Necesita atención"
        description="Situaciones accionables deduplicadas; al resolver la causa desaparecen automáticamente."
      />
      {query.isPending ? <Loading label="Cargando bandeja" /> : null}
      {query.isError ? (
        <ErrorNotice error={query.error} retry={() => void query.refetch()} />
      ) : null}
      {!query.isPending && !query.isError && items.length === 0 ? (
        <Empty title="Nada requiere intervención">No hay causas operativas abiertas.</Empty>
      ) : null}
      <div className="grid gap-3">
        {items.map((item) => (
          <Card key={item.id}>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
                <span className="flex items-center gap-2">
                  <CircleAlertIcon className="size-4" />
                  {item.projectName ?? "AIWS"}
                  {item.taskTitle ? ` · ${item.taskTitle}` : ""}
                </span>
                <Badge variant={item.reason === "verification_failed" ? "destructive" : "outline"}>
                  {reasonLabel(item.reason)}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3">
              <p>{item.explanation}</p>
              <p className="text-xs text-muted-foreground">
                Detectado {formatDate(item.detectedAt)}
              </p>
              <a
                className={buttonVariants({ className: "justify-self-start" })}
                href={item.nextAction.href}
              >
                {item.nextAction.label}
              </a>
            </CardContent>
          </Card>
        ))}
      </div>
      {query.hasNextPage ? (
        <Button
          variant="outline"
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          {query.isFetchingNextPage ? "Cargando…" : "Cargar más"}
        </Button>
      ) : null}
    </>
  );
}

function reasonLabel(reason: string): string {
  const labels: Record<string, string> = {
    approval_pending: "Aprobación pendiente",
    questions_open: "Questions abiertas",
    run_failed: "Run fallido",
    publication_recoverable: "Publicación recuperable",
    automation_paused: "Automatización pausada",
    connection_reauthorization: "Reautorización",
    runner_unavailable: "Runner no disponible",
    verification_failed: "Verification fallida",
    delivery_checks_failed: "Checks externos fallidos",
  };
  return labels[reason] ?? reason;
}
