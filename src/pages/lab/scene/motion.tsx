import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { useLayoutEffect, useRef, type ReactNode } from "react";
import { Color, MathUtils, Mesh, MeshStandardMaterial, Vector3, type Group } from "three";
import { add, type Vec3 } from "./layout";
import type { PartId } from "../sim/parts";

/** Respect the system "reduce motion" setting: parts jump instead of gliding. */
const reducedMotion = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
 * Moves its children to `to`, easing, and rotates them about the z axis to
 * `spin` radians. When the destination changes, the part first rises by
 * `lift` (out of its slot), travels, then lowers into place, so it never
 * passes through other parts. The canvas renders on demand, so this asks for
 * frames only while something is moving.
 */
export function Mover({ to, lift = [0, 0, 0], spin = 0, children }: { to: Vec3; lift?: Vec3; spin?: number; children: ReactNode }) {
  const ref = useRef<Group>(null);
  const queue = useRef<Vector3[]>([]);
  const started = useRef(false);
  const invalidate = useThree((s) => s.invalidate);
  const key = to.join(",");

  useLayoutEffect(() => {
    const g = ref.current;
    if (!g) return;
    const target = new Vector3(...to);
    if (!started.current || reducedMotion) {
      started.current = true;
      g.position.copy(target);
      queue.current = [];
    } else if (!g.position.equals(target)) {
      const from: Vec3 = [g.position.x, g.position.y, g.position.z];
      queue.current = [new Vector3(...add(from, lift)), new Vector3(...add(to, lift)), target];
    }
    invalidate();
    // `key` stands in for `to`; `lift` only matters when `to` changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, invalidate]);

  useLayoutEffect(() => {
    if (reducedMotion && ref.current) ref.current.rotation.z = spin;
    invalidate();
  }, [spin, invalidate]);

  useFrame((_, dt) => {
    const g = ref.current;
    if (!g) return;
    let moving = false;
    const goal = queue.current[0];
    if (goal) {
      const step = Math.min(dt, 0.05);
      g.position.set(MathUtils.damp(g.position.x, goal.x, 9, step), MathUtils.damp(g.position.y, goal.y, 9, step), MathUtils.damp(g.position.z, goal.z, 9, step));
      if (g.position.distanceTo(goal) < 0.08) {
        g.position.copy(goal);
        queue.current.shift();
      }
      moving = true;
    }
    if (Math.abs(g.rotation.z - spin) > 0.001) {
      g.rotation.z = MathUtils.damp(g.rotation.z, spin, 8, Math.min(dt, 0.05));
      if (Math.abs(g.rotation.z - spin) < 0.002) g.rotation.z = spin;
      moving = true;
    }
    if (moving) invalidate();
  });

  return <group ref={ref}>{children}</group>;
}

/** Eases a hinge (clip, lever, latch) between two angles about one axis. */
export function Hinge({ open, closedAngle = 0, openAngle, axis = "x", children, position }: {
  open: boolean;
  closedAngle?: number;
  openAngle: number;
  axis?: "x" | "y" | "z";
  children: ReactNode;
  position?: Vec3;
}) {
  const ref = useRef<Group>(null);
  const invalidate = useThree((s) => s.invalidate);
  const target = open ? openAngle : closedAngle;

  useLayoutEffect(() => {
    if (reducedMotion && ref.current) ref.current.rotation[axis] = target;
    invalidate();
  }, [target, axis, invalidate]);

  useFrame((_, dt) => {
    const g = ref.current;
    if (!g || Math.abs(g.rotation[axis] - target) < 0.001) return;
    g.rotation[axis] = MathUtils.damp(g.rotation[axis], target, 10, Math.min(dt, 0.05));
    if (Math.abs(g.rotation[axis] - target) < 0.002) g.rotation[axis] = target;
    invalidate();
  });

  return (
    <group ref={ref} position={position}>
      {children}
    </group>
  );
}

export type Highlight = "none" | "hover" | "selected" | "target";

const GLOW: Record<Highlight, { color: Color; intensity: number }> = {
  none: { color: new Color(0x000000), intensity: 0 },
  hover: { color: new Color(0x3b82f6), intensity: 0.35 },
  selected: { color: new Color(0x3b82f6), intensity: 0.75 },
  target: { color: new Color(0x22c55e), intensity: 0.55 },
};

/**
 * A clickable part. Hovering and selecting tint every material inside it
 * (keeping each material's own glow, such as fan LEDs, when not highlighted).
 */
export function Selectable({ id, highlight, onSelect, onHover, children }: {
  id: PartId;
  highlight: Highlight;
  onSelect: (id: PartId) => void;
  onHover: (id: PartId | null) => void;
  children: ReactNode;
}) {
  const ref = useRef<Group>(null);
  const invalidate = useThree((s) => s.invalidate);

  useLayoutEffect(() => {
    ref.current?.traverse((obj) => {
      if (!(obj instanceof Mesh) || !(obj.material instanceof MeshStandardMaterial)) return;
      const m = obj.material;
      m.userData.base ??= { color: m.emissive.clone(), intensity: m.emissiveIntensity };
      const glow = highlight === "none" ? m.userData.base : GLOW[highlight];
      m.emissive.copy(glow.color);
      m.emissiveIntensity = glow.intensity;
    });
    invalidate();
  }, [highlight, invalidate]);

  const stop = (e: ThreeEvent<PointerEvent | MouseEvent>) => e.stopPropagation();
  return (
    <group
      ref={ref}
      onClick={(e) => {
        stop(e);
        onSelect(id);
      }}
      onPointerOver={(e) => {
        stop(e);
        onHover(id);
        document.body.style.cursor = "pointer";
      }}
      onPointerOut={(e) => {
        stop(e);
        onHover(null);
        document.body.style.cursor = "";
      }}
    >
      {children}
    </group>
  );
}
