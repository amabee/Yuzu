import { createStore } from "zustand/vanilla";

export type UiState = {
  transferPanelOpen: boolean;
  setTransferPanelOpen: (open: boolean) => void;
  mobileNavigationOpen: boolean;
  setMobileNavigationOpen: (open: boolean) => void;
  reset: () => void;
};

export function createUiStore() {
  return createStore<UiState>()((set) => ({
    transferPanelOpen: false,
    setTransferPanelOpen: (open) => set({ transferPanelOpen: open }),
    mobileNavigationOpen: false,
    setMobileNavigationOpen: (open) => set({ mobileNavigationOpen: open }),
    reset: () => set({ mobileNavigationOpen: false, transferPanelOpen: false }),
  }));
}
