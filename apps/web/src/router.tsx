import { QueryClient } from "@tanstack/react-query";
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  redirect,
} from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import type { QueryClient as QueryClientType } from "@tanstack/react-query";
import { lazy } from "react";
import { Empty, Loading, Shell, buttonVariants } from "./components/common.tsx";
import { api } from "./lib/api.ts";

const LoginPage = lazy(async () => ({ default: (await import("./pages/login.tsx")).LoginPage }));
const ProjectsPage = lazy(async () => ({
  default: (await import("./pages/projects.tsx")).ProjectsPage,
}));
const ProjectFormPage = lazy(async () => ({
  default: (await import("./pages/projects.tsx")).ProjectFormPage,
}));
const ProjectDetailPage = lazy(async () => ({
  default: (await import("./pages/projects.tsx")).ProjectDetailPage,
}));
const TasksPage = lazy(async () => ({ default: (await import("./pages/tasks.tsx")).TasksPage }));
const NewTaskPage = lazy(async () => ({
  default: (await import("./pages/tasks.tsx")).NewTaskPage,
}));
const TaskDetailPage = lazy(async () => ({
  default: (await import("./pages/task-detail.tsx")).TaskDetailPage,
}));
const AutomationPage = lazy(async () => ({
  default: (await import("./pages/automation.tsx")).AutomationPage,
}));
const NotificationsPage = lazy(async () => ({
  default: (await import("./pages/notifications.tsx")).NotificationsPage,
}));

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, staleTime: 15_000 },
    mutations: { retry: false },
  },
});

interface RouterContext {
  readonly queryClient: QueryClientType;
}
const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: Outlet,
  notFoundComponent: () => (
    <main className="grid min-h-svh place-items-center p-4">
      <Empty
        title="Página no encontrada"
        action={
          <Link className={buttonVariants()} to="/tasks">
            Volver a Tasks
          </Link>
        }
      >
        La ruta solicitada no existe en AIWS.
      </Empty>
    </main>
  ),
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/tasks" });
  },
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  validateSearch: (search: Record<string, unknown>) => ({
    redirect: typeof search.redirect === "string" ? search.redirect : undefined,
  }),
  component: () => <LoginPage redirect={loginRoute.useSearch().redirect} />,
});

const authenticatedRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "authenticated",
  beforeLoad: async ({ location, context }) => {
    try {
      const session = await context.queryClient.ensureQueryData({
        queryKey: ["session"],
        queryFn: api.session,
        staleTime: 5_000,
      });
      return { session };
    } catch {
      throw redirect({ to: "/login", search: { redirect: location.href } });
    }
  },
  component: () => (
    <Shell>
      <Outlet />
    </Shell>
  ),
});

const projectsRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: "/projects",
  validateSearch: (search: Record<string, unknown>) => search,
  component: () => <ProjectsPage search={projectsRoute.useSearch()} />,
});
const newProjectRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: "/projects/new",
  component: ProjectFormPage,
});
const projectRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: "/projects/$projectId",
  component: () => <ProjectDetailPage projectId={projectRoute.useParams().projectId} />,
});
const tasksRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: "/tasks",
  validateSearch: (search: Record<string, unknown>) => search,
  component: () => <TasksPage search={tasksRoute.useSearch()} />,
});
const newTaskRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: "/tasks/new",
  validateSearch: (search: Record<string, unknown>) => ({
    projectId: typeof search.projectId === "string" ? search.projectId : undefined,
  }),
  component: () => <NewTaskPage projectId={newTaskRoute.useSearch().projectId} />,
});
const taskRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: "/tasks/$taskId",
  component: () => <TaskDetailPage taskId={taskRoute.useParams().taskId} />,
});
const automationRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: "/automation",
  component: AutomationPage,
});
const notificationsRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: "/notifications",
  component: NotificationsPage,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  loginRoute,
  authenticatedRoute.addChildren([
    projectsRoute,
    newProjectRoute,
    projectRoute,
    tasksRoute,
    newTaskRoute,
    taskRoute,
    automationRoute,
    notificationsRoute,
  ]),
]);

export const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: "intent",
  defaultPendingComponent: () => <Loading label="Cargando pantalla" />,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
