"use client";

import { createContext, useContext, useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { useStore } from "zustand";
import { createQueryClient } from "@/lib/query-client";
import { createUiStore, type UiState } from "@/stores/ui-store";
import { ThemeRuntime } from "@/components/appearance/theme-runtime";
import type { Mode, PublishedTheme } from "@/lib/appearance";

const UiStoreContext = createContext<ReturnType<typeof createUiStore> | null>(
  null,
);

export function Providers({
  children,
  appearance,
  mode,
}: {
  children: React.ReactNode;
  appearance: PublishedTheme;
  mode: Mode;
}) {
  const [queryClient] = useState(createQueryClient);
  const [uiStore] = useState(createUiStore);
  return (
    <QueryClientProvider client={queryClient}>
      <UiStoreContext.Provider value={uiStore}>
        <ThemeRuntime initial={appearance} initialMode={mode}>
          {children}
        </ThemeRuntime>
      </UiStoreContext.Provider>
    </QueryClientProvider>
  );
}

export function useUiStore<T>(selector: (state: UiState) => T): T {
  const store = useContext(UiStoreContext);
  if (!store) throw new Error("UI state must be used inside Providers.");
  return useStore(store, selector);
}
