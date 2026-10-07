"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useSyncExternalStore } from "react";
import { AppController, type AppState } from "@/lib/app/controller";

const AppContext = createContext<AppController | null>(null);

export function AppProvider({ children, controller: injected }: { children: ReactNode; controller?: AppController }) {
  const [controller] = useState(() => injected ?? new AppController());
  useEffect(() => {
    void controller.bootstrap();
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onTheme = () => {
      if (controller.getSnapshot().settings.theme === "system") {
        document.documentElement.classList.toggle("dark", media.matches);
      }
    };
    media.addEventListener("change", onTheme);
    return () => {
      media.removeEventListener("change", onTheme);
      controller.destroy();
    };
  }, [controller]);
  return <AppContext.Provider value={controller}>{children}</AppContext.Provider>;
}

export function useApp(): AppController {
  const controller = useContext(AppContext);
  if (!controller) throw new Error("useApp must be used inside AppProvider");
  return controller;
}

export function useAppState(): AppState {
  const controller = useApp();
  return useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
}
