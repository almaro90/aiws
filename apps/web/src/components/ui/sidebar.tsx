import { PanelLeftIcon } from "lucide-react";
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from "react";
import { cn } from "../../lib/utils.ts";
import { Button } from "./button.tsx";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "./sheet.tsx";

interface SidebarContextValue {
  readonly collapsed: boolean;
  readonly mobileOpen: boolean;
  readonly setMobileOpen: (open: boolean) => void;
  readonly toggle: () => void;
}

const SidebarContext = createContext<SidebarContextValue | null>(null);

function useSidebar() {
  const value = useContext(SidebarContext);
  if (!value) throw new Error("Sidebar components must be used inside SidebarProvider.");
  return value;
}

function SidebarProvider({ children }: { readonly children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const value = useMemo(
    () => ({
      collapsed,
      mobileOpen,
      setMobileOpen,
      toggle: () => setCollapsed((current) => !current),
    }),
    [collapsed, mobileOpen],
  );
  return <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>;
}

function Sidebar({
  children,
  className,
}: {
  readonly children: ReactNode;
  readonly className?: string;
}) {
  const { collapsed, mobileOpen, setMobileOpen } = useSidebar();
  return (
    <>
      <aside
        data-slot="sidebar"
        data-collapsed={collapsed || undefined}
        className={cn(
          "fixed inset-y-0 left-0 z-30 hidden flex-col border-r bg-sidebar transition-[width] duration-200 lg:flex",
          collapsed ? "w-16" : "w-60",
          className,
        )}
      >
        {children}
      </aside>
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent
          aria-label="Navegación principal"
          side="left"
          className="w-72 gap-0 bg-sidebar p-0"
        >
          <SheetTitle className="sr-only">Navegación principal</SheetTitle>
          <SheetDescription className="sr-only">
            Rutas principales y opciones de sesión de AIWS.
          </SheetDescription>
          {children}
        </SheetContent>
      </Sheet>
    </>
  );
}

function SidebarTrigger({ className }: { readonly className?: string }) {
  const { toggle, setMobileOpen } = useSidebar();
  const [desktop, setDesktop] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(min-width: 64rem)");
    const update = () => setDesktop(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      className={className}
      aria-label={desktop ? "Contraer o expandir navegación" : "Abrir navegación"}
      onClick={() => (desktop ? toggle() : setMobileOpen(true))}
    >
      <PanelLeftIcon />
    </Button>
  );
}

function SidebarInset({ children }: { readonly children: ReactNode }) {
  const { collapsed } = useSidebar();
  return (
    <div
      className={cn(
        "min-w-0 transition-[padding] duration-200",
        collapsed ? "lg:pl-16" : "lg:pl-60",
      )}
    >
      {children}
    </div>
  );
}

export { Sidebar, SidebarInset, SidebarProvider, SidebarTrigger, useSidebar };
