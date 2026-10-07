import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useViewStore } from '../../state/viewStore';
import { energyNow } from '../../state/energyStore';
import { std } from '../machines/kit';
import { B, G, type V3 } from '../machines/helpers';
import { TEX, cloneTex } from '../core/textures';
import { useBuilt } from '../core/useBuilt';
import { mergeStatic } from '../core/mergeStatic';

const PI = Math.PI;

interface Flow {
  mesh: THREE.Mesh;
  tex: THREE.Texture;
  mat: THREE.MeshBasicMaterial;
}

function flowTube(parent: THREE.Object3D, pts: V3[], hex: number, r: number): Flow {
  const path = new THREE.CurvePath<THREE.Vector3>();
  let len = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = new THREE.Vector3(...pts[i]),
      b = new THREE.Vector3(...pts[i + 1]);
    path.add(new THREE.LineCurve3(a, b));
    len += a.distanceTo(b);
  }
  const tex = cloneTex(TEX.dash(), len / 2.4, 1);
  const mat = new THREE.MeshBasicMaterial({ color: hex, map: tex, transparent: true, opacity: 0.95, depthWrite: false });
  mat.toneMapped = false;
  const mesh = new THREE.Mesh(new THREE.TubeGeometry(path, Math.max(24, Math.round(len * 3)), r, 8, false), mat);
  parent.add(mesh);
  return { mesh, tex, mat };
}

/** Cable trays plus glowing dashed lines: solar and grid into the energy center, then out to the hall. */
export function EnergyFlow() {
  const show = useViewStore((s) => s.showEnergy);

  const built = useBuilt(() => {
    const root = G(null);
    const tray = std(0x8d8a85, 0.8, 0.4);
    const trays: [V3, V3][] = [
      [[21, 6.05, 21.4], [28, 6.05, 21.4]],
      [[28, 6.05, 21.4], [28, 6.05, -8]],
      [[28, 6.05, -8], [-28, 6.05, -8]],
      [[28, 6.05, 4], [-28, 6.05, 4]],
    ];
    for (const [a, b] of trays) {
      const len = Math.hypot(b[0] - a[0], b[2] - a[2]);
      const g = G(root, (a[0] + b[0]) / 2, 6.0, (a[2] + b[2]) / 2);
      if (a[2] !== b[2]) g.rotation.y = PI / 2;
      B(g, len + 0.7, 0.05, 0.6, tray, 0, 0, 0);
      for (const z of [-0.3, 0.3]) B(g, len + 0.7, 0.14, 0.03, tray, 0, 0.07, z);
    }
    const tubes = G(root);
    const flows = {
      solar: flowTube(tubes, [[46, 0.3, 0], [46, 0.3, 23.8], [22.5, 0.3, 23.8], [22.5, 0.3, 22.4]], 0xffc64a, 0.13),
      grid: flowTube(tubes, [[14, 0.3, 34], [14, 0.3, 24.3], [19.5, 0.3, 24.3], [19.5, 0.3, 22.4]], 0xb98e6e, 0.13),
      dist: [
        flowTube(tubes, [[21, 2.4, 21.4], [21, 6.18, 21.4], [28, 6.18, 21.4], [28, 6.18, -8]], 0xffd77a, 0.1),
        flowTube(tubes, [[28, 6.18, -8], [-28, 6.18, -8]], 0xffd77a, 0.1),
        flowTube(tubes, [[28, 6.18, 4], [-28, 6.18, 4]], 0xffd77a, 0.1),
      ],
    };
    mergeStatic(root, [tubes]);
    return { root, tubes, flows };
  }, []);

  useFrame((_, delta) => {
    if (!useViewStore.getState().showEnergy) return;
    const dt = Math.min(delta, 0.05);
    const e = energyNow();
    const { solar, grid, dist } = built.flows;
    if (e.solar === null || e.grid === null || e.load === null) {
      solar.mat.opacity = 0.15;
      grid.mat.opacity = 0.15;
      for (const flow of dist) flow.mat.opacity = 0.15;
      return;
    }
    solar.tex.offset.x -= (dt * e.solar) / 40;
    solar.mat.opacity = e.solar > 0 ? 0.95 : 0.25;
    grid.tex.offset.x -= (dt * e.grid) / 60;
    grid.mat.opacity = e.grid > 0 ? 0.9 : 0.2;
    for (const f of dist) {
      f.tex.offset.x -= (dt * e.load) / 90;
      f.mat.opacity = e.load > 0 ? 0.95 : 0.25;
    }
  });

  built.tubes.visible = show;
  return <primitive object={built.root} />;
}
