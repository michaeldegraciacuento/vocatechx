import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef, useState } from "react";
import { GridHelper, MathUtils, Vector3 } from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { SimState } from "../sim/engine";
import type { CameraView } from "../sim/lessons";
import type { PartId } from "../sim/parts";
import { CAMERA_VIEWS } from "./layout";
import type { Highlight } from "./motion";
import { PcModel } from "./PcModel";

/**
 * Orbit/pan/zoom controls plus smooth moves to preset views. `request`
 * changes every time a view is asked for, so asking for the same view again
 * (Reset view) still moves the camera back. Dragging cancels a move.
 */
function CameraRig({ view, request }: { view: CameraView; request: number }) {
  const { camera, gl, invalidate } = useThree();
  const controls = useRef<OrbitControls | null>(null);
  const goal = useRef<{ position: Vector3; target: Vector3 } | null>(null);
  // The first view is shown at once; later ones are flown to.
  const firstView = useRef<CameraView | null>(view);

  useEffect(() => {
    const c = new OrbitControls(camera, gl.domElement);
    c.enableDamping = true;
    c.dampingFactor = 0.12;
    c.minDistance = 14;
    c.maxDistance = 170;
    c.maxPolarAngle = Math.PI * 0.62;
    c.screenSpacePanning = true;
    const start = CAMERA_VIEWS[firstView.current ?? "overview"];
    camera.position.set(...start.position);
    c.target.set(...start.target);
    c.update();
    const onChange = () => invalidate();
    const onStart = () => (goal.current = null);
    c.addEventListener("change", onChange);
    c.addEventListener("start", onStart);
    controls.current = c;
    return () => {
      c.removeEventListener("change", onChange);
      c.removeEventListener("start", onStart);
      c.dispose();
      controls.current = null;
    };
  }, [camera, gl, invalidate]);

  useEffect(() => {
    if (firstView.current === view) {
      firstView.current = null;
      return;
    }
    firstView.current = null;
    const v = CAMERA_VIEWS[view];
    goal.current = { position: new Vector3(...v.position), target: new Vector3(...v.target) };
    invalidate();
  }, [view, request, invalidate]);

  useFrame((_, dt) => {
    const c = controls.current;
    if (!c) return;
    const g = goal.current;
    if (g) {
      const step = Math.min(dt, 0.05);
      const lerp = (from: Vector3, to: Vector3) =>
        from.set(MathUtils.damp(from.x, to.x, 5, step), MathUtils.damp(from.y, to.y, 5, step), MathUtils.damp(from.z, to.z, 5, step));
      lerp(camera.position, g.position);
      lerp(c.target, g.target);
      if (camera.position.distanceTo(g.position) < 0.05 && c.target.distanceTo(g.target) < 0.05) goal.current = null;
      invalidate();
    }
    // With damping on, update() keeps emitting "change" until the motion settles.
    c.update();
  });

  return null;
}

function Floor() {
  const [grid] = useState(() => new GridHelper(260, 52, 0x334155, 0x1e293b));
  return <primitive object={grid} position={[10, -24.6, 10]} />;
}

export type LabCanvasProps = {
  state: SimState;
  view: CameraView;
  viewRequest: number;
  exploded: boolean;
  hidePanels: boolean;
  hl: (id: PartId) => Highlight;
  onSelect: (id: PartId) => void;
  onHover: (id: PartId | null) => void;
  onMiss: () => void;
  onLost: () => void;
};

export function LabCanvas({ state, view, viewRequest, exploded, hidePanels, hl, onSelect, onHover, onMiss, onLost }: LabCanvasProps) {
  return (
    <Canvas
      frameloop="demand"
      dpr={[1, 1.5]}
      camera={{ fov: 38, near: 1, far: 600, position: CAMERA_VIEWS.overview.position }}
      gl={{ antialias: true, powerPreference: "default" }}
      onPointerMissed={onMiss}
      onCreated={({ gl }) => gl.domElement.addEventListener("webglcontextlost", onLost)}
      aria-label="3D model of a desktop computer"
    >
      <color attach="background" args={["#0c111c"]} />
      <fog attach="fog" args={["#0c111c", 160, 320]} />
      <ambientLight intensity={0.22} />
      <hemisphereLight args={["#dbe7ff", "#0f172a", 0.45]} />
      <directionalLight position={[50, 80, 70]} intensity={2.4} />
      <directionalLight position={[-70, 10, 40]} intensity={0.55} color="#bcd4ff" />
      <pointLight position={[0, 6, 14]} intensity={60} distance={45} color="#9cc7ff" />
      <Floor />
      <PcModel state={state} exploded={exploded} hidePanels={hidePanels} hl={hl} onSelect={onSelect} onHover={onHover} />
      <CameraRig view={view} request={viewRequest} />
    </Canvas>
  );
}
