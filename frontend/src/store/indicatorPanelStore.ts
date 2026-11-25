import { create } from 'zustand';

interface IndicatorPanelState {
  open: boolean;
  focusId: string | null;
  toggle: () => void;
  close: () => void;
  openFor: (id: string) => void;
}

export const useIndicatorPanelStore = create<IndicatorPanelState>()((set) => ({
  open: false,
  focusId: null,
  toggle: () => set((s) => ({ open: !s.open, focusId: null })),
  close: () => set({ open: false, focusId: null }),
  openFor: (id) => set({ open: true, focusId: id }),
}));
