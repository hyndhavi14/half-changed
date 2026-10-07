import { Suspense, lazy, useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { LAYOUT } from '../../config/layout';
import { ORBIT, type PresetKey } from '../../config/cameraPresets';
import { useMachineStore } from '../../state/machineStore';
import { Lighting } from './Lighting';
import { applyEnvIntensity } from './applyEnvIntensity';
import { Ground } from '../environment/Ground';
import { FloorMarkings } from '../environment/FloorMarkings';
import { Walls } from '../environment/Walls';
import { IndoorGroup } from '../environment/IndoorGroup';
import { Pipes } from '../environment/Pipes';
import { SupportAreas } from '../environment/SupportAreas';
import { Outside } from '../environment/Outside';
import { Machine } from '../machines/Machine';
import { Conveyors } from '../flow/Conveyors';
import { Products } from '../flow/Products';
import { EnergyFlow } from '../energy/EnergyFlow';
import { CameraRig } from '../cameras/CameraRig';
import { Picker } from '../interactions/Picker';
import { LabelProjector } from '../interactions/LabelProjector';
import { StatsProbe } from '../interactions/StatsProbe';

/** r3f-perf overlay, dev builds only: open the app with ?perf. */
const Perf =
  import.meta.env.DEV && typeof location !== 'undefined' && /[?&]perf\b/.test(location.search)
    ? lazy(() => import('r3f-perf').then((m) => ({ default: m.Perf })))
    : null;

/** Everything inside the <Canvas>. */
export function FactoryScene({
  initialView,
  showDemoProducts = true,
  hideUnmappedMachines = false,
}: {
  initialView: PresetKey;
  showDemoProducts?: boolean;
  hideUnmappedMachines?: boolean;
}) {
  const scene = useThree((s) => s.scene);
  const loaded = useMachineStore((s) => s.loaded);

  // Re-run the reflection pass once everything (incl. machines) is in the scene.
  useEffect(() => {
    applyEnvIntensity(scene);
  }, [scene, loaded]);

  return (
    <>
      <OrbitControls makeDefault enableDamping {...ORBIT} />
      <CameraRig initialView={initialView} />
      <Lighting />

      <Ground />
      <FloorMarkings />
      <Walls />
      <IndoorGroup />
      <Pipes />
      <SupportAreas />
      <Outside />

      {LAYOUT.map((d) => (
        <Machine key={d.id} id={d.id} hideUnmapped={hideUnmappedMachines} />
      ))}
      <Conveyors />
      {showDemoProducts && <Products />}
      <EnergyFlow />

      <Picker />
      <LabelProjector />
      <StatsProbe />
      {Perf && (
        <Suspense fallback={null}>
          <Perf position="bottom-right" />
        </Suspense>
      )}
    </>
  );
}
