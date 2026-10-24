import type { ReactNode } from "react";
import { DoubleSide, type Texture } from "three";
import type { SimState } from "../sim/engine";
import { RAM_IDS, RAM_SLOTS, type PartId } from "../sim/parts";
import {
  ATX24,
  BENCH,
  BOARD,
  CASE,
  CPU_FAN_HEADER,
  EPS8,
  EXPLODE,
  LIFT,
  M2_SLOT,
  MAT,
  PCIE_SLOT,
  SOCKET,
  add,
  ramSlotPos,
  type Vec3,
} from "./layout";
import { BRAND } from "../sim/brand";
import { Hinge, Mover, Selectable, type Highlight } from "./motion";
import { boardPcb, brandPlate, coolerCap, cpuLid, gpuBackplate, gpuSide, m2Label, psuLabel, ramSide, ramSticker, rgbGradient, sataLabel } from "./textures";

// A generic, unbranded PC built from simple shapes at real dimensions
// (centimetres). Every removable part reacts to the simulation state.

type MatProps = { color: string; metal?: number; rough?: number; emissive?: string; glow?: number; opacity?: number; map?: Texture };

function Mat({ color, metal = 0.1, rough = 0.6, emissive, glow = 0, opacity, map }: MatProps) {
  return (
    <meshStandardMaterial
      color={color}
      map={map ?? null}
      metalness={metal}
      roughness={rough}
      emissive={emissive ?? "#000000"}
      emissiveIntensity={glow}
      transparent={opacity !== undefined}
      opacity={opacity ?? 1}
      depthWrite={opacity === undefined}
      side={opacity !== undefined ? DoubleSide : undefined}
    />
  );
}

function Box({ size, at, rot, ...mat }: { size: Vec3; at: Vec3; rot?: Vec3 } & MatProps) {
  return (
    <mesh position={at} rotation={rot}>
      <boxGeometry args={size} />
      <Mat {...mat} />
    </mesh>
  );
}

function Cyl({ r, h, at, rot, segments = 20, ...mat }: { r: number; h: number; at: Vec3; rot?: Vec3; segments?: number } & MatProps) {
  return (
    <mesh position={at} rotation={rot}>
      <cylinderGeometry args={[r, r, h, segments]} />
      <Mat {...mat} />
    </mesh>
  );
}

/**
 * Printed artwork on a part's surface: a flat decal just above the face.
 * `glow` makes it light up (RGB strips), using the artwork as its own light.
 */
function Label({ size, at, rot, map, glow = 0, metal = 0.15, rough = 0.55 }: { size: [number, number]; at: Vec3; rot?: Vec3; map: Texture; glow?: number; metal?: number; rough?: number }) {
  return (
    <mesh position={at} rotation={rot}>
      <planeGeometry args={size} />
      <meshStandardMaterial
        map={map}
        metalness={metal}
        roughness={rough}
        emissive={glow ? "#ffffff" : "#000000"}
        emissiveMap={glow ? map : null}
        emissiveIntensity={glow}
        polygonOffset
        polygonOffsetFactor={-2}
      />
    </mesh>
  );
}

// Decal orientations: plane faces +z by default.
const FACE_UP: Vec3 = [-Math.PI / 2, 0, 0]; // faces +y, text runs along x
const FACE_PLUS_X: Vec3 = [0, Math.PI / 2, Math.PI / 2]; // faces +x, text runs along y
const FACE_MINUS_X: Vec3 = [0, -Math.PI / 2, -Math.PI / 2]; // faces -x, text runs along -y
const ALONG_Y: Vec3 = [0, 0, Math.PI / 2]; // faces +z, text runs along y

const C = {
  case: "#dde3ea",
  caseInner: "#c9d1dc",
  board: "#1b2230",
  slot: "#2b3445",
  metal: "#aeb6c2",
  gold: "#d4a72c",
  white: "#f1f4f8",
  dark: "#111827",
  glow: "#7dd3fc",
};

type FanStyle = { frame: string; blade: string; ring: string; hub?: string };
const WHITE_FAN: FanStyle = { frame: C.white, blade: "#f8fafc", ring: "#7dd3fc" };
const BLACK_FAN: FanStyle = { frame: "#121418", blade: "#24272d", ring: "#ff2d55", hub: "#c81e3a" };

/** A 120 mm-style fan facing along its local z axis, with a lit ring. */
function Fan({ at, rot, size = 12, style = WHITE_FAN }: { at: Vec3; rot?: Vec3; size?: number; style?: FanStyle }) {
  const blades = Array.from({ length: 7 }, (_, i) => (i / 7) * Math.PI * 2);
  const half = size / 2;
  return (
    <group position={at} rotation={rot}>
      {[
        [0, half - 0.4],
        [0, -half + 0.4],
      ].map(([x, y], i) => (
        <Box key={`h${i}`} size={[size, 0.8, 2.4]} at={[x, y, 0]} color={style.frame} rough={0.5} />
      ))}
      {[
        [half - 0.4, 0],
        [-half + 0.4, 0],
      ].map(([x, y], i) => (
        <Box key={`v${i}`} size={[0.8, size, 2.4]} at={[x, y, 0]} color={style.frame} rough={0.5} />
      ))}
      <mesh>
        <torusGeometry args={[half * 0.86, 0.18, 8, 48]} />
        <Mat color={style.ring} emissive={style.ring} glow={1.6} />
      </mesh>
      <Cyl r={1.7} h={1.2} at={[0, 0, 0]} rot={[Math.PI / 2, 0, 0]} color={style.hub ?? style.frame} metal={0.3} />
      {blades.map((a, i) => (
        <mesh key={i} position={[Math.cos(a) * half * 0.45, Math.sin(a) * half * 0.45, 0]} rotation={[0.35, 0, a]}>
          <boxGeometry args={[half * 0.72, 1.9, 0.12]} />
          <Mat color={style.blade} rough={0.4} opacity={0.88} />
        </mesh>
      ))}
    </group>
  );
}

type Props = {
  state: SimState;
  exploded: boolean;
  hidePanels: boolean;
  hl: (id: PartId) => Highlight;
  onSelect: (id: PartId) => void;
  onHover: (id: PartId | null) => void;
};

export function PcModel({ state, exploded, hidePanels, hl, onSelect, onHover }: Props) {
  const sel = (id: PartId, children: ReactNode) => (
    <Selectable id={id} highlight={hl(id)} onSelect={onSelect} onHover={onHover}>
      {children}
    </Selectable>
  );
  const ex = (v: Vec3): Vec3 => (exploded ? v : [0, 0, 0]);

  const w = CASE.maxX - CASE.minX;
  const h = CASE.maxY - CASE.minY;

  // ---- Case shell -------------------------------------------------------
  const shell = sel(
    "case",
    <group>
      <Box size={[w + 1, h + 1, 0.4]} at={[0, 0, -0.6]} color={C.caseInner} />
      <Box size={[w + 1, 0.5, CASE.depth + 1]} at={[0, CASE.maxY + 0.25, CASE.depth / 2]} color={C.case} />
      <Box size={[w + 1, 0.5, CASE.depth + 1]} at={[0, CASE.minY - 0.25, CASE.depth / 2]} color={C.case} />
      <Box size={[0.5, h + 1, CASE.depth + 1]} at={[CASE.minX - 0.25, 0, CASE.depth / 2]} color={C.case} />
      <Box size={[0.6, h + 1, CASE.depth + 1]} at={[CASE.maxX + 0.3, 0, CASE.depth / 2]} color={C.case} opacity={0.45} />
      {/* Rear expansion slot covers and I/O opening */}
      {[0, 1, 2, 3, 4, 5, 6].map((i) => (
        <Box key={i} size={[0.3, 0.9, 11]} at={[CASE.minX + 0.2, 1.4 - i * 2.03, 7]} color="#c4ccd6" metal={0.5} />
      ))}
      <Box size={[0.3, 4.6, 16]} at={[CASE.minX + 0.2, 14.5, 3]} color={C.dark} />
      {/* PSU shroud: solid top, see-through side so the PSU stays visible */}
      <Box size={[42, 0.5, CASE.depth]} at={[-2, CASE.shroudTop, CASE.depth / 2]} color={C.case} />
      <Box size={[42, 12, 0.3]} at={[-2, CASE.shroudTop - 6.2, CASE.depth - 0.3]} color={C.case} opacity={0.28} />
      {/* Feet */}
      {[-18, 18].map((x) =>
        [3, 19].map((z) => <Box key={`${x}${z}`} size={[4, 1.2, 3]} at={[x, CASE.minY - 1.1, z]} color="#9aa3b0" />),
      )}
    </group>,
  );

  const glassOn = state.sidePanel && !hidePanels;
  const glass = sel(
    "side-panel",
    <Mover to={state.sidePanel ? add([0, 0, CASE.depth + 0.4], ex(EXPLODE.sidePanel)) : BENCH.sidePanel}>
      {(glassOn || !state.sidePanel) && (
        <>
          <Box size={[w + 0.8, h + 0.8, 0.4]} at={[0, 0, 0]} color="#a9bdd1" metal={0.2} rough={0.05} opacity={0.14} />
          <Box size={[w + 0.8, 0.6, 0.5]} at={[0, h / 2 + 0.4, 0]} color={C.case} />
        </>
      )}
    </Mover>,
  );

  // ---- Motherboard (static) ---------------------------------------------
  const board = sel(
    "motherboard",
    <group>
      <Box size={[24.4, 30.5, 0.16]} at={BOARD} color="#14171c" rough={0.8} />
      <Label size={[24.4, 30.5]} at={[BOARD[0], BOARD[1], BOARD[2] + 0.081]} map={boardPcb()} rough={0.75} metal={0.05} />
      {/* VRM heatsinks around the socket, rear I/O cover, chipset heatsink */}
      <Box size={[9, 2.2, 1.4]} at={[SOCKET[0] - 1, SOCKET[1] + 5.4, SOCKET[2] + 0.7]} color="#3a3f47" metal={0.7} rough={0.35} />
      <Label size={[8.6, 1.9]} at={[SOCKET[0] - 1, SOCKET[1] + 5.4, SOCKET[2] + 1.41]} map={brandPlate(BRAND.maker)} metal={0.6} rough={0.35} />
      <Box size={[2.2, 9, 1.4]} at={[SOCKET[0] - 5.8, SOCKET[1] + 0.5, SOCKET[2] + 0.7]} color="#3a3f47" metal={0.7} rough={0.35} />
      <Box size={[3.2, 12, 2.2]} at={[BOARD[0] - 10.4, BOARD[1] + 8.5, BOARD[2] + 1.2]} color="#22262c" metal={0.5} rough={0.4} />
      <Label size={[11.4, 2.8]} at={[BOARD[0] - 10.4, BOARD[1] + 8.5, BOARD[2] + 2.31]} rot={ALONG_Y} map={brandPlate("GAMING")} metal={0.5} rough={0.4} />
      <Box size={[6.5, 5.5, 0.8]} at={[BOARD[0] + 7, BOARD[1] - 9, BOARD[2] + 0.5]} color="#3a3f47" metal={0.7} rough={0.35} />
      <Label size={[6, 1.6]} at={[BOARD[0] + 7, BOARD[1] - 9, BOARD[2] + 0.91]} map={brandPlate(BRAND.maker)} metal={0.6} rough={0.35} />
      {/* Socket base and pin field (the moving parts belong to the CPU) */}
      <Box size={[6, 7, 0.35]} at={[SOCKET[0], SOCKET[1], SOCKET[2] + 0.17]} color="#3a4352" />
      <Box size={[4.4, 3.65, 0.05]} at={[SOCKET[0], SOCKET[1], SOCKET[2] + 0.37]} color="#8a6d23" metal={0.8} rough={0.4} />
      <mesh position={[SOCKET[0] - 2.65, SOCKET[1] - 3.15, SOCKET[2] + 0.37]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.28, 0.28, 0.04, 3]} />
        <Mat color={C.gold} metal={1} rough={0.3} />
      </mesh>
      {/* RAM slots with retention clips; the key sits off-centre */}
      {RAM_SLOTS.map((slot) => {
        const [x, y, z] = ramSlotPos(slot);
        const open = state.ramClipsOpen[slot];
        return (
          <group key={slot}>
            <Box size={[0.72, 14.2, 0.75]} at={[x, y, z + 0.37]} color={slot.endsWith("2") ? "#3a4558" : C.slot} />
            <Box size={[0.3, 0.25, 0.3]} at={[x, y + 1.3, z + 0.75]} color="#94a3b8" />
            <Hinge open={open} openAngle={0.75} position={[x, y + 7.1, z + 0.2]}>
              <Box size={[0.8, 0.5, 1.6]} at={[0, 0.15, 0.6]} color="#cbd5e1" />
            </Hinge>
            <Hinge open={open} openAngle={-0.75} position={[x, y - 7.1, z + 0.2]}>
              <Box size={[0.8, 0.5, 1.6]} at={[0, -0.15, 0.6]} color="#cbd5e1" />
            </Hinge>
          </group>
        );
      })}
      {/* PCIe x16 slot and its latch */}
      <Box size={[8.9, 0.75, 0.9]} at={[PCIE_SLOT[0], PCIE_SLOT[1], PCIE_SLOT[2] + 0.45]} color={C.slot} />
      <Box size={[8.9, 0.8, 0.95]} at={[PCIE_SLOT[0], PCIE_SLOT[1], PCIE_SLOT[2] + 0.45]} color="#c0c7d1" metal={0.8} rough={0.3} opacity={0.6} />
      <Hinge open={!state.pcieLatch} openAngle={0.6} axis="y" position={[PCIE_SLOT[0] + 4.6, PCIE_SLOT[1], PCIE_SLOT[2] + 0.3]}>
        <Box size={[0.6, 0.8, 1.3]} at={[0.2, 0, 0.5]} color="#e2e8f0" />
      </Hinge>
      {/* M.2 connector and standoff */}
      <Box size={[0.6, 2.4, 0.5]} at={[M2_SLOT[0], M2_SLOT[1], M2_SLOT[2] + 0.25]} color={C.dark} />
      <Cyl r={0.25} h={0.4} at={[M2_SLOT[0] + 8.1, M2_SLOT[1], M2_SLOT[2] + 0.2]} rot={[Math.PI / 2, 0, 0]} color={C.gold} metal={1} />
      {state.m2.screw && <Cyl r={0.32} h={0.25} at={[M2_SLOT[0] + 8.1, M2_SLOT[1], M2_SLOT[2] + (state.m2.installed ? 0.62 : 0.5)]} rot={[Math.PI / 2, 0, 0]} color="#e5e7eb" metal={0.9} />}
      {/* SATA ports */}
      <Box size={[1.4, 3, 0.8]} at={[BOARD[0] + 11.4, BOARD[1] - 6, BOARD[2] + 0.5]} color={C.dark} />
    </group>,
  );

  // ---- CPU and socket mechanism -------------------------------------------
  const cpuTo = state.cpu.installed ? add(add(SOCKET, [0, 0, 0.42]), ex(EXPLODE.cpu)) : BENCH.cpu;
  const cpu = sel(
    "cpu",
    <group>
      {/* Load plate hinged on its left edge, lever along the right edge */}
      <Hinge open={state.socketOpen} openAngle={-1.9} axis="y" position={[SOCKET[0] - 2.9, SOCKET[1], SOCKET[2] + 0.5]}>
        <group position={[2.9, 0, 0]}>
          <Box size={[5.6, 0.5, 0.12]} at={[0, 2.25, 0]} color={C.metal} metal={0.85} rough={0.3} />
          <Box size={[5.6, 0.5, 0.12]} at={[0, -2.25, 0]} color={C.metal} metal={0.85} rough={0.3} />
          <Box size={[0.5, 4.5, 0.12]} at={[2.55, 0, 0]} color={C.metal} metal={0.85} rough={0.3} />
          <Box size={[0.5, 4.5, 0.12]} at={[-2.55, 0, 0]} color={C.metal} metal={0.85} rough={0.3} />
        </group>
      </Hinge>
      <Hinge open={state.socketOpen} openAngle={1.6} axis="x" position={[SOCKET[0] + 3.4, SOCKET[1] - 3.4, SOCKET[2] + 0.5]}>
        <Cyl r={0.1} h={6.6} at={[0, 3.3, 0]} color={C.metal} metal={0.9} rough={0.25} />
        <Box size={[0.25, 0.8, 0.25]} at={[0.3, 6.6, 0]} color={C.metal} metal={0.9} />
      </Hinge>
      <Mover to={cpuTo} lift={LIFT.cpu} spin={state.cpu.orientation === "aligned" ? 0 : Math.PI}>
        <Box size={[4.5, 3.75, 0.12]} at={[0, 0, 0.06]} color="#1f6f45" />
        <Box size={[3.7, 3.0, 0.3]} at={[0, 0, 0.27]} color="#c9ced6" metal={0.9} rough={0.28} />
        <Label size={[3.7, 3.0]} at={[0, 0, 0.425]} map={cpuLid()} metal={0.75} rough={0.3} />
        <mesh position={[-1.95, -1.6, 0.13]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.22, 0.22, 0.03, 3]} />
          <Mat color={C.gold} metal={1} rough={0.3} />
        </mesh>
        {state.paste === "applied" && !state.cooler.installed && <Cyl r={0.55} h={0.08} at={[0, 0, 0.46]} rot={[Math.PI / 2, 0, 0]} color="#9ca3af" rough={0.9} />}
        {state.paste === "old" && <Box size={[3.4, 2.7, 0.04]} at={[0, 0, 0.44]} color="#6b7280" rough={1} opacity={0.75} />}
      </Mover>
    </group>,
  );

  // ---- Cooler -------------------------------------------------------------
  const coolerTo = state.cooler.installed ? add(add(SOCKET, [0, 0, 0.75]), ex(EXPLODE.cooler)) : BENCH.cooler;
  const fins = Array.from({ length: 26 }, (_, i) => 2.6 + i * 0.5);
  const cooler = sel(
    "cooler",
    <Mover to={coolerTo} lift={LIFT.cooler}>
      <Box size={[4, 4, 0.8]} at={[0, 0, 0.4]} color="#b87333" metal={0.9} rough={0.3} />
      {[-1.3, -0.45, 0.45, 1.3].map((x) => (
        <Cyl key={x} r={0.3} h={14.6} at={[x, 0, 8.1]} rot={[Math.PI / 2, 0, 0]} color="#c27c4a" metal={0.9} rough={0.3} />
      ))}
      {fins.map((z) => (
        <Box key={z} size={[5.2, 12.4, 0.06]} at={[0, 0, z]} color="#d7dce3" metal={0.85} rough={0.35} />
      ))}
      <Box size={[5.4, 12.6, 0.5]} at={[0, 0, 15.6]} color="#111317" metal={0.4} rough={0.4} />
      <Label size={[12.6, 5.4]} at={[0, 0, 15.86]} rot={ALONG_Y} map={coolerCap()} metal={0.4} rough={0.4} />
      <Fan at={[3.9, 0, 9]} rot={[0, Math.PI / 2, 0]} size={12} style={BLACK_FAN} />
      {[
        [-3.4, 3.4],
        [3.4, 3.4],
        [-3.4, -3.4],
        [3.4, -3.4],
      ].map(([x, y]) => (
        <Cyl key={`${x}${y}`} r={0.3} h={0.9} at={[x, y, state.cooler.screws ? 0.5 : 1.6]} rot={[Math.PI / 2, 0, 0]} color="#e5e7eb" metal={0.9} rough={0.3} />
      ))}
      <Box size={[1.6, 1.6, 0.3]} at={[-3.4, 3.4, 0.1]} color="#9ca3af" metal={0.6} />
      <Box size={[1.6, 1.6, 0.3]} at={[3.4, -3.4, 0.1]} color="#9ca3af" metal={0.6} />
    </Mover>,
  );

  // ---- RAM ----------------------------------------------------------------
  const rams = RAM_IDS.map((id) => {
    const slot = state.ram[id].slot;
    const to = slot ? add(ramSlotPos(slot), add([0, 0, 0.55], ex(EXPLODE.ram))) : BENCH[id];
    return (
      <Selectable key={id} id={id} highlight={hl(id)} onSelect={onSelect} onHover={onHover}>
        <Mover to={to} lift={LIFT.ram} spin={state.ram[id].orientation === "aligned" ? 0 : Math.PI}>
          <Box size={[0.12, 13.3, 3.1]} at={[0, 0, 1.55]} color="#1f6f45" />
          <Box size={[0.62, 13.3, 2.9]} at={[0, 0, 1.95]} color="#15171b" metal={0.55} rough={0.35} />
          <Label size={[13.3, 2.9]} at={[0.312, 0, 1.95]} rot={FACE_PLUS_X} map={ramSide()} metal={0.5} rough={0.35} />
          <Label size={[13.3, 2.9]} at={[-0.312, 0, 1.95]} rot={FACE_MINUS_X} map={ramSticker()} metal={0.3} rough={0.5} />
          {/* RGB diffuser along the top edge */}
          <Box size={[0.5, 13.0, 0.35]} at={[0, 0, 3.55]} color="#f8fafc" opacity={0.6} />
          <Label size={[13.0, 0.5]} at={[0, 0, 3.73]} rot={ALONG_Y} map={rgbGradient()} glow={1.8} />
          <Label size={[13.0, 0.35]} at={[0.26, 0, 3.55]} rot={FACE_PLUS_X} map={rgbGradient()} glow={1.8} />
          <Label size={[13.0, 0.35]} at={[-0.26, 0, 3.55]} rot={FACE_MINUS_X} map={rgbGradient()} glow={1.8} />
          {/* Gold contacts with the off-centre key notch */}
          <Box size={[0.14, 7.9, 0.4]} at={[0, -2.7, 0.2]} color={C.gold} metal={1} rough={0.35} />
          <Box size={[0.14, 5.0, 0.4]} at={[0, 4.15, 0.2]} color={C.gold} metal={1} rough={0.35} />
        </Mover>
      </Selectable>
    );
  });

  // ---- Graphics card ------------------------------------------------------
  const gpuTo = state.gpu.installed ? add(PCIE_SLOT, ex(EXPLODE.gpu)) : BENCH.gpu;
  const gpu = sel(
    "gpu",
    <Mover to={gpuTo} lift={LIFT.gpu}>
      <Box size={[28, 0.14, 11]} at={[6.6, 0, 6.3]} color="#1f2a3a" />
      <Box size={[27, 4.1, 11]} at={[7, -2.2, 6.3]} color="#16181c" metal={0.35} rough={0.45} />
      <Label size={[27, 4.1]} at={[7, -2.2, 11.81]} map={gpuSide()} metal={0.35} rough={0.4} />
      <Label size={[25, 0.32]} at={[7, -4.05, 11.83]} map={rgbGradient()} glow={1.8} />
      <Box size={[27, 0.3, 11]} at={[7, 0.25, 6.3]} color="#1a1d22" metal={0.6} rough={0.4} />
      <Label size={[27, 11]} at={[7, 0.41, 6.3]} rot={FACE_UP} map={gpuBackplate()} metal={0.55} rough={0.4} />
      <Fan at={[2, -4.35, 6.3]} rot={[Math.PI / 2, 0, 0]} size={9} style={BLACK_FAN} />
      <Fan at={[12.4, -4.35, 6.3]} rot={[Math.PI / 2, 0, 0]} size={9} style={BLACK_FAN} />
      <Box size={[8.2, 0.5, 0.8]} at={[-2.1, 0, 0.4]} color={C.gold} metal={1} rough={0.35} />
      <Box size={[0.15, 5.5, 12.5]} at={[-7.9, -1.6, 6]} color="#c4ccd6" metal={0.7} />
      <Box size={[1, 0.15, 1.4]} at={[-7.4, 1.2, 1.4]} color="#c4ccd6" metal={0.7} />
      {state.gpu.screws &&
        [1.2, 3.2].map((z) => <Cyl key={z} r={0.3} h={0.5} at={[-7.6, 1.45, z]} color="#e5e7eb" metal={0.9} rough={0.3} />)}
      <Box size={[2.4, 1.2, 0.6]} at={[16, -1.6, 11.95]} color={C.dark} />
    </Mover>,
  );

  // The PCIe power plug stays with its PSU cable when the card comes out.
  const gpuPlugAt = add(PCIE_SLOT, [16, -1.6, 12.6]);
  const pciePower = sel(
    "pcie-power",
    <Mover to={state.gpu.installed && state.gpu.power ? add(gpuPlugAt, ex(EXPLODE.gpu)) : add(gpuPlugAt, [2, 2.5, 4])}>
      <Box size={[2.3, 1.1, 1.2]} at={[0, 0, 0]} color="#1f2937" />
      <Box size={[1.6, 0.6, 9]} at={[0, -0.2, 4.2]} color="#111827" rot={[-0.2, 0, 0]} />
    </Mover>,
  );

  // ---- M.2 drive ----------------------------------------------------------
  const m2To = state.m2.installed ? add(add(M2_SLOT, [4, 0, 0.55]), ex(EXPLODE.m2)) : BENCH.m2;
  const m2 = sel(
    "m2",
    <Mover to={m2To} lift={LIFT.m2}>
      <Box size={[8, 2.2, 0.1]} at={[0, 0, 0]} color="#1f2937" />
      <Box size={[1.9, 1.6, 0.14]} at={[-1.9, 0, 0.1]} color={C.dark} />
      <Box size={[3.6, 1.6, 0.14]} at={[1.4, 0, 0.1]} color="#0b1220" />
      <Label size={[5.6, 1.75]} at={[0.8, 0, 0.18]} map={m2Label()} rough={0.6} />
      <Box size={[0.4, 2.0, 0.08]} at={[-3.9, 0, 0]} color={C.gold} metal={1} />
    </Mover>,
  );

  // ---- Power and cables ---------------------------------------------------
  const psu = sel(
    "psu",
    <group>
      <Box size={[15, 8.6, 14]} at={[-14.5, -18.3, 8.5]} color="#17191d" metal={0.4} rough={0.5} />
      <Label size={[8.4, 7.1]} at={[-14.5, -18.3, 15.51]} map={psuLabel()} rough={0.6} />
    </group>,
  );
  const atx = sel(
    "atx-24pin",
    <group>
      <Box size={[1.1, 5.3, 1.2]} at={[ATX24[0], ATX24[1], ATX24[2] + 0.6]} color="#f1f5f9" />
      <Box size={[1.4, 5.0, 1.4]} at={[ATX24[0] + 0.2, ATX24[1], ATX24[2] + 1.8]} color="#0f172a" />
      <Box size={[3.2, 3.6, 0.9]} at={[ATX24[0] + 2.2, ATX24[1], ATX24[2] + 1.6]} color="#0f172a" />
    </group>,
  );
  const eps = sel(
    "eps-8pin",
    <group>
      <Box size={[2.2, 1.1, 1.2]} at={[EPS8[0], EPS8[1], EPS8[2] + 0.6]} color="#f1f5f9" />
      <Box size={[2.0, 1.4, 1.4]} at={[EPS8[0], EPS8[1] + 0.2, EPS8[2] + 1.8]} color="#0f172a" />
      <Box size={[1.4, 2.8, 1.2]} at={[EPS8[0], EPS8[1] + 2, EPS8[2] + 1.6]} color="#0f172a" />
    </group>,
  );
  const fanConnected = state.cooler.installed && state.cooler.fan;
  const fanHeader = sel(
    "cpu-fan-header",
    <group>
      <Box size={[1.1, 0.5, 0.6]} at={[CPU_FAN_HEADER[0], CPU_FAN_HEADER[1], CPU_FAN_HEADER[2] + 0.3]} color="#f8fafc" />
      {state.cooler.installed && (
        <Mover to={fanConnected ? add(CPU_FAN_HEADER, [0, 0, 0.9]) : add(CPU_FAN_HEADER, [0.4, -1.2, 3.5])}>
          <Box size={[1.2, 0.6, 0.6]} at={[0, 0, 0]} color="#111827" />
          <Box size={[0.25, 0.25, 6]} at={[-0.6, -0.2, 3]} color="#111827" />
        </Mover>
      )}
    </group>,
  );
  const ssd = sel(
    "sata-ssd",
    <group>
      <Box size={[10, 0.7, 7]} at={[12, CASE.shroudTop + 0.6, 8]} color="#24272d" metal={0.5} rough={0.4} />
      <Label size={[10, 7]} at={[12, CASE.shroudTop + 0.96, 8]} rot={FACE_UP} map={sataLabel()} rough={0.5} />
    </group>,
  );
  const sataPower = sel(
    "sata-power",
    <group>
      <Box size={[0.8, 0.5, 2.6]} at={[17.4, CASE.shroudTop + 0.6, 6]} color="#0f172a" />
      <Box size={[3.5, 0.15, 2.2]} at={[19.5, CASE.shroudTop + 0.4, 6]} color="#111827" />
    </group>,
  );
  const fans = sel(
    "front-fans",
    <group>
      {[
        [13.5, "#ff2d55"],
        [0.5, "#bf5af2"],
        [-12.5, "#0ac8ff"],
      ].map(([y, ring]) => (
        <Fan key={y} at={[CASE.maxX - 1.5, Number(y), 11]} rot={[0, Math.PI / 2, 0]} style={{ ...WHITE_FAN, ring: String(ring) }} />
      ))}
    </group>,
  );
  const rearFan = sel("rear-fan", <Fan at={[CASE.minX + 1.6, 14.5, 12]} rot={[0, Math.PI / 2, 0]} />);

  // ---- Workbench: power cord, wrist strap, anti-static mat ----------------
  const cord = sel(
    "power-cord",
    <group>
      <Box size={[1.4, 3, 3]} at={[CASE.minX - 0.9, -18, 8.5]} color="#0f172a" />
      <Mover to={state.power ? [CASE.minX - 2.6, -18, 8.5] : [CASE.minX - 9, CASE.minY - 1.4, 12]}>
        <Box size={[3, 2.6, 2.6]} at={[0, 0, 0]} color="#1e293b" />
        <Box size={[9, 0.6, 0.6]} at={[-5.5, 0, 0]} color="#111827" />
      </Mover>
      <Box size={[6, 9, 1.2]} at={[CASE.minX - 18, -8, 4]} color={state.power ? "#e2e8f0" : "#cbd5e1"} />
      <Box size={[0.5, 1.4, 0.5]} at={[CASE.minX - 18.8, -7, 4.9]} color="#334155" />
      <Box size={[0.5, 1.4, 0.5]} at={[CASE.minX - 17.2, -7, 4.9]} color="#334155" />
    </group>,
  );
  const strap = sel(
    "esd-strap",
    <Mover to={state.esd ? [CASE.maxX + 3, -14, 21] : [MAT.x + 17, MAT.y + 0.6, MAT.z + 10]}>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[1.6, 0.45, 10, 32]} />
        <Mat color="#2563eb" rough={0.7} />
      </mesh>
      <Box size={[0.2, 0.2, 7]} at={[0, 0, -4]} color="#facc15" />
      <Box size={[0.8, 0.8, 1.2]} at={[0, 0, -7.6]} color="#64748b" metal={0.8} />
    </Mover>,
  );
  const mat = (
    <group>
      <Box size={[MAT.width, 0.3, MAT.depth]} at={[MAT.x, MAT.y, MAT.z]} color="#1e3a5f" rough={0.95} />
      <Box size={[MAT.width, 0.32, 0.4]} at={[MAT.x, MAT.y, MAT.z + MAT.depth / 2 - 0.2]} color="#60a5fa" />
    </group>
  );

  return (
    <group>
      {shell}
      {board}
      {psu}
      {ssd}
      {sataPower}
      {atx}
      {eps}
      {fanHeader}
      {cpu}
      {cooler}
      {rams}
      {m2}
      {gpu}
      {pciePower}
      {fans}
      {rearFan}
      {glass}
      {cord}
      {mat}
      {strap}
    </group>
  );
}

