import { createStore } from "zustand/vanilla";

type CrmType = "COMPANY" | "CONTACT";
export type UiState = {
  transferPanelOpen: boolean;
  setTransferPanelOpen: (open: boolean) => void;
  mobileNavigationOpen: boolean;
  setMobileNavigationOpen: (open: boolean) => void;
  /** CRM directory columns each viewer has hidden, by record type. */
  crmHiddenColumns: Record<CrmType, string[]>;
  toggleCrmColumn: (type: CrmType, key: string) => void;
  /** Open CRM record cards, bottom first. Following a link stacks a card. */
  crmStack: string[];
  openCrmRecord: (id: string, mode: "fresh" | "stack" | "replace") => void;
  /** Keep the first `depth` cards; 0 closes them all. */
  trimCrmStack: (depth: number) => void;
  reset: () => void;
};

export function createUiStore() {
  return createStore<UiState>()((set) => ({
    transferPanelOpen: false,
    setTransferPanelOpen: (open) => set({ transferPanelOpen: open }),
    mobileNavigationOpen: false,
    setMobileNavigationOpen: (open) => set({ mobileNavigationOpen: open }),
    crmHiddenColumns: {
      COMPANY: ["legalName", "address"],
      CONTACT: [],
    },
    toggleCrmColumn: (type, key) =>
      set((state) => {
        const hidden = state.crmHiddenColumns[type];
        return {
          crmHiddenColumns: {
            ...state.crmHiddenColumns,
            [type]: hidden.includes(key)
              ? hidden.filter((item) => item !== key)
              : [...hidden, key],
          },
        };
      }),
    crmStack: [],
    openCrmRecord: (id, mode) =>
      set((state) => {
        if (mode === "fresh") return { crmStack: [id] };
        if (mode === "replace")
          return { crmStack: [...state.crmStack.slice(0, -1), id] };
        // A record already open lower in the stack is brought back, not repeated.
        const at = state.crmStack.indexOf(id);
        return {
          crmStack:
            at >= 0 ? state.crmStack.slice(0, at + 1) : [...state.crmStack, id],
        };
      }),
    trimCrmStack: (depth) =>
      set((state) => ({ crmStack: state.crmStack.slice(0, depth) })),
    reset: () =>
      set({
        mobileNavigationOpen: false,
        transferPanelOpen: false,
        crmStack: [],
      }),
  }));
}
