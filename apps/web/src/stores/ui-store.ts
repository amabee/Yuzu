import { createStore } from "zustand/vanilla";

export type UiState = {
  mobileNavigationOpen: boolean;
  setMobileNavigationOpen: (open: boolean) => void;
  reset: () => void;
};

export function createUiStore() {
  return createStore<UiState>()((set) => ({
    mobileNavigationOpen: false,
    setMobileNavigationOpen: (open) => set({ mobileNavigationOpen: open }),
    reset: () => set({ mobileNavigationOpen: false }),
  }));
}
