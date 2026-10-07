import { useCallback } from 'react';
import * as THREE from 'three';
import { INFRA_LABELS, LAYOUT } from '../../config/layout';
import { statusCss } from '../../config/statusStyles';
import { useMachineStore } from '../../state/machineStore';
import { useViewStore } from '../../state/viewStore';
import { useEnergyStore } from '../../state/energyStore';
import { registry } from '../../three/registry';

/** Registers a label element so LabelProjector can position it each frame. */
function useLabelRef(key: string, machineId: string | null, pos?: [number, number, number]) {
  return useCallback(
    (el: HTMLDivElement | null) => {
      if (el) registry.labels.set(key, { el, machineId, pos: new THREE.Vector3(...(pos ?? [0, 0, 0])), visible: false });
      else registry.labels.delete(key);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, machineId],
  );
}

function MachineLabel({ id, stage }: { id: string; stage: string }) {
  const machine = useMachineStore((s) => s.machines[id]);
  const selected = useViewStore((s) => s.selectedId === id);
  const showIds = useViewStore((s) => s.showIds);
  const ref = useLabelRef(id, id);
  if (!machine) return null;
  return (
    <div ref={ref} className={`lbl${selected ? ' on' : ''}`}>
      <span className="dot" style={{ background: statusCss(machine.status) }} />
      <span>{stage}</span>
      {showIds && <span className="id">{id}</span>}
    </div>
  );
}

function InfraLabel({ k, text, pos }: { k: string; text: string; pos: [number, number, number] }) {
  const solar = useEnergyStore((s) => s.solarKw);
  const ref = useLabelRef(`infra:${k}`, null, pos);
  return (
    <div ref={ref} className="lbl infra">
      {k === 'solar' ? `${text} · ${solar === null ? 'Not reported' : `${solar} kW`}` : text}
    </div>
  );
}

/** HTML overlay labels (not 3D text). */
export function Labels() {
  return (
    <div className="bm-labels" aria-hidden="true">
      {LAYOUT.map((d) => (
        <MachineLabel key={d.id} id={d.id} stage={d.stage} />
      ))}
      {INFRA_LABELS.map((l) => (
        <InfraLabel key={l.key} k={l.key} text={l.text} pos={l.pos} />
      ))}
    </div>
  );
}
