import type { CameraView } from "../sim/lessons";
import type { RamSlot } from "../sim/parts";

// Positions in the scene, in centimetres. The case is a mid tower seen from its
// left side: rear (I/O, PCIe brackets) on the left, front fans on the right,
// motherboard tray at z = 0 and the glass side panel at z = 22. Sizes follow
// the real standards (ATX board 30.5 × 24.4 cm, DIMM 13.3 cm, M.2 2280, …).

export type Vec3 = [number, number, number];

export const CASE = { minX: -23, maxX: 23, minY: -23, maxY: 23, depth: 22, shroudTop: -10.5 };

/** The motherboard's centre; board parts are placed relative to it. */
export const BOARD: Vec3 = [-8.5, 5.5, 0.4];
const onBoard = (x: number, y: number, z = 0): Vec3 => [BOARD[0] + x, BOARD[1] + y, BOARD[2] + 0.16 + z];

export const SOCKET = onBoard(-2.5, 7);
export const RAM_SLOT_X: Record<RamSlot, number> = { A1: -4.6, A2: -3.7, B1: -2.8, B2: -1.9 };
export const RAM_SLOT_Y = SOCKET[1];
export const ramSlotPos = (slot: RamSlot): Vec3 => [RAM_SLOT_X[slot], RAM_SLOT_Y, onBoard(0, 0)[2]];
export const PCIE_SLOT = onBoard(-6.5, -4.5);
export const M2_SLOT = onBoard(-7, -1.6);
export const ATX24 = onBoard(11, 4);
export const EPS8 = onBoard(-10, 14);
export const CPU_FAN_HEADER = onBoard(1.8, 14.4);

/** The PSU's centre in its bay under the shroud, and the SSD on the shroud. */
export const PSU_BAY: Vec3 = [-14.5, -18.3, 8.5];
export const SSD_MOUNT: Vec3 = [12, CASE.shroudTop + 0.6, 8];

/** Where each removed part rests on the anti-static mat, to the right of the case. */
// Each pose puts the part's lowest point on the mat's surface (y ≈ -23.2).
export const BENCH = {
  "ram-1": [35, -16.55, 17] as Vec3,
  "ram-2": [38, -16.55, 17] as Vec3,
  cooler: [60, -16.9, 4] as Vec3,
  cpu: [43, -21.3, 19] as Vec3,
  gpu: [38, -18.9, -2] as Vec3,
  m2: [50, -22.1, 19] as Vec3,
  psu: [78.5, -18.95, 4] as Vec3,
  sataSsd: [79, -22.9, 19] as Vec3,
  sidePanel: [0, 0, -16] as Vec3,
};
export const MAT = { x: 57, z: 10, width: 58, depth: 28, y: -23.4 };

/** How far a part travels straight up out of its socket or slot before moving away. */
export const LIFT = {
  ram: [0, 0, 7] as Vec3,
  cooler: [0, 0, 14] as Vec3,
  cpu: [0, 0, 6] as Vec3,
  gpu: [0, 0, 10] as Vec3,
  m2: [0, 0, 3] as Vec3,
  /** The PSU slides out through the open side, the SSD lifts off the shroud. */
  psu: [0, 0, 18] as Vec3,
  ssd: [0, 4, 6] as Vec3,
};

/** Extra spacing in the exploded view, applied to installed parts. */
export const EXPLODE = {
  cooler: [0, 0, 22] as Vec3,
  cpu: [0, 0, 11] as Vec3,
  ram: [0, 0, 12] as Vec3,
  gpu: [0, -4, 18] as Vec3,
  m2: [0, 0, 7] as Vec3,
  sidePanel: [0, 0, 26] as Vec3,
};

export const CAMERA_VIEWS: Record<CameraView, { position: Vec3; target: Vec3 }> = {
  overview: { position: [24, 16, 118], target: [17, -1, 8] },
  angled: { position: [92, 34, 96], target: [12, -2, 10] },
  front: { position: [62, 6, 52], target: [14, 0, 10] },
  cpu: { position: [-6, 22, 46], target: [-11, 12.5, 4] },
  ram: { position: [3, 17, 38], target: [-3.5, 12.5, 3] },
  gpu: { position: [0, 8, 52], target: [-6, -1, 6] },
  m2: { position: [-10, 12, 30], target: [-12, 4, 1] },
  power: { position: [8, 2, 58], target: [-2, -2, 5] },
  bench: { position: [57, 12, 78], target: [57, -17, 9] },
};

export const add = (a: Vec3, b: Vec3, scale = 1): Vec3 => [a[0] + b[0] * scale, a[1] + b[1] * scale, a[2] + b[2] * scale];
