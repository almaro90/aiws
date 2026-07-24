import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "./components/ui/sonner.tsx";
import { TooltipProvider } from "./components/ui/tooltip.tsx";
import { UploadQueueProvider } from "./lib/upload-queue.tsx";
import { queryClient, router } from "./router.tsx";
import "./styles.css";

const root = document.getElementById("root");
if (root === null) throw new Error("Web root element is missing.");

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <UploadQueueProvider>
        <TooltipProvider>
          <RouterProvider router={router} context={{ queryClient }} />
          <Toaster position="top-right" />
        </TooltipProvider>
      </UploadQueueProvider>
    </QueryClientProvider>
  </StrictMode>,
);
