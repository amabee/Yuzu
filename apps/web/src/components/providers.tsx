"use client";

import { createContext, useContext, useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { useStore } from "zustand";
import { createQueryClient } from "@/lib/query-client";
import { createUiStore, type UiState } from "@/stores/ui-store";

const UiStoreContext = createContext<ReturnType<typeof createUiStore> | null>(
  null,
);

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(createQueryClient);
  const [uiStore] = useState(createUiStore);
  return (
    <QueryClientProvider client={queryClient}>
      <UiStoreContext.Provider value={uiStore}>
        {children}
      </UiStoreContext.Provider>
    </QueryClientProvider>
  );
}

export function useUiStore<T>(selector: (state: UiState) => T): T {
  const store = useContext(UiStoreContext);
  if (!store) throw new Error("UI state must be used inside Providers.");
  return useStore(store, selector);
}
