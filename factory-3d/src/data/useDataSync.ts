import { useEffect } from 'react';
import type { MachineDataProvider } from './types';
import { useMachineStore } from '../state/machineStore';
import { useScheduleStore } from '../state/scheduleStore';

/** Provider -> store. The only place machine data enters the app. */
export function useDataSync(provider: MachineDataProvider) {
  useEffect(() => {
    let alive = true;
    const machineStore = useMachineStore.getState();
    const scheduleStore = useScheduleStore.getState();
    machineStore.reset();
    scheduleStore.reset();

    provider.getMachines().then(
      (list) => alive && useMachineStore.getState().replaceMachines(list),
      (err: unknown) => {
        if (!alive) return;
        const message = err instanceof Error ? err.message : 'Backend machines could not be loaded.';
        useMachineStore.getState().reset();
        useMachineStore.getState().setError(message);
      },
    );
    if (provider.getSchedule) {
      useScheduleStore.getState().setLoading(true);
      provider.getSchedule().then(
        (schedule) => alive && useScheduleStore.getState().setSchedule(schedule),
        (err: unknown) => {
          if (!alive) return;
          const message = err instanceof Error ? err.message : 'Backend schedule could not be loaded.';
          useScheduleStore.getState().setError(message);
        },
      );
    }

    const unsubMachines = provider.subscribe?.(
      (list) => alive && useMachineStore.getState().replaceMachines(list),
    );
    const unsubSchedule = provider.subscribeSchedule?.(
      (schedule) => alive && useScheduleStore.getState().setSchedule(schedule),
    );
    return () => {
      alive = false;
      unsubMachines?.();
      unsubSchedule?.();
    };
  }, [provider]);
}
