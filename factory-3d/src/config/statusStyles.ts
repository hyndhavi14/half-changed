import type { MachineStatus } from '../data/types';
import { STATUS_COLORS } from './palette';

export interface StatusStyle {
  label: string;
  /** sRGB hex used in the 3D scene. */
  hex: number;
  /** Animation speed factor. Machines ease towards it. */
  speed: number;
}

export const STATUS: Record<MachineStatus, StatusStyle> = {
  running: { label: 'Running', hex: STATUS_COLORS.running, speed: 1 },
  idle: { label: 'Idle', hex: STATUS_COLORS.idle, speed: 0 },
  maintenance: { label: 'Maintenance', hex: STATUS_COLORS.maintenance, speed: 0 },
  warning: { label: 'Warning', hex: STATUS_COLORS.warning, speed: 0.55 },
  offline: { label: 'Offline', hex: STATUS_COLORS.offline, speed: 0 },
  unknown: { label: 'Not reported', hex: STATUS_COLORS.offline, speed: 0 },
};

export const STATUS_ORDER: MachineStatus[] = ['running', 'idle', 'maintenance', 'warning', 'offline', 'unknown'];

/** Message set on a machine whenever its status changes to one of these. */
export const DEFAULT_MESSAGES: Partial<Record<MachineStatus, string>> = {
  maintenance: 'Planned maintenance in progress.',
  warning: 'Running outside its normal range. Check temperature and vibration.',
  offline: 'Powered off and isolated.',
};

/** UI (2D) status colour; the CSS variables carry the theme-aware tints. */
export const statusCss = (s: MachineStatus) => `var(--s-${s === 'unknown' ? 'offline' : s})`;

/** Ease rate of the speed factor: factor += (target - factor) * min(1, dt * EASE). */
export const SPEED_EASE = 2.2;
