import { useEffect } from 'react';
import { usePlanStore } from '../../state/planStore';
import { clockIn } from '../../data/planned';

const STEP = 15 * 60_000;

/** Plan-time control: scrub or play through the stored schedule. The scene shows the planned state. */
export function PlanTimePanel() {
  const { at, start, end, timeZone, playing, set } = usePlanStore();

  useEffect(() => {
    if (!playing || start === null || end === null) return;
    const timer = window.setInterval(() => {
      const current = usePlanStore.getState().at ?? start;
      const next = current + STEP;
      if (next >= end) set({ at: end - STEP, playing: false, fromHost: false });
      else set({ at: next, fromHost: false });
    }, 250);
    return () => window.clearInterval(timer);
  }, [playing, start, end, set]);

  if (at === null || start === null || end === null) return null;
  return (
    <section className="panel plan-time" aria-label="Plan time">
      <button
        type="button"
        className="btn primary"
        onClick={() => set({ playing: !playing, fromHost: false, ...(at >= end - STEP ? { at: start } : {}) })}
      >
        {playing ? '❚❚ Pause' : '▶ Play'}
      </button>
      <label>
        <span className="plan-label">
          Planned schedule at <strong>{clockIn(timeZone, at)}</strong>
          {timeZone ? ` · ${timeZone}` : ''}
        </span>
        <input
          type="range"
          min={start}
          max={end - STEP}
          step={STEP}
          value={Math.min(Math.max(at, start), end - STEP)}
          onChange={(event) => set({ at: Number(event.target.value), playing: false, fromHost: false })}
          aria-valuetext={clockIn(timeZone, at)}
        />
      </label>
    </section>
  );
}
