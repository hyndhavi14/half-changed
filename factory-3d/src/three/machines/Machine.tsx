import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { LAYOUT_BY_ID, type MachineId } from '../../config/layout';
import { STATUS, SPEED_EASE } from '../../config/statusStyles';
import { SELECTION_COLOR, STATUS_COLORS } from '../../config/palette';
import { useMachineStore } from '../../state/machineStore';
import { useViewStore } from '../../state/viewStore';
import { registry, type MachineRuntime } from '../registry';
import { BUILDERS, type Anim } from './builders';
import { Kit, basic, std } from './kit';
import { B, C, G, disposeTree } from './helpers';
import { blob } from '../environment/contactShadow';
import { mergeStatic } from '../core/mergeStatic';
import type { MachineStatus } from '../../data/types';

const PI = Math.PI;
const lampHousing = std(0x2a2522, 0.4, 0.5);
const poleMat = std(0xa8a5a0, 0.85, 0.4);
const coneMat = std(0xe2622e, 0, 0.5);
const bandMat = std(0xf5f1ea, 0, 0.5);
const stripeY = std(0xe3a72f, 0, 0.5);
const stripeK = std(0x1e1b19, 0, 0.5);

function overlayPlane(parent: THREE.Object3D, mat: THREE.Material, cx: number, cz: number, sx: number, sz: number, y: number) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(sx, sz), mat);
  m.rotation.x = -PI / 2;
  m.position.set(cx, y, cz);
  parent.add(m);
}

function buildMachine(id: MachineId) {
  const def = LAYOUT_BY_ID[id];
  const kit = new Kit();
  const anims: Anim[] = [];
  const group = G(null, def.x, 0, def.z);
  group.userData.machine_id = id;
  BUILDERS[id](group, kit, anims);
  if (def.flip) group.rotation.y = PI;
  group.updateMatrixWorld(true);
  for (const an of anims) {
    an.base = an.obj.position.clone();
    an.rot = an.obj.rotation.y;
    an.phase = 0;
  }
  const box = new THREE.Box3().setFromObject(group);
  // Bake static parts; moving parts stay separate so they can animate.
  mergeStatic(group, anims.map((a) => a.obj));
  const meshes: THREE.Mesh[] = [];
  group.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
  });

  // World-space overlays: not clickable, not highlighted.
  const overlay = G(null);
  const cx = (box.min.x + box.max.x) / 2,
    cz = (box.min.z + box.max.z) / 2;
  blob(overlay, cx, cz, (box.max.x - box.min.x) * 1.15, (box.max.z - box.min.z) * 1.2);

  // Status corner marks.
  const x0 = box.min.x - 0.5,
    x1 = box.max.x + 0.5,
    z0 = box.min.z - 0.5,
    z1 = box.max.z + 0.5;
  const ringMat = basic(STATUS_COLORS.running, { transparent: true, opacity: 0.9, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
  ringMat.toneMapped = false;
  const L = Math.min(1.4, (x1 - x0) / 3),
    D = Math.min(1.4, (z1 - z0) / 3),
    w = 0.14;
  for (const [ex, sx] of [[x0, 1], [x1, -1]])
    for (const [ez, sz] of [[z0, 1], [z1, -1]]) {
      overlayPlane(overlay, ringMat, ex + (sx * L) / 2, ez, L, w, 0.03);
      overlayPlane(overlay, ringMat, ex, ez + (sz * D) / 2, w, D, 0.03);
    }

  // Selection frame.
  const selMat = basic(SELECTION_COLOR, { transparent: true, opacity: 0.95, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -5 });
  selMat.toneMapped = false;
  const sel = G(overlay);
  overlayPlane(sel, selMat, (x0 + x1) / 2, z0 - 0.3, x1 - x0 + 0.9, 0.22, 0.035);
  overlayPlane(sel, selMat, (x0 + x1) / 2, z1 + 0.3, x1 - x0 + 0.9, 0.22, 0.035);
  overlayPlane(sel, selMat, x0 - 0.3, (z0 + z1) / 2, 0.22, z1 - z0 + 0.6, 0.035);
  overlayPlane(sel, selMat, x1 + 0.3, (z0 + z1) / 2, 0.22, z1 - z0 + 0.6, 0.035);
  sel.visible = false;

  // Stack-light beacon at the corner nearest the walkway.
  const lx = def.flip ? x1 - 0.25 : x0 + 0.25,
    lz = def.flip ? z0 + 0.25 : z1 - 0.25;
  C(overlay, 0.04, 0.04, 2.9, poleMat, lx, 1.45, lz, 10);
  C(overlay, 0.14, 0.14, 0.06, poleMat, lx, 0.03, lz, 14);
  C(overlay, 0.12, 0.12, 0.12, lampHousing, lx, 2.95, lz, 16);
  const lampMat = std(0x111111, 0, 0.25, { emissive: STATUS_COLORS.running, emissiveIntensity: 2.2, transparent: true, opacity: 0.95 });
  C(overlay, 0.11, 0.11, 0.32, lampMat, lx, 3.17, lz, 20);
  C(overlay, 0.12, 0.12, 0.05, lampHousing, lx, 3.36, lz, 16);

  // Maintenance props: cones + striped barrier.
  const maint = G(overlay);
  const fz = def.flip ? z0 - 0.2 : z1 + 0.2;
  for (const mx of [x0 + 0.2, x1 - 0.2]) {
    C(maint, 0.03, 0.22, 0.7, coneMat, mx, 0.35, fz, 16);
    C(maint, 0.11, 0.145, 0.12, bandMat, mx, 0.42, fz, 16);
    B(maint, 0.5, 0.04, 0.5, coneMat, mx, 0.02, fz);
  }
  let i = 0;
  for (let x = x0 + 0.5; x < x1 - 0.5; x += 0.8) B(maint, 0.4, 0.1, 0.1, i++ % 2 ? stripeK : stripeY, x + 0.2, 0.62, fz);
  maint.visible = false;
  mergeStatic(sel);
  mergeStatic(maint);
  mergeStatic(overlay, [sel, maint]);

  const runtime: MachineRuntime = {
    id,
    flip: !!def.flip,
    index: def.index,
    box,
    center: new THREE.Vector3(cx, 1.6, cz),
    anchor: new THREE.Vector3(cx, box.max.y + 0.7, cz),
    f: 1,
    meshes,
  };
  const collider = box.clone().expandByScalar(0.3);
  return { group, overlay, kit, anims, ringMat, selMat, sel, lampMat, maint, runtime, collider };
}

function MachineGeometry({ id }: { id: MachineId }) {
  const m = useMemo(() => buildMachine(id), [id]);

  useEffect(() => {
    registry.machines[id] = m.runtime;
    registry.colliders.add(m.collider);
    return () => {
      if (registry.machines[id] === m.runtime) delete registry.machines[id];
      registry.colliders.delete(m.collider);
      disposeTree(m.group);
      disposeTree(m.overlay);
    };
  }, [id, m]);

  const last = useMemo(() => ({ status: '' as MachineStatus | '', level: -1 }), [m]);

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05);
    const t = state.clock.elapsedTime;
    const data = useMachineStore.getState().machines[id];
    if (!data) {
      m.group.visible = false;
      m.overlay.visible = false;
      return;
    }
    m.group.visible = true;
    m.overlay.visible = true;
    const { hoveredId, selectedId } = useViewStore.getState();

    // Status visuals, only when the status changes.
    if (data.status !== last.status) {
      last.status = data.status;
      const s = STATUS[data.status] ?? STATUS.offline;
      m.ringMat.color.setHex(s.hex);
      m.lampMat.emissive.setHex(s.hex);
      m.lampMat.emissiveIntensity = data.status === 'offline' ? 0.1 : 2.2;
      m.maint.visible = data.status === 'maintenance';
    }
    if (data.status === 'warning') {
      const p = 0.55 + 0.45 * Math.sin(t * 6);
      m.lampMat.emissiveIntensity = 0.4 + 0.8 * p;
      m.ringMat.opacity = 0.4 + 0.5 * p;
    } else m.ringMat.opacity = 0.7;

    // Highlight, only when the level changes.
    const h = hoveredId === id,
      s = selectedId === id;
    const level = s && h ? 0.16 : s ? 0.1 : h ? 0.12 : 0;
    if (level !== last.level) {
      last.level = level;
      m.kit.setHighlight(level);
    }
    m.sel.visible = s;
    if (s) m.selMat.opacity = 0.7 + 0.3 * Math.sin(t * 3);

    // Ease the speed factor, then drive the moving parts.
    const target = (STATUS[data.status] ?? STATUS.offline).speed;
    const rt = m.runtime;
    rt.f += (target - rt.f) * Math.min(1, dt * SPEED_EASE);
    const f = rt.f;
    for (const an of m.anims) {
      const sp = an.speed ?? 0;
      switch (an.type) {
        case 'rotX': an.obj.rotation.x += sp * f * dt; break;
        case 'rotY': an.obj.rotation.y += sp * f * dt; break;
        case 'rotZ': an.obj.rotation.z += sp * f * dt; break;
        case 'vib': an.obj.position.y = an.base!.y + Math.sin(t * 46) * 0.012 * f; break;
        case 'slideX':
          an.phase! += dt * sp * f;
          an.obj.position.x = an.base!.x + Math.sin(an.phase!) * (an.amp ?? 0);
          break;
        case 'swing':
          an.phase! += dt * sp * f;
          an.obj.rotation.y = an.rot! + Math.sin(an.phase!) * (an.amp ?? 0);
          break;
      }
    }
  });

  return (
    <>
      <primitive object={m.group} />
      <primitive object={m.overlay} />
    </>
  );
}

export function Machine({
  id,
  hideUnmapped = false,
}: {
  id: MachineId;
  hideUnmapped?: boolean;
}) {
  const mapped = useMachineStore((state) => Boolean(state.machines[id]));
  if (hideUnmapped && !mapped) return null;
  return <MachineGeometry id={id} />;
}
