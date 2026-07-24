import { useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { api } from "./api.ts";

export type ConnectivityState = "checking" | "online" | "offline";

interface ConnectivityValue {
  readonly state: ConnectivityState;
  readonly lastSuccessfulAt: number | null;
  readonly check: () => Promise<void>;
}

const ConnectivityContext = createContext<ConnectivityValue | null>(null);

export function ConnectivityProvider({ children }: { readonly children: ReactNode }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<ConnectivityState>("checking");
  const [lastSuccessfulAt, setLastSuccessfulAt] = useState<number | null>(null);
  const stateRef = useRef<ConnectivityState>("checking");
  const checkingRef = useRef<Promise<void> | null>(null);

  const setConnectivityState = useCallback((next: ConnectivityState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const check = useCallback(() => {
    if (checkingRef.current !== null) return checkingRef.current;
    const pending = (async () => {
      try {
        await api.health();
        const reconnected = shouldRefreshAfterHealth(stateRef.current);
        setLastSuccessfulAt(Date.now());
        setConnectivityState("online");
        if (reconnected) {
          await queryClient.refetchQueries({ type: "active" });
        }
      } catch {
        setConnectivityState("offline");
      } finally {
        checkingRef.current = null;
      }
    })();
    checkingRef.current = pending;
    return pending;
  }, [queryClient, setConnectivityState]);

  useEffect(() => {
    const offline = () => setConnectivityState("offline");
    const online = () => void check();
    window.addEventListener("offline", offline);
    window.addEventListener("online", online);
    void check();
    const interval = window.setInterval(() => void check(), 30_000);
    return () => {
      window.removeEventListener("offline", offline);
      window.removeEventListener("online", online);
      window.clearInterval(interval);
    };
  }, [check, setConnectivityState]);

  const value = useMemo(
    () => ({ state, lastSuccessfulAt, check }),
    [state, lastSuccessfulAt, check],
  );
  return <ConnectivityContext.Provider value={value}>{children}</ConnectivityContext.Provider>;
}

export function useConnectivity(): ConnectivityValue {
  const value = useContext(ConnectivityContext);
  if (value === null) {
    throw new Error("useConnectivity must be used inside ConnectivityProvider");
  }
  return value;
}

export function formatRelativeAge(timestamp: number, now = Date.now()): string {
  const elapsedSeconds = Math.max(0, Math.floor((now - timestamp) / 1_000));
  if (elapsedSeconds < 10) return "ahora";
  if (elapsedSeconds < 60) return `hace ${elapsedSeconds} s`;
  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  if (elapsedMinutes < 60) return `hace ${elapsedMinutes} min`;
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `hace ${elapsedHours} h`;
  const elapsedDays = Math.floor(elapsedHours / 24);
  return `hace ${elapsedDays} d`;
}

export function shouldRefreshAfterHealth(previous: ConnectivityState): boolean {
  return previous === "offline";
}

export function useRelativeAge(timestamp: number | null): string | null {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (timestamp === null) return;
    const interval = window.setInterval(() => setNow(Date.now()), 10_000);
    return () => window.clearInterval(interval);
  }, [timestamp]);
  return timestamp === null ? null : formatRelativeAge(timestamp, now);
}
