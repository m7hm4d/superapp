import { create } from 'zustand';
import type { AppConfig } from '../lib/types';

interface ConfigState {
  config: AppConfig | null;
  setConfig: (config: AppConfig) => void;
}

/** كاش إعدادات المدينة والأعلام — يُملأ من ['config'] عند الإقلاع */
export const useConfigStore = create<ConfigState>((set) => ({
  config: null,
  setConfig: (config) => set({ config }),
}));

export function deliveryFeeIqd(): number {
  return useConfigStore.getState().config?.city?.deliveryFeeIqd ?? 0;
}
