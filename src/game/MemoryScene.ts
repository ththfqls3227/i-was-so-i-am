import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Constants } from "@babylonjs/core/Engines/constants";
import { Engine } from "@babylonjs/core/Engines/engine";
import { ImageProcessingConfiguration } from "@babylonjs/core/Materials/imageProcessingConfiguration";
import { GlowLayer } from "@babylonjs/core/Layers/glowLayer";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { FresnelParameters } from "@babylonjs/core/Materials/fresnelParameters";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { DefaultRenderingPipeline } from "@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline";
import { Scene, ScenePerformancePriority } from "@babylonjs/core/scene";
import { InputBit, NEUTRAL_INPUT, type InputFrame } from "../core/input";
import { Simulation } from "../core/simulation";
import { TICK_MS, type ActorId, type ActorState, type ChamberId, type ForceObjectState, type PlateState, type Rect, type SimulationState, type Tape } from "../core/types";
import { CHAMBERS } from "../content/chambers";
import { traceRequiredHoldTicks } from "../content/tutorial-timing";

const WORLD_SCALE = 0.02;
const MAX_STEPS_PER_FRAME = 4;

/** Cinematic framing: close enough that a humanoid fills ~1/5 of frame height. */
const CAMERA_RADIUS = 13.5;
const CAMERA_RADIUS_EXIT = 12.2;
const CAMERA_ALPHA = -2.05;
/** Yaw baked into every exit tunnel; the shaft has to undo it to stay side-on. */
const EXIT_YAW = -1.02;
const CAMERA_ALPHA_EXIT = -2.14;

/**
 * Resolution ladder. Rendering starts sharp and only steps down when the
 * machine cannot hold the frame budget — a software rasterizer (or an old
 * integrated GPU) lands on the last rung instead of dropping frames.
 */
const SCALING_LADDER = [1, 1.25, 1.5] as const;

/** Each room signs its trim — inlays, rune slits, cradle rims — in one colour. */
const ROOM_ACCENT: Record<ChamberId, { diffuse: Color3; emissive: Color3 }> = {
  awakening: { diffuse: new Color3(0.05, 0.18, 0.24), emissive: new Color3(0.02, 0.3, 0.44) },
  secondSelf: { diffuse: new Color3(0.04, 0.19, 0.26), emissive: new Color3(0.018, 0.32, 0.47) },
  handNotBody: { diffuse: new Color3(0.2, 0.18, 0.26), emissive: new Color3(0.16, 0.14, 0.34) },
  crossing: { diffuse: new Color3(0.03, 0.2, 0.27), emissive: new Color3(0.015, 0.34, 0.5) },
  traceWeight: { diffuse: new Color3(0.3, 0.16, 0.05), emissive: new Color3(0.34, 0.15, 0.03) },
  handoff: { diffuse: new Color3(0.34, 0.25, 0.07), emissive: new Color3(0.36, 0.24, 0.05) },
  lastHold: { diffuse: new Color3(0.34, 0.33, 0.29), emissive: new Color3(0.4, 0.37, 0.3) },
};
const SLOW_FRAME_MS = 28;
const SCALING_SAMPLE_WINDOW = 60;

type VirtualControl = "up" | "down" | "left" | "right" | "action";

interface HumanoidRig {
  echo: boolean;
  root: TransformNode;
  meshes: AbstractMesh[];
  shimmer: Texture | null;
  leftShoulder: TransformNode;
  rightShoulder: TransformNode;
  leftElbow: TransformNode;
  rightElbow: TransformNode;
  leftHip: TransformNode;
  rightHip: TransformNode;
  leftKnee: TransformNode;
  rightKnee: TransformNode;
  position: Vector3;
  lastPosition: Vector3;
  gait: number;
}

interface WinchVisual {
  root: TransformNode;
  drum: Mesh;
  crank: TransformNode;
  rune: Mesh;
  runeMaterial: StandardMaterial;
}

interface BridgeVisual {
  root: TransformNode;
  openY: number;
  closedY: number;
}

interface WeightVisual {
  root: TransformNode;
  cyanSigil: Mesh;
  amberSigil: Mesh;
  cyanMaterial: StandardMaterial;
  amberMaterial: StandardMaterial;
}

interface ExitVisual {
  root: TransformNode;
  portal: Mesh;
  slab: Mesh;
  portalMaterial: StandardMaterial;
  light: PointLight;
  shaft: TransformNode;
  shaftMaterial: StandardMaterial;
  spillMaterial: StandardMaterial;
  beamMaterial: StandardMaterial;
}

interface TargetGuideVisual {
  root: TransformNode;
  ring: Mesh;
  arrow: Mesh;
}

interface PlateVisual {
  pad: Mesh;
  ring: Mesh;
  ringMaterial: StandardMaterial;
}

interface WorldVisuals {
  root: TransformNode;
  motes: ParticleSystem;
  burst: ParticleSystem;
  ripple: { mesh: Mesh; material: StandardMaterial };
  bridge: BridgeVisual | null;
  winch: WinchVisual | null;
  plate: PlateVisual | null;
  weight: WeightVisual | null;
  handoffOrb: Mesh | null;
  handoffDelivery: Mesh | null;
  exit: ExitVisual;
  guide: TargetGuideVisual;
}

export interface MemorySceneEvents {
  onSnapshot: (state: Readonly<SimulationState>, checksum: string) => void;
  onChamberChange: (chamberId: ChamberId) => void;
}

function material(
  scene: Scene,
  name: string,
  diffuse: Color3,
  emissive = Color3.Black(),
  alpha = 1,
  specular = diffuse.scale(0.25),
): StandardMaterial {
  const value = new StandardMaterial(name, scene);
  value.diffuseColor = diffuse;
  value.ambientColor = Color3.White();
  value.emissiveColor = emissive;
  value.specularColor = specular;
  value.alpha = alpha;
  value.backFaceCulling = alpha === 1;
  if (alpha < 1) value.needDepthPrePass = true;
  return value;
}

function shortestAngle(current: number, target: number): number {
  let delta = target - current;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return current + delta;
}

export class MemoryScene {
  readonly rendererVersion = Engine.Version;

  get rendererContext(): "webgl1" | "webgl2" {
    return this.engine.webGLVersion === 2 ? "webgl2" : "webgl1";
  }

  private simulation = new Simulation(CHAMBERS.traceWeight);
  private readonly canvas: HTMLCanvasElement;
  private readonly engine: Engine;
  private readonly scene: Scene;
  private readonly camera: ArcRotateCamera;
  private readonly pipeline: DefaultRenderingPipeline;
  private readonly glow: GlowLayer;
  private readonly shadows: ShadowGenerator;
  private visuals: WorldVisuals;
  private sharedStone: { ashlar: StandardMaterial; ashlarEdge: StandardMaterial; flagstone: StandardMaterial } | null = null;
  private chamberMaterials: StandardMaterial[] = [];
  private cameraRest = new Vector3(0.3, 1.15, 0.12);
  private cameraFocus = new Vector3(3.55, 1.24, 0.45);
  private actorVisuals = new Map<ActorId, HumanoidRig>();
  private eventsAdapter: MemorySceneEvents | null = null;
  private accumulator = 0;
  private previousAction = false;
  private recordingStarted = false;
  private pausedByPlayer = false;
  private lastFrameTime = performance.now();
  private lastRenderTime = 0;
  private readonly automatedRenderInterval = navigator.webdriver ? 1000 / 8 : 0;
  private scalingRung = 0;
  private recentFrameMs: number[] = [];
  private cinematicIdle = false;
  private presentMaterials: { jacket: StandardMaterial; skin: StandardMaterial; cloth: StandardMaterial; extremity: StandardMaterial } | null = null;
  private echoMaterials: { jacket: StandardMaterial; skin: StandardMaterial; cloth: StandardMaterial; extremity: StandardMaterial } | null = null;
  private lastPhase: SimulationState["phase"] | null = null;
  /** Trace Weight's guide turns to the weight on the same beat the card does: once the winch has been held long enough. */
  private traceGripStartTick: number | null = null;
  private traceWinchHeldLongEnough = false;
  private rippleAge = -1;
  private idleClock = 0;
  private pressedKeys = new Set<string>();
  private virtualInput = new Set<VirtualControl>();
  private readonly resizeObserver: ResizeObserver;

  constructor(parent: HTMLElement) {
    parent.style.backgroundImage = "none";
    this.canvas = document.createElement("canvas");
    this.canvas.id = "memory-canvas";
    this.canvas.setAttribute("aria-label", "I WAS, SO I AM 3D 게임 화면");
    this.canvas.tabIndex = 0;
    parent.replaceChildren(this.canvas);

    this.engine = new Engine(this.canvas, false, {
      adaptToDeviceRatio: true,
      antialias: true,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      stencil: true,
    });
    // Automation already halves its render rate; running it at full native
    // resolution with MSAA on top means every one of those frames is the most
    // expensive one the scene can produce, on a software rasteriser. Automated
    // runs start on a cheaper rung — review captures clear navigator.webdriver
    // and so keep full quality.
    if (this.automatedRenderInterval !== 0) this.scalingRung = 1;
    this.engine.setHardwareScalingLevel(SCALING_LADDER[this.scalingRung] ?? 1);
    this.scene = new Scene(this.engine);
    this.scene.performancePriority = ScenePerformancePriority.Aggressive;
    this.scene.clearColor = new Color4(0.004, 0.008, 0.014, 1);
    this.scene.ambientColor = new Color3(0.11, 0.135, 0.18);
    this.scene.fogMode = Scene.FOGMODE_EXP2;
    this.scene.fogDensity = 0.016;
    this.scene.fogColor = new Color3(0.014, 0.028, 0.05);

    this.camera = new ArcRotateCamera(
      "memory-camera",
      CAMERA_ALPHA,
      1.15,
      CAMERA_RADIUS,
      new Vector3(0.3, 1.15, 0.12),
      this.scene,
    );
    this.camera.fov = 0.78;
    this.camera.lowerRadiusLimit = 12.5;
    this.camera.upperRadiusLimit = 14.5;
    this.camera.inputs.clear();

    this.pipeline = new DefaultRenderingPipeline("memory-pipeline", true, this.scene, [this.camera]);
    this.pipeline.fxaaEnabled = true;
    this.pipeline.samples = this.automatedRenderInterval === 0 ? 4 : 1;
    this.pipeline.bloomEnabled = true;
    this.pipeline.bloomThreshold = 0.65;
    this.pipeline.bloomWeight = 0.25;
    this.pipeline.bloomKernel = 48;
    const grade = this.pipeline.imageProcessing;
    grade.toneMappingEnabled = true;
    grade.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
    grade.contrast = 1.14;
    grade.exposure = 1.4;
    grade.vignetteEnabled = true;
    grade.vignetteWeight = 1.65;
    grade.vignetteStretch = 0.35;
    grade.vignetteColor = new Color4(0.012, 0.024, 0.06, 1);
    grade.vignetteBlendMode = ImageProcessingConfiguration.VIGNETTEMODE_MULTIPLY;

    // Cool steel-blue ambient stands in for the vault's own gloom; every warm
    // value in the room comes from the doorway instead.
    const sky = new HemisphericLight("memory-sky", new Vector3(-0.2, 1, 0.35), this.scene);
    sky.diffuse = new Color3(0.36, 0.5, 0.72);
    sky.groundColor = new Color3(0.022, 0.03, 0.048);
    sky.intensity = 2.0;
    const key = new DirectionalLight("memory-key", new Vector3(-0.72, -0.66, -0.2), this.scene);
    key.position = new Vector3(9.5, 7.4, 1.6);
    key.diffuse = new Color3(1, 0.68, 0.42);
    key.specular = new Color3(0.5, 0.36, 0.2);
    key.intensity = 4.2;
    const temporal = new PointLight("temporal-fill", new Vector3(-5.7, 2.6, 1), this.scene);
    temporal.diffuse = new Color3(0.08, 0.68, 1);
    temporal.intensity = 2.8;
    temporal.range = 7;
    const living = new PointLight("living-fill", new Vector3(3.5, 3.2, -1.5), this.scene);
    living.diffuse = new Color3(1, 0.5, 0.16);
    living.intensity = 2.6;
    living.range = 7;

    this.shadows = new ShadowGenerator(1024, key);
    this.shadows.useBlurExponentialShadowMap = true;
    this.shadows.blurKernel = 8;
    this.shadows.bias = 0.0009;
    this.shadows.darkness = 0.12;
    this.glow = new GlowLayer("memory-glow", this.scene, { blurKernelSize: 24 });
    this.glow.intensity = 0.55;

    this.visuals = this.rebuildWorld();
    this.installKeyboard();
    this.updateVisuals(this.simulation.state);

    this.resizeObserver = new ResizeObserver(() => this.engine.resize());
    this.resizeObserver.observe(parent);
    this.engine.runRenderLoop(() => this.frame());
  }

  whenReady(): Promise<void> {
    return this.scene.whenReadyAsync();
  }

  actorScreenPosition(id: ActorId): { x: number; y: number } | null {
    const rig = this.actorVisuals.get(id);
    if (!rig) return null;
    const viewport = this.camera.viewport.toGlobal(this.engine.getRenderWidth(), this.engine.getRenderHeight());
    const projected = Vector3.Project(
      rig.root.position.add(new Vector3(0, 1, 0)),
      Matrix.IdentityReadOnly,
      this.scene.getTransformMatrix(),
      viewport,
    );
    const bounds = this.canvas.getBoundingClientRect();
    return {
      x: bounds.left + projected.x / this.engine.getRenderWidth() * bounds.width,
      y: bounds.top + projected.y / this.engine.getRenderHeight() * bounds.height,
    };
  }

  /** Frames recorded so far in this pass — the tutorial projects pass 2 from them. */
  get recordedFrames(): readonly InputFrame[] {
    return this.simulation.recordedFrames;
  }

  setEventsAdapter(adapter: MemorySceneEvents): void {
    this.eventsAdapter = adapter;
    this.publish();
  }

  switchChamber(chamberId: ChamberId): void {
    this.simulation = new Simulation(CHAMBERS[chamberId]);
    this.accumulator = 0;
    this.previousAction = false;
    this.recordingStarted = false;
    this.resetRecordingBeats();
    this.disposeActorVisuals();
    this.disposeWorld();
    this.visuals = this.rebuildWorld();
    this.eventsAdapter?.onChamberChange(chamberId);
    this.updateVisuals(this.simulation.state);
    this.publish();
  }

  rerecord(): void {
    this.simulation.rerecord();
    this.accumulator = 0;
    this.previousAction = false;
    this.recordingStarted = false;
    this.resetRecordingBeats();
    this.updateVisuals(this.simulation.state);
    this.publish();
  }

  /**
   * Fold time: finalize the current recording from the render layer without
   * fabricating input frames — the deterministic core owns the tape fill.
   * Returns true when the fold happened.
   */
  foldRecording(): boolean {
    if (this.pausedByPlayer) return false;
    const folded = this.simulation.foldRecording();
    if (folded) {
      this.startFoldRipple();
      this.updateVisuals(this.simulation.state);
      this.publish();
    }
    return folded;
  }

  loadTape(tape: Tape): void {
    const error = this.simulation.loadTape(tape);
    if (error) throw new Error(error);
    this.accumulator = 0;
    this.previousAction = false;
    this.recordingStarted = true;
    this.updateVisuals(this.simulation.state);
    this.publish();
  }

  setPaused(paused: boolean): void {
    this.pausedByPlayer = paused;
    if (paused) this.resetInput();
  }

  /** The title card gets a slow camera sway; play does not. */
  setCinematicIdle(active: boolean): void {
    this.cinematicIdle = active;
  }

  setVirtualControl(control: VirtualControl, active: boolean): void {
    if (active) this.virtualInput.add(control);
    else this.virtualInput.delete(control);
  }

  resetInput(): void {
    this.pressedKeys.clear();
    this.virtualInput.clear();
    this.previousAction = false;
  }

  dispose(): void {
    for (const stone of Object.values(this.sharedStone ?? {})) stone.dispose(true, true);
    this.sharedStone = null;
    for (const body of [this.presentMaterials, this.echoMaterials]) {
      for (const bodyMaterial of new Set(Object.values(body ?? {}))) bodyMaterial.dispose(true, true);
    }
    this.presentMaterials = null;
    this.echoMaterials = null;
    this.resizeObserver.disconnect();
    this.engine.stopRenderLoop();
    this.scene.dispose();
    this.engine.dispose();
  }

  /**
   * Keyboard accessibility: while an overlay button (intro/pause/ending
   * screens, success card) has focus, Space/Enter must activate that button —
   * the game must neither preventDefault nor consume the keys.
   */
  private overlayHasFocus(): boolean {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement)) return false;
    const overlay = active.closest<HTMLElement>(".screen, .success-card");
    // A dismissed overlay can briefly keep focus on its hidden button; only a
    // visible overlay may claim the keyboard.
    return overlay !== null && !overlay.hidden;
  }

  private installKeyboard(): void {
    const controlled = new Set([
      "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
      "KeyW", "KeyA", "KeyS", "KeyD", "Space", "KeyE", "KeyR",
    ]);
    window.addEventListener("keydown", (event) => {
      if (this.overlayHasFocus()) return;
      if ((event.code === "Enter" || event.code === "NumpadEnter") && !event.repeat) {
        this.foldRecording();
        return;
      }
      if (!controlled.has(event.code)) return;
      event.preventDefault();
      this.pressedKeys.add(event.code);
      // R only rerecords during live play (never on the title or while paused).
      if (event.code === "KeyR" && !event.repeat && !this.pausedByPlayer) this.rerecord();
    });
    window.addEventListener("keyup", (event) => {
      if (this.overlayHasFocus()) return;
      if (!controlled.has(event.code)) return;
      event.preventDefault();
      this.pressedKeys.delete(event.code);
    });
  }

  private frame(): void {
    const now = performance.now();
    const delta = Math.min(now - this.lastFrameTime, 100);
    this.lastFrameTime = now;
    let steps = 0;
    if (!this.pausedByPlayer) {
      this.accumulator += delta;
      while (this.accumulator >= TICK_MS && steps < MAX_STEPS_PER_FRAME) {
        const frame = this.sampleInput();
        if (this.simulation.state.phase === "recording" && !this.recordingStarted && frame === NEUTRAL_INPUT) {
          this.accumulator -= TICK_MS;
          steps += 1;
          continue;
        }
        this.recordingStarted = true;
        this.simulation.step(frame);
        this.trackRecordingBeats();
        this.accumulator -= TICK_MS;
        steps += 1;
      }
      if (steps === MAX_STEPS_PER_FRAME && this.accumulator >= TICK_MS) this.accumulator = 0;
    }
    const shouldRender = this.automatedRenderInterval === 0 || now - this.lastRenderTime >= this.automatedRenderInterval;
    if (shouldRender) {
      this.idleClock += delta;
      this.updateVisuals(this.simulation.state);
      this.scene.render();
      this.trackFramePacing(delta);
      this.lastRenderTime = now;
    }
    if (steps > 0) this.publish();
  }

  private sampleInput(): InputFrame {
    const action = this.pressedKeys.has("Space") || this.pressedKeys.has("KeyE") || this.virtualInput.has("action");
    let frame = NEUTRAL_INPUT;
    if (this.pressedKeys.has("ArrowUp") || this.pressedKeys.has("KeyW") || this.virtualInput.has("up")) frame |= InputBit.Up;
    if (this.pressedKeys.has("ArrowDown") || this.pressedKeys.has("KeyS") || this.virtualInput.has("down")) frame |= InputBit.Down;
    if (this.pressedKeys.has("ArrowLeft") || this.pressedKeys.has("KeyA") || this.virtualInput.has("left")) frame |= InputBit.Left;
    if (this.pressedKeys.has("ArrowRight") || this.pressedKeys.has("KeyD") || this.virtualInput.has("right")) frame |= InputBit.Right;
    if (action) frame |= InputBit.ActionHeld;
    if (action && !this.previousAction) frame |= InputBit.ActionPressed;
    if (!action && this.previousAction) frame |= InputBit.ActionReleased;
    this.previousAction = action;
    return frame;
  }

  private publish(): void {
    this.eventsAdapter?.onSnapshot(this.simulation.state, this.simulation.checksum());
  }

  private worldPoint(x: number, y: number, height = 0): Vector3 {
    const chamber = this.simulation.chamber;
    return new Vector3(
      (x - chamber.world.width / 2) * WORLD_SCALE,
      height,
      (chamber.world.height / 2 - y) * WORLD_SCALE,
    );
  }

  private rectCenter(rect: Rect, height = 0): Vector3 {
    return this.worldPoint(rect.x + rect.width / 2, rect.y + rect.height / 2, height);
  }

  private registerMesh(mesh: Mesh, root: TransformNode, castShadow = true): Mesh {
    mesh.parent = root;
    mesh.isPickable = false;
    mesh.receiveShadows = true;
    if (castShadow) this.shadows.addShadowCaster(mesh);
    return mesh;
  }

  private seededRandom(seed: number): () => number {
    let value = seed >>> 0;
    return (): number => {
      value = (value * 1664525 + 1013904223) >>> 0;
      return value / 0xffffffff;
    };
  }

  /**
   * Sobel a greyscale heightmap into a tangent-space normal map. The stone is
   * procedural, so its relief has to be derived rather than authored — this is
   * what gives the block courses a lit edge instead of a painted-on line.
   */
  private normalMapFromHeight(name: string, height: Uint8ClampedArray, size: number, strength: number): DynamicTexture {
    const scratch = this.heightContext(size);
    const image = scratch.createImageData(size, size);
    const at = (x: number, y: number): number => {
      const wrappedX = (x + size) % size;
      const wrappedY = (y + size) % size;
      return height[(wrappedY * size + wrappedX) * 4] ?? 0;
    };
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const dx = (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1))
          - (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1));
        const dy = (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1))
          - (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1));
        let nx = dx / 1020 * strength;
        let ny = dy / 1020 * strength;
        const length = Math.sqrt(nx * nx + ny * ny + 1);
        nx /= length;
        ny /= length;
        const offset = (y * size + x) * 4;
        image.data[offset] = (nx * 0.5 + 0.5) * 255;
        image.data[offset + 1] = (ny * 0.5 + 0.5) * 255;
        image.data[offset + 2] = (1 / length * 0.5 + 0.5) * 255;
        image.data[offset + 3] = 255;
      }
    }
    scratch.putImageData(image, 0, 0);
    const texture = new DynamicTexture(name, { width: size, height: size }, this.scene, false);
    texture.getContext().drawImage(scratch.canvas, 0, 0);
    texture.update(false);
    texture.wrapU = Texture.WRAP_ADDRESSMODE;
    texture.wrapV = Texture.WRAP_ADDRESSMODE;
    return texture;
  }

  private heightContext(size: number): CanvasRenderingContext2D {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("2D canvas context unavailable");
    return context;
  }

  /**
   * Running-bond ashlar: four large blocks across, half-offset per course, each
   * with its own value. Luminance stays inside the 0.24-0.33 band measured as
   * readable in the C1.5b lighting pass, so the room reads as stone without the
   * fill having to compensate.
   */
  private createAshlarMaterial(name: string, seed: number, scale: number): StandardMaterial {
    const size = 1024;
    const columns = 4;
    const rows = 6;
    const blockWidth = size / columns;
    const blockHeight = size / rows;
    const joint = 7;
    const random = this.seededRandom(seed);
    const texture = new DynamicTexture(`${name}-albedo`, { width: size, height: size }, this.scene, false);
    const context = texture.getContext();
    const height = this.heightContext(size);

    // Values are pre-rolled per course so a block split across the tile seam
    // gets the same treatment on both sides.
    const shades: number[][] = [];
    for (let row = 0; row < rows; row += 1) {
      const course: number[] = [];
      for (let column = 0; column < columns; column += 1) course.push(74 + Math.floor(random() * 24));
      shades.push(course);
    }

    context.fillStyle = "#262c31";
    context.fillRect(0, 0, size, size);
    height.fillStyle = "#3c3c3c";
    height.fillRect(0, 0, size, size);

    for (let row = 0; row < rows; row += 1) {
      const offset = (row % 2) * blockWidth / 2;
      for (let column = -1; column <= columns; column += 1) {
        const wrapped = ((column % columns) + columns) % columns;
        const shade = shades[row]?.[wrapped] ?? 70;
        const x = column * blockWidth + offset + joint / 2;
        const y = row * blockHeight + joint / 2;
        const width = blockWidth - joint;
        const depth = blockHeight - joint;
        context.fillStyle = `rgb(${shade}, ${shade + 4}, ${shade + 7})`;
        context.fillRect(x, y, width, depth);

        // Fake AO: each block darkens toward its own joint.
        const inset = Math.min(width, depth) * 0.2;
        for (const [gx0, gy0, gx1, gy1, w, h] of [
          [x, y, x + inset, y, inset, depth],
          [x + width, y, x + width - inset, y, -inset, depth],
          [x, y, x, y + inset, width, inset],
          [x, y + depth, x, y + depth - inset, width, -inset],
        ] as const) {
          const shadow = context.createLinearGradient(gx0, gy0, gx1, gy1);
          shadow.addColorStop(0, "rgba(0, 0, 0, 0.22)");
          shadow.addColorStop(1, "rgba(0, 0, 0, 0)");
          context.fillStyle = shadow;
          context.fillRect(Math.min(gx0, gx0 + w), Math.min(gy0, gy0 + h), Math.abs(w), Math.abs(h));
        }

        const relief = 150 + Math.floor((shade - 74) * 2.2);
        height.fillStyle = `rgb(${relief}, ${relief}, ${relief})`;
        height.fillRect(x, y, width, depth);

        // A few blocks are chipped along one edge.
        if (random() > 0.72) {
          const chipWidth = 18 + random() * 46;
          const chipX = x + random() * (width - chipWidth);
          context.fillStyle = "rgba(12, 15, 18, 0.5)";
          context.fillRect(chipX, y + depth - 12, chipWidth, 12);
          height.fillStyle = "rgb(88, 88, 88)";
          height.fillRect(chipX, y + depth - 12, chipWidth, 12);
        }
      }
    }

    // Damp rises from the base of every course; verdigris collects with it.
    const damp = context.createLinearGradient(0, size * 0.52, 0, size);
    damp.addColorStop(0, "rgba(10, 20, 24, 0)");
    damp.addColorStop(1, "rgba(9, 22, 26, 0.28)");
    context.fillStyle = damp;
    context.fillRect(0, size * 0.52, size, size * 0.48);
    for (let index = 0; index < 26; index += 1) {
      const x = random() * size;
      const y = size * 0.45 + random() * size * 0.55;
      const radius = 12 + random() * 46;
      const moss = context.createRadialGradient(x, y, 1, x, y, radius);
      moss.addColorStop(0, `rgba(58, 92, 74, ${0.16 + random() * 0.2})`);
      moss.addColorStop(1, "rgba(58, 92, 74, 0)");
      context.fillStyle = moss;
      context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    }

    for (let index = 0; index < 34; index += 1) {
      const startX = random() * size;
      const startY = random() * size;
      context.beginPath();
      height.beginPath();
      context.moveTo(startX, startY);
      height.moveTo(startX, startY);
      let cursorX = startX;
      let cursorY = startY;
      for (let segment = 1; segment <= 3; segment += 1) {
        cursorX += (random() - 0.5) * 70;
        cursorY += (random() - 0.5) * 52;
        context.lineTo(cursorX, cursorY);
        height.lineTo(cursorX, cursorY);
      }
      context.strokeStyle = `rgba(6, 9, 11, ${0.3 + random() * 0.34})`;
      context.lineWidth = 1 + random() * 2.4;
      context.stroke();
      height.strokeStyle = "rgba(70, 70, 70, 0.8)";
      height.lineWidth = 2 + random() * 2;
      height.stroke();
    }

    for (let index = 0; index < 2400; index += 1) {
      const grain = random() > 0.5 ? 168 : 18;
      context.fillStyle = `rgba(${grain}, ${grain}, ${grain}, ${0.015 + random() * 0.03})`;
      context.fillRect(random() * size, random() * size, 1 + random() * 2, 1 + random() * 2);
    }

    texture.wrapU = Texture.WRAP_ADDRESSMODE;
    texture.wrapV = Texture.WRAP_ADDRESSMODE;
    texture.uScale = scale;
    texture.vScale = scale;
    texture.update(false);

    const stone = material(this.scene, name, new Color3(0.86, 0.88, 0.9), Color3.Black(), 1, new Color3(0.07, 0.08, 0.09));
    stone.diffuseTexture = texture;
    const relief = this.normalMapFromHeight(`${name}-normal`, height.getImageData(0, 0, size, size).data, size, 2.6);
    relief.uScale = scale;
    relief.vScale = scale;
    stone.bumpTexture = relief;
    stone.specularPower = 28;
    return stone;
  }

  /** Large worn flagstones for the chamber floor, with the same value band. */
  private createFlagstoneMaterial(name: string, seed: number, scale: number): StandardMaterial {
    const size = 1024;
    const cells = 3;
    const cell = size / cells;
    const joint = 9;
    const random = this.seededRandom(seed);
    const texture = new DynamicTexture(`${name}-albedo`, { width: size, height: size }, this.scene, false);
    const context = texture.getContext();
    const height = this.heightContext(size);
    context.fillStyle = "#22272a";
    context.fillRect(0, 0, size, size);
    height.fillStyle = "#3a3a3a";
    height.fillRect(0, 0, size, size);

    for (let row = 0; row < cells; row += 1) {
      for (let column = 0; column < cells; column += 1) {
        const shade = 72 + Math.floor(random() * 20);
        const x = column * cell + joint / 2;
        const y = row * cell + joint / 2;
        const span = cell - joint;
        context.fillStyle = `rgb(${shade}, ${shade + 3}, ${shade + 5})`;
        context.fillRect(x, y, span, span);
        const inset = span * 0.2;
        for (const [gx0, gy0, gx1, gy1, w, h] of [
          [x, y, x + inset, y, inset, span],
          [x + span, y, x + span - inset, y, -inset, span],
          [x, y, x, y + inset, span, inset],
          [x, y + span, x, y + span - inset, span, -inset],
        ] as const) {
          const shadow = context.createLinearGradient(gx0, gy0, gx1, gy1);
          shadow.addColorStop(0, "rgba(0, 0, 0, 0.2)");
          shadow.addColorStop(1, "rgba(0, 0, 0, 0)");
          context.fillStyle = shadow;
          context.fillRect(Math.min(gx0, gx0 + w), Math.min(gy0, gy0 + h), Math.abs(w), Math.abs(h));
        }
        const relief = 150 + Math.floor((shade - 72) * 2);
        height.fillStyle = `rgb(${relief}, ${relief}, ${relief})`;
        height.fillRect(x, y, span, span);
      }
    }

    for (let index = 0; index < 24; index += 1) {
      const startX = random() * size;
      const startY = random() * size;
      context.beginPath();
      height.beginPath();
      context.moveTo(startX, startY);
      height.moveTo(startX, startY);
      let cursorX = startX;
      let cursorY = startY;
      for (let segment = 1; segment <= 3; segment += 1) {
        cursorX += (random() - 0.5) * 90;
        cursorY += (random() - 0.5) * 90;
        context.lineTo(cursorX, cursorY);
        height.lineTo(cursorX, cursorY);
      }
      context.strokeStyle = `rgba(7, 10, 12, ${0.26 + random() * 0.3})`;
      context.lineWidth = 1 + random() * 2;
      context.stroke();
      height.strokeStyle = "rgba(76, 76, 76, 0.8)";
      height.lineWidth = 2;
      height.stroke();
    }
    for (let index = 0; index < 2000; index += 1) {
      const grain = random() > 0.5 ? 160 : 18;
      context.fillStyle = `rgba(${grain}, ${grain}, ${grain}, ${0.014 + random() * 0.028})`;
      context.fillRect(random() * size, random() * size, 1 + random() * 2, 1 + random() * 2);
    }

    texture.wrapU = Texture.WRAP_ADDRESSMODE;
    texture.wrapV = Texture.WRAP_ADDRESSMODE;
    texture.uScale = scale;
    texture.vScale = scale;
    texture.update(false);
    const stone = material(this.scene, name, new Color3(0.86, 0.88, 0.9), Color3.Black(), 1, new Color3(0.1, 0.11, 0.12));
    stone.diffuseTexture = texture;
    const relief = this.normalMapFromHeight(`${name}-normal`, height.getImageData(0, 0, size, size).data, size, 2.2);
    relief.uScale = scale;
    relief.vScale = scale;
    stone.bumpTexture = relief;
    stone.specularPower = 42;
    return stone;
  }

  private createBox(name: string, rect: Rect, height: number, boxMaterial: StandardMaterial, root: TransformNode, y = height / 2): Mesh {
    const mesh = MeshBuilder.CreateBox(name, {
      width: rect.width * WORLD_SCALE,
      depth: rect.height * WORLD_SCALE,
      height,
    }, this.scene);
    mesh.position = this.rectCenter(rect, y);
    mesh.material = boxMaterial;
    return this.registerMesh(mesh, root);
  }

  /**
   * Framing follows the route: the camera rests on the midpoint between spawn
   * and exit, so a room whose action sits off the world centre still lands in
   * frame at the closer cinematic radius.
   */
  private updateCameraFraming(): void {
    const chamber = this.simulation.chamber;
    const exitCenterX = chamber.exit.x + chamber.exit.width / 2;
    const exitCenterY = chamber.exit.y + chamber.exit.height / 2;
    const rest = this.worldPoint((chamber.spawn.x + exitCenterX) / 2, (chamber.spawn.y + exitCenterY) / 2, 1.15);
    const exitPoint = this.worldPoint(exitCenterX, exitCenterY, 1.24);
    this.cameraRest = rest;
    this.cameraFocus = Vector3.Lerp(rest, exitPoint, 0.72);
    this.camera.target = rest.clone();
  }

  /**
   * The masonry is generated once and shared by every chamber. Regenerating it
   * per room cost 50-95ms of main-thread canvas work at the switch, and the
   * fixed-step loop answers a stall that long by discarding simulation time.
   */
  private stoneMaterials(): { ashlar: StandardMaterial; ashlarEdge: StandardMaterial; flagstone: StandardMaterial } {
    if (!this.sharedStone) {
      this.sharedStone = {
        ashlar: this.createAshlarMaterial("basalt", 1861, 2.2),
        ashlarEdge: this.createAshlarMaterial("basalt-edge", 6577, 1.6),
        flagstone: this.createFlagstoneMaterial("chamber-floor", 3391, 2.6),
      };
    }
    return this.sharedStone;
  }

  /**
   * Rebuilds the chamber and takes ownership of whatever materials it created,
   * so the world can be torn down without taking the shared masonry with it.
   */
  private rebuildWorld(): WorldVisuals {
    // Prime the shared masonry first so the snapshot below counts it as
    // pre-existing: claimed as chamber-owned, it would be disposed by the very
    // first room switch and every later room would draw with dead textures.
    this.stoneMaterials();
    const existing = new Set(this.scene.materials);
    const visuals = this.buildWorld();
    this.chamberMaterials = this.scene.materials.filter(
      (candidate): candidate is StandardMaterial => candidate instanceof StandardMaterial && !existing.has(candidate),
    );
    return visuals;
  }

  private buildWorld(): WorldVisuals {
    const root = new TransformNode(`world-${this.simulation.chamber.id}`, this.scene);
    const chamber = this.simulation.chamber;
    this.updateCameraFraming();
    const roomWidth = chamber.world.width * WORLD_SCALE;
    const roomDepth = chamber.world.height * WORLD_SCALE;
    const { ashlar, ashlarEdge, flagstone } = this.stoneMaterials();
    const metal = material(this.scene, "aged-metal", new Color3(0.09, 0.105, 0.12), Color3.Black(), 1, new Color3(0.34, 0.36, 0.38));
    // Inlaid metal, not a light source: the trim earns its glint from the key
    // and the bloom rather than from emissive of its own.
    const bronze = material(this.scene, "memory-bronze", new Color3(0.27, 0.185, 0.082), new Color3(0.006, 0.003, 0.001), 1, new Color3(0.2, 0.14, 0.06));
    bronze.specularPower = 18;
    const voidMaterial = material(this.scene, "memory-void", new Color3(0.001, 0.003, 0.007), new Color3(0, 0.012, 0.03));
    const nicheDark = material(this.scene, "vault-niche", new Color3(0.012, 0.016, 0.022), Color3.Black(), 1, Color3.Black());
    const cyan = material(this.scene, "temporal-cyan", new Color3(0.025, 0.24, 0.32), new Color3(0.02, 0.68, 0.94));
    // Half the emissive of the signal cyan and outside the glow layer: the
    // depth markers must never compete with the echo for the eye.
    const chasmRune = material(this.scene, "chasm-rune", new Color3(0.02, 0.14, 0.19), new Color3(0.01, 0.32, 0.46));
    const cyanGlass = material(this.scene, "temporal-glass", new Color3(0.015, 0.18, 0.24), new Color3(0.02, 0.38, 0.56), 0.48);
    const roomAccent = ROOM_ACCENT[chamber.id];
    const accent = material(this.scene, "room-accent", roomAccent.diffuse, roomAccent.emissive, 0.85);
    const amber = material(this.scene, "living-amber", new Color3(0.55, 0.25, 0.065), new Color3(0.2, 0.07, 0.008));
    const white = material(this.scene, "exit-white", new Color3(0.82, 0.78, 0.67), new Color3(0.9, 0.82, 0.62), 0.82);

    const lowerVault = MeshBuilder.CreateBox("lower-vault-floor", {
      width: roomWidth + 10,
      depth: roomDepth + 8,
      height: 0.4,
    }, this.scene);
    lowerVault.position = new Vector3(1.8, -2.15, 0.8);
    lowerVault.material = ashlarEdge;
    this.registerMesh(lowerVault, root, false);
    for (const [index, x] of [-7.5, -3.5, 0.5, 4.5, 8.5, 12.5].entries()) {
      const lowerPier = MeshBuilder.CreateBox(`lower-vault-pier-${index}`, { width: 0.8, depth: 1.1, height: 4.2 }, this.scene);
      lowerPier.position = new Vector3(x, -3.9, 3.9 - index % 2 * 1.2);
      lowerPier.material = ashlar;
      this.registerMesh(lowerPier, root, false);
    }

    const foundation = MeshBuilder.CreateBox("chamber-foundation", {
      width: roomWidth - 0.3,
      depth: roomDepth - 0.3,
      height: 0.24,
    }, this.scene);
    foundation.position.y = -0.16;
    foundation.material = ashlar;
    this.registerMesh(foundation, root, false);

    // One flagstone deck instead of fifteen strips: the courses now come from
    // the texture, so the floor no longer needs to be built out of planks.
    const floor = MeshBuilder.CreateBox("chamber-floor", {
      width: roomWidth - 0.42,
      depth: roomDepth - 0.42,
      height: 0.06,
    }, this.scene);
    floor.position.y = -0.01;
    floor.material = flagstone;
    this.registerMesh(floor, root, false);
    for (const z of [-1.82, 1.82]) {
      const inlay = MeshBuilder.CreateBox(`bronze-inlay-${z}`, { width: roomWidth - 1.2, depth: 0.036, height: 0.022 }, this.scene);
      inlay.position = new Vector3(0, 0.028, z);
      inlay.material = accent;
      this.registerMesh(inlay, root, false);
    }

    // Boundary walls become real vault walls on the two sides the camera reads
    // as background. The near/right pair stays low so nothing occludes play.
    for (const [index, wall] of chamber.walls.entries()) {
      // The boundary set is four full-span walls, and the side pair also starts
      // at y === 0 — so identity needs the span, not just the corner.
      const spansWidth = wall.width >= chamber.world.width - 1;
      const spansDepth = wall.height >= chamber.world.height - 1;
      const isBack = wall.y === 0 && spansWidth;
      const isFront = wall.y + wall.height === chamber.world.height && spansWidth;
      const isLeft = wall.x === 0 && spansDepth;
      const isRight = wall.x + wall.width === chamber.world.width && spansDepth;
      const boundary = isBack || isLeft || isFront || isRight;
      // Only the far wall rises. The camera sits off the near-left corner, so a
      // tall left wall stands between the lens and the room — verified in
      // captures, where it swallowed half the frame.
      let wallHeight = 0.48;
      if (isBack) wallHeight = 3.05;
      else if (boundary) wallHeight = 0.72;
      this.createBox(`wall-${index}`, wall, wallHeight, boundary ? ashlarEdge : ashlar, root, wallHeight / 2);
      if (!boundary) this.createBox(`wall-cap-${index}`, wall, 0.08, bronze, root, wallHeight + 0.04);
      if (isBack) {
        this.createBox(`wall-course-${index}`, wall, 0.14, ashlar, root, wallHeight + 0.07);
      }
    }

    const backWall = MeshBuilder.CreateBox("memory-vault-backdrop", { width: roomWidth + 12, depth: 0.48, height: 8 }, this.scene);
    backWall.position = new Vector3(2.2, 3.65, roomDepth / 2 - 0.18);
    backWall.material = ashlar;
    this.registerMesh(backWall, root);

    // Engaged columns with recessed niches between them, flush to the vault
    // wall — the floating beams and free-standing pillars are gone.
    for (let index = 0; index < 8; index += 1) {
      const x = -7.2 + index * 2.65;
      const columnZ = roomDepth / 2 - 0.62;
      const columnHeight = 3.7 + (index % 2) * 0.3;
      const column = MeshBuilder.CreateBox(`vault-column-${index}`, { width: 0.82, depth: 0.62, height: columnHeight }, this.scene);
      column.position = new Vector3(x, columnHeight / 2, columnZ);
      column.material = ashlarEdge;
      this.registerMesh(column, root);
      const base = MeshBuilder.CreateBox(`vault-column-base-${index}`, { width: 1.02, depth: 0.78, height: 0.34 }, this.scene);
      base.position = new Vector3(x, 0.17, columnZ);
      base.material = ashlar;
      this.registerMesh(base, root);
      const capital = MeshBuilder.CreateBox(`vault-column-capital-${index}`, { width: 1.02, depth: 0.8, height: 0.22 }, this.scene);
      capital.position = new Vector3(x, columnHeight + 0.11, columnZ);
      capital.material = ashlar;
      this.registerMesh(capital, root);

      if (index < 7) {
        const nicheX = x + 1.325;
        const niche = MeshBuilder.CreateBox(`vault-niche-${index}`, { width: 1.5, depth: 0.34, height: 2.15 }, this.scene);
        niche.position = new Vector3(nicheX, 1.42, columnZ + 0.2);
        niche.material = nicheDark;
        this.registerMesh(niche, root, false);
        const nicheArch = MeshBuilder.CreateCylinder(`vault-niche-arch-${index}`, {
          diameter: 1.5,
          height: 0.34,
          tessellation: 18,
        }, this.scene);
        nicheArch.rotation.x = Math.PI / 2;
        nicheArch.position = new Vector3(nicheX, 2.5, columnZ + 0.2);
        nicheArch.material = nicheDark;
        this.registerMesh(nicheArch, root, false);
        // Only the two nearest the time well carry a lit rune slit.
        if (index < 2) {
          const slit = MeshBuilder.CreateBox(`wall-rune-${index}`, { width: 0.16, depth: 0.05, height: 1.15 }, this.scene);
          slit.position = new Vector3(nicheX, 1.5, columnZ + 0.02);
          slit.material = accent;
          this.registerMesh(slit, root, false);
        }
      }
    }

    const spawn = this.worldPoint(chamber.spawn.x, chamber.spawn.y, 0.04);
    const portalDisc = MeshBuilder.CreateCylinder("time-well", { diameter: 1.5, height: 0.08, tessellation: 48 }, this.scene);
    portalDisc.position = spawn;
    portalDisc.material = cyanGlass;
    this.registerMesh(portalDisc, root, false);
    const portalRing = MeshBuilder.CreateTorus("time-well-ring", { diameter: 1.68, thickness: 0.08, tessellation: 64 }, this.scene);
    portalRing.position = spawn.add(new Vector3(0, 0.08, 0));
    portalRing.material = cyan;
    this.registerMesh(portalRing, root, false);
    this.glow.addIncludedOnlyMesh(portalDisc);
    this.glow.addIncludedOnlyMesh(portalRing);
    this.createPortalGlyph(spawn, cyan, root);
    const spawnLight = new PointLight("spawn-light", spawn.add(new Vector3(0, 1.2, 0)), this.scene);
    spawnLight.diffuse = new Color3(0.05, 0.7, 1);
    spawnLight.intensity = 3.6;
    spawnLight.range = 5;
    spawnLight.parent = root;

    // The door mechanism wears the dressing its room means: the two crossing
    // rooms span a chasm, the handoff gate is a portcullis in a wall.
    let bridge: BridgeVisual | null = null;
    if (chamber.door) {
      if (chamber.door.id.includes("gate")) {
        bridge = this.createPortcullis(chamber.door.rect, ashlarEdge, metal, bronze, root);
      } else if (chamber.door.id.includes("door")) {
        bridge = this.createHeavyPortal(chamber.door.rect, ashlarEdge, metal, bronze, root);
      } else {
        bridge = this.createChasmBridge(chamber.door.rect, roomDepth, ashlarEdge, metal, bronze, cyan, cyanGlass, chasmRune, voidMaterial, root);
      }
    }

    const winch = chamber.hold ? this.createWinch(chamber.hold.x, chamber.hold.y, chamber.door?.rect ?? null, metal, bronze, cyan, root) : null;
    const plate = chamber.plate ? this.createPlate(chamber.plate, ashlarEdge, root) : null;
    const weight = chamber.forceObject ? this.createWeight(chamber.forceObject, ashlarEdge, metal, bronze, cyan, amber, root) : null;

    let handoffOrb: Mesh | null = null;
    let handoffDelivery: Mesh | null = null;
    if (chamber.handoff) {
      handoffOrb = MeshBuilder.CreateSphere("memory-core", { diameter: 0.54, segments: 24 }, this.scene);
      handoffOrb.position = this.worldPoint(chamber.handoff.x, chamber.handoff.y, 0.72);
      handoffOrb.material = cyan;
      this.registerMesh(handoffOrb, root, false);
      this.glow.addIncludedOnlyMesh(handoffOrb);
      handoffDelivery = this.createBox("memory-cradle", chamber.handoff.delivery, 0.42, metal, root, 0.2);
      // A receptacle has to look like it takes something: rim, then a dark mouth.
      const cradleCenter = this.rectCenter(chamber.handoff.delivery, 0);
      const cradleWidth = chamber.handoff.delivery.width * WORLD_SCALE;
      const cradleDepth = chamber.handoff.delivery.height * WORLD_SCALE;
      for (const [index, offset] of [
        [-cradleWidth / 2, 0],
        [cradleWidth / 2, 0],
        [0, -cradleDepth / 2],
        [0, cradleDepth / 2],
      ].entries()) {
        const rim = MeshBuilder.CreateBox(`handoff-rim-${index}`, {
          width: offset[1] === 0 ? 0.16 : cradleWidth + 0.16,
          depth: offset[1] === 0 ? cradleDepth + 0.16 : 0.16,
          height: 0.34,
        }, this.scene);
        rim.position = cradleCenter.add(new Vector3(offset[0] ?? 0, 0.5, offset[1] ?? 0));
        rim.material = accent;
        this.registerMesh(rim, root);
      }
      const mouth = MeshBuilder.CreateBox("handoff-mouth", {
        width: cradleWidth - 0.1,
        depth: cradleDepth - 0.1,
        height: 0.06,
      }, this.scene);
      mouth.position = cradleCenter.add(new Vector3(0, 0.44, 0));
      mouth.material = nicheDark;
      this.registerMesh(mouth, root, false);
    }

    const exit = this.createExit(chamber.exit, ashlarEdge, bronze, white, root);
    const guide = this.createTargetGuide(root);
    const moteTexture = this.createMoteTexture();
    const motes = this.createDustMotes(exit.root, moteTexture);
    const burst = this.createEchoBurst(moteTexture);
    const ripple = this.createFoldRipple(root);
    if (!this.prefersReducedMotion()) motes.start();
    // Architecture materials never change after the chamber is built; the
    // signal materials (cyan/amber/portal/rune) keep animating their emissive.
    for (const stoneLike of [metal, bronze, voidMaterial, nicheDark]) stoneLike.freeze();
    return { root, motes, burst, ripple, bridge, winch, plate, weight, handoffOrb, handoffDelivery, exit, guide };
  }

  /**
   * A pressure plate: a slab set into the floor with a ring that lights while
   * someone stands on it. Built from the chamber's own rect, so a room gets one
   * exactly when its data has one.
   */
  private createPlate(plate: PlateState, stone: StandardMaterial, root: TransformNode): PlateVisual {
    const pad = this.createBox(`${plate.id}-pad`, plate, 0.13, stone, root, 0.065);
    const ringMaterial = material(this.scene, `${plate.id}-ring`, new Color3(0.06, 0.14, 0.18), new Color3(0.02, 0.16, 0.24));
    const ring = MeshBuilder.CreateTorus(`${plate.id}-ring`, {
      diameter: Math.min(plate.width, plate.height) * WORLD_SCALE * 0.68,
      thickness: 0.075,
      tessellation: 40,
    }, this.scene);
    ring.position = this.rectCenter(plate, 0.15);
    ring.material = ringMaterial;
    this.registerMesh(ring, root, false);
    this.glow.addIncludedOnlyMesh(ring);
    return { pad, ring, ringMaterial };
  }

  /**
   * Crossing rooms: a chasm the bridge deck rises out of. The void reads by
   * contrast, so its edge trim is thin and its depth carries a low fog band
   * rather than more glowing geometry.
   */
  private createChasmBridge(
    rect: Rect,
    roomDepth: number,
    stone: StandardMaterial,
    metal: StandardMaterial,
    bronze: StandardMaterial,
    cyan: StandardMaterial,
    cyanGlass: StandardMaterial,
    chasmRune: StandardMaterial,
    voidMaterial: StandardMaterial,
    root: TransformNode,
  ): BridgeVisual {
    const center = this.rectCenter(rect, 0);
    const chasm = MeshBuilder.CreateBox("memory-chasm", { width: 1.8, depth: roomDepth - 0.65, height: 0.05 }, this.scene);
    chasm.position = new Vector3(center.x, -3.45, 0);
    chasm.material = voidMaterial;
    this.registerMesh(chasm, root, false);
    for (const offset of [-0.96, 0.96]) {
      const chasmWall = MeshBuilder.CreateBox(`chasm-wall-${offset}`, { width: 0.2, depth: roomDepth - 0.65, height: 6.4 }, this.scene);
      chasmWall.position = new Vector3(center.x + offset, -3.15, 0);
      chasmWall.material = stone;
      this.registerMesh(chasmWall, root, false);
    }
    // A hairline of temporal light along the lip, not a neon strip.
    for (const offset of [-0.86, 0.86]) {
      const edge = MeshBuilder.CreateBox(`chasm-edge-${offset}`, { width: 0.032, depth: roomDepth - 0.65, height: 0.045 }, this.scene);
      edge.position = new Vector3(center.x + offset, 0.055, 0);
      edge.material = cyan;
      this.registerMesh(edge, root, false);
    }
    for (const z of [-2.9, 0, 2.9]) {
      const depthRune = MeshBuilder.CreateCylinder(`chasm-rune-${z}`, { diameter: 0.12, height: 3.8, tessellation: 10 }, this.scene);
      depthRune.position = new Vector3(center.x, -2.05, z);
      depthRune.material = chasmRune;
      this.registerMesh(depthRune, root, false);
    }
    const bridgeRoot = new TransformNode("bridge-root", this.scene);
    bridgeRoot.parent = root;
    bridgeRoot.position = new Vector3(center.x, -1.15, center.z);
    const deckDepth = Math.max(1.35, rect.height * WORLD_SCALE * 0.92);
    const deck = MeshBuilder.CreateBox("bridge-deck", { width: 1.92, depth: deckDepth, height: 0.18 }, this.scene);
    deck.material = metal;
    this.registerMesh(deck, bridgeRoot);
    for (const z of [-deckDepth / 2 + 0.08, deckDepth / 2 - 0.08]) {
      const rail = MeshBuilder.CreateBox(`bridge-rail-${z}`, { width: 1.86, depth: 0.055, height: 0.07 }, this.scene);
      rail.position = new Vector3(0, 0.72, z);
      rail.material = bronze;
      this.registerMesh(rail, bridgeRoot);
      for (const x of [-0.82, 0, 0.82]) {
        const post = MeshBuilder.CreateBox(`bridge-post-${x}-${z}`, { width: 0.055, depth: 0.055, height: 0.7 }, this.scene);
        post.position = new Vector3(x, 0.38, z);
        post.material = bronze;
        this.registerMesh(post, bridgeRoot);
      }
    }
    const chasmLight = new PointLight("chasm-light", new Vector3(center.x, -1.9, center.z), this.scene);
    chasmLight.diffuse = new Color3(0.02, 0.45, 0.8);
    chasmLight.intensity = 4.2;
    chasmLight.range = 7;
    chasmLight.parent = root;
    // Fog collects at the bottom instead of a lit slab floating in the dark.
    const fog = MeshBuilder.CreatePlane("chasm-fog", { width: 1.62, height: roomDepth - 0.9 }, this.scene);
    fog.rotation.x = Math.PI / 2;
    fog.position = new Vector3(center.x, -2.95, 0);
    fog.material = this.createShaftMaterial("chasm-fog-band", this.createChasmFogTexture());
    fog.isPickable = false;
    fog.receiveShadows = false;
    fog.parent = root;
    for (const z of [-2.7, 0, 2.7]) {
      const lowerBrace = MeshBuilder.CreateBox(`chasm-lower-brace-${z}`, { width: 1.72, depth: 0.28, height: 0.26 }, this.scene);
      lowerBrace.position = new Vector3(center.x, -2.28, z);
      lowerBrace.material = metal;
      this.registerMesh(lowerBrace, root, false);
    }
    void cyanGlass;
    return { root: bridgeRoot, openY: 0.13, closedY: -1.15 };
  }

  private createChasmFogTexture(): DynamicTexture {
    const texture = new DynamicTexture("chasm-fog-texture", { width: 128, height: 128 }, this.scene, false);
    const context = texture.getContext();
    context.fillStyle = "#000000";
    context.fillRect(0, 0, 128, 128);
    const band = context.createRadialGradient(64, 64, 2, 64, 64, 78);
    band.addColorStop(0, "#123a4c");
    band.addColorStop(0.5, "#0a2130");
    band.addColorStop(1, "#000000");
    context.fillStyle = band;
    context.fillRect(0, 0, 128, 128);
    texture.update(false);
    return texture;
  }

  /**
   * Handoff runs through a gate in a wall, not over a void: bars that ride up
   * into the arch when the past opens it.
   */
  /**
   * Last Hold ends with the past holding a door — the ending copy says so, and
   * the tutorial calls it a handle. So the mechanism is dressed as a monumental
   * slab in a bronze-banded frame, held up rather than bridged across.
   */
  private createHeavyPortal(
    rect: Rect,
    stone: StandardMaterial,
    metal: StandardMaterial,
    bronze: StandardMaterial,
    root: TransformNode,
  ): BridgeVisual {
    const center = this.rectCenter(rect, 0);
    const span = Math.max(1.6, rect.height * WORLD_SCALE);
    const frame = new TransformNode("portal-frame", this.scene);
    frame.parent = root;
    frame.position = new Vector3(center.x, 0, center.z);
    for (const z of [-span / 2 - 0.3, span / 2 + 0.3]) {
      const pier = MeshBuilder.CreateBox(`portal-pier-${z}`, { width: 0.78, depth: 0.58, height: 3.5 }, this.scene);
      pier.position = new Vector3(0, 1.75, z);
      pier.material = stone;
      this.registerMesh(pier, frame);
      const corbel = MeshBuilder.CreateBox(`portal-corbel-${z}`, { width: 0.96, depth: 0.72, height: 0.26 }, this.scene);
      corbel.position = new Vector3(0, 3.36, z);
      corbel.material = stone;
      this.registerMesh(corbel, frame);
    }
    const lintel = MeshBuilder.CreateBox("portal-lintel", { width: 0.86, depth: span + 1.7, height: 0.62 }, this.scene);
    lintel.position = new Vector3(0, 3.78, 0);
    lintel.material = stone;
    this.registerMesh(lintel, frame);
    const threshold = MeshBuilder.CreateBox("portal-threshold", { width: 0.82, depth: span + 0.9, height: 0.09 }, this.scene);
    threshold.position = new Vector3(0, 0.045, 0);
    threshold.material = bronze;
    this.registerMesh(threshold, frame);
    // The handle the past grips, on the room's side of the slab.
    for (const z of [-span * 0.22, span * 0.22]) {
      const handle = MeshBuilder.CreateTorus(`portal-handle-${z}`, { diameter: 0.42, thickness: 0.06, tessellation: 20 }, this.scene);
      handle.position = new Vector3(-0.42, 1.15, z);
      handle.rotation.y = Math.PI / 2;
      handle.material = bronze;
      this.registerMesh(handle, frame);
    }

    const leaf = new TransformNode("portal-leaf", this.scene);
    leaf.parent = root;
    leaf.position = new Vector3(center.x, 0, center.z);
    const slab = MeshBuilder.CreateBox("portal-slab", { width: 0.46, depth: span + 0.5, height: 3.3 }, this.scene);
    slab.position = new Vector3(0, 1.65, 0);
    slab.material = stone;
    this.registerMesh(slab, leaf);
    for (const y of [0.62, 1.62, 2.62]) {
      const band = MeshBuilder.CreateBox(`portal-band-${y}`, { width: 0.54, depth: span + 0.56, height: 0.14 }, this.scene);
      band.position = new Vector3(0, y, 0);
      band.material = bronze;
      this.registerMesh(band, leaf);
      for (const z of [-span * 0.3, 0, span * 0.3]) {
        const stud = MeshBuilder.CreateCylinder(`portal-stud-${y}-${z}`, { diameter: 0.11, height: 0.08, tessellation: 8 }, this.scene);
        stud.position = new Vector3(-0.29, y, z);
        stud.rotation.z = Math.PI / 2;
        stud.material = metal;
        this.registerMesh(stud, leaf);
      }
    }
    return { root: leaf, openY: 3.28, closedY: 0 };
  }

  private createPortcullis(
    rect: Rect,
    stone: StandardMaterial,
    metal: StandardMaterial,
    bronze: StandardMaterial,
    root: TransformNode,
  ): BridgeVisual {
    const center = this.rectCenter(rect, 0);
    const span = Math.max(1.4, rect.height * WORLD_SCALE);
    const frameRoot = new TransformNode("portcullis-frame", this.scene);
    frameRoot.parent = root;
    frameRoot.position = new Vector3(center.x, 0, center.z);
    for (const z of [-span / 2 - 0.16, span / 2 + 0.16]) {
      const jamb = MeshBuilder.CreateBox(`portcullis-jamb-${z}`, { width: 0.55, depth: 0.42, height: 2.9 }, this.scene);
      jamb.position = new Vector3(0, 1.45, z);
      jamb.material = stone;
      this.registerMesh(jamb, frameRoot);
    }
    const lintel = MeshBuilder.CreateBox("portcullis-lintel", { width: 0.62, depth: span + 1.1, height: 0.46 }, this.scene);
    lintel.position = new Vector3(0, 3.05, 0);
    lintel.material = stone;
    this.registerMesh(lintel, frameRoot);
    const sill = MeshBuilder.CreateBox("portcullis-sill", { width: 0.6, depth: span + 0.8, height: 0.1 }, this.scene);
    sill.position = new Vector3(0, 0.05, 0);
    sill.material = bronze;
    this.registerMesh(sill, frameRoot);

    const gate = new TransformNode("portcullis-gate", this.scene);
    gate.parent = root;
    gate.position = new Vector3(center.x, 0, center.z);
    const barCount = Math.max(4, Math.round(span / 0.36));
    for (let index = 0; index < barCount; index += 1) {
      const z = -span / 2 + (index + 0.5) * (span / barCount);
      const bar = MeshBuilder.CreateCylinder(`portcullis-bar-${index}`, {
        diameter: 0.1,
        height: 2.5,
        tessellation: 8,
      }, this.scene);
      bar.position = new Vector3(0, 1.3, z);
      bar.material = metal;
      this.registerMesh(bar, gate);
      const tip = MeshBuilder.CreateCylinder(`portcullis-tip-${index}`, {
        diameterTop: 0.1,
        diameterBottom: 0,
        height: 0.22,
        tessellation: 8,
      }, this.scene);
      tip.position = new Vector3(0, 0.16, z);
      tip.rotation.z = Math.PI;
      tip.material = metal;
      this.registerMesh(tip, gate);
    }
    for (const y of [0.75, 1.95]) {
      const brace = MeshBuilder.CreateBox(`portcullis-brace-${y}`, { width: 0.08, depth: span, height: 0.09 }, this.scene);
      brace.position = new Vector3(0, y, 0);
      brace.material = bronze;
      this.registerMesh(brace, gate);
    }
    return { root: gate, openY: 2.55, closedY: 0 };
  }

  private createMoteTexture(): DynamicTexture {
    const texture = new DynamicTexture("mote-texture", { width: 64, height: 64 }, this.scene, false);
    const context = texture.getContext();
    context.fillStyle = "#000000";
    context.fillRect(0, 0, 64, 64);
    const dot = context.createRadialGradient(32, 32, 0, 32, 32, 30);
    dot.addColorStop(0, "rgba(255, 240, 214, 1)");
    dot.addColorStop(0.35, "rgba(255, 226, 178, 0.5)");
    dot.addColorStop(1, "rgba(0, 0, 0, 0)");
    context.fillStyle = dot;
    context.fillRect(0, 0, 64, 64);
    texture.update(false);
    texture.hasAlpha = true;
    return texture;
  }

  /**
   * Dust hanging in the doorway light. Motes are the cheapest way to say the
   * beam is volume rather than a surface, so they live only where it lands.
   */
  private createDustMotes(exitRoot: TransformNode, texture: DynamicTexture): ParticleSystem {
    const motes = new ParticleSystem("exit-dust", 60, this.scene);
    motes.particleTexture = texture;
    // The emitter takes a world point, and the exit root carries both a yaw and
    // an offset, so the beam's centre has to be transformed out of it.
    exitRoot.computeWorldMatrix(true);
    motes.emitter = Vector3.TransformCoordinates(new Vector3(1.6, 1.5, 0), exitRoot.getWorldMatrix());
    motes.minEmitBox = new Vector3(-1.6, -1.3, -0.8);
    motes.maxEmitBox = new Vector3(1.6, 1.3, 0.8);
    motes.color1 = new Color4(1, 0.87, 0.64, 0.7);
    motes.color2 = new Color4(1, 0.78, 0.5, 0.45);
    motes.colorDead = new Color4(0.6, 0.45, 0.25, 0);
    motes.minSize = 0.04;
    motes.maxSize = 0.115;
    motes.minLifeTime = 3.2;
    motes.maxLifeTime = 6.5;
    motes.emitRate = 22;
    motes.blendMode = ParticleSystem.BLENDMODE_ADD;
    motes.gravity = new Vector3(0, -0.012, 0);
    motes.direction1 = new Vector3(-0.05, 0.03, -0.04);
    motes.direction2 = new Vector3(0.05, 0.07, 0.04);
    motes.minEmitPower = 0.01;
    motes.maxEmitPower = 0.05;
    motes.updateSpeed = 0.008;
    return motes;
  }

  /** The echo arriving: a short cyan bloom of motes where the past reappears. */
  private createEchoBurst(texture: DynamicTexture): ParticleSystem {
    const burst = new ParticleSystem("echo-burst", 90, this.scene);
    burst.particleTexture = texture;
    burst.emitter = new Vector3(0, 0, 0);
    burst.minEmitBox = new Vector3(-0.2, 0, -0.2);
    burst.maxEmitBox = new Vector3(0.2, 1.8, 0.2);
    burst.color1 = new Color4(0.5, 0.92, 1, 0.85);
    burst.color2 = new Color4(0.1, 0.62, 0.95, 0.6);
    burst.colorDead = new Color4(0.05, 0.3, 0.5, 0);
    burst.minSize = 0.03;
    burst.maxSize = 0.11;
    burst.minLifeTime = 0.35;
    burst.maxLifeTime = 0.85;
    burst.emitRate = 0;
    burst.blendMode = ParticleSystem.BLENDMODE_ADD;
    burst.gravity = new Vector3(0, 0.35, 0);
    burst.direction1 = new Vector3(-1.1, 0.2, -1.1);
    burst.direction2 = new Vector3(1.1, 1.4, 1.1);
    burst.minEmitPower = 0.4;
    burst.maxEmitPower = 1.5;
    burst.updateSpeed = 0.012;
    return burst;
  }

  /** Time folding: one ring that expands out of the recorder and thins away. */
  private createFoldRipple(worldRoot: TransformNode): { mesh: Mesh; material: StandardMaterial } {
    const rippleMaterial = material(this.scene, "fold-ripple", Color3.Black(), new Color3(0.3, 0.85, 1), 1, Color3.Black());
    rippleMaterial.disableLighting = true;
    rippleMaterial.alphaMode = Constants.ALPHA_ADD;
    rippleMaterial.disableDepthWrite = true;
    const mesh = MeshBuilder.CreateTorus("fold-ripple", { diameter: 1, thickness: 0.055, tessellation: 40 }, this.scene);
    mesh.material = rippleMaterial;
    mesh.parent = worldRoot;
    mesh.isPickable = false;
    mesh.receiveShadows = false;
    mesh.setEnabled(false);
    this.glow.addIncludedOnlyMesh(mesh);
    return { mesh, material: rippleMaterial };
  }

  private createTargetGuide(worldRoot: TransformNode): TargetGuideVisual {
    const root = new TransformNode("tutorial-target-root", this.scene);
    root.parent = worldRoot;
    const gold = material(
      this.scene,
      "tutorial-target-gold",
      new Color3(0.78, 0.46, 0.12),
      new Color3(1, 0.52, 0.08),
      0.92,
    );
    const ring = MeshBuilder.CreateTorus("tutorial-target-ring", {
      diameter: 1.45,
      thickness: 0.075,
      tessellation: 40,
    }, this.scene);
    ring.position.y = 0.12;
    ring.material = gold;
    this.registerMesh(ring, root, false);
    const arrow = MeshBuilder.CreateCylinder("tutorial-target-arrow", {
      diameterTop: 0.42,
      diameterBottom: 0,
      height: 0.7,
      tessellation: 4,
    }, this.scene);
    arrow.position.y = 2.15;
    arrow.rotation.z = Math.PI;
    arrow.material = gold;
    this.registerMesh(arrow, root, false);
    this.glow.addIncludedOnlyMesh(ring);
    this.glow.addIncludedOnlyMesh(arrow);
    return { root, ring, arrow };
  }

  private createWinch(
    x: number,
    y: number,
    door: Rect | null,
    metal: StandardMaterial,
    bronze: StandardMaterial,
    cyan: StandardMaterial,
    worldRoot: TransformNode,
  ): WinchVisual {
    const root = new TransformNode("winch-root", this.scene);
    root.position = this.worldPoint(x, y, 0);
    root.parent = worldRoot;
    const base = MeshBuilder.CreateBox("winch-base", { width: 1.55, depth: 1.25, height: 0.18 }, this.scene);
    base.position.y = 0.1;
    base.material = metal;
    this.registerMesh(base, root);
    for (const z of [-0.46, 0.46]) {
      const support = MeshBuilder.CreateBox(`winch-support-${z}`, { width: 0.16, depth: 0.18, height: 1.22 }, this.scene);
      support.position = new Vector3(0, 0.69, z);
      support.rotation.z = z < 0 ? -0.1 : 0.1;
      support.material = bronze;
      this.registerMesh(support, root);
    }
    const drum = MeshBuilder.CreateCylinder("winch-drum", { diameter: 0.78, height: 1.08, tessellation: 24 }, this.scene);
    drum.position.y = 0.83;
    drum.rotation.x = Math.PI / 2;
    drum.material = metal;
    this.registerMesh(drum, root);
    // Rope coiled along the drum, so the winch reads as something that spools.
    for (let index = 0; index < 7; index += 1) {
      const coil = MeshBuilder.CreateTorus(`winch-coil-${index}`, { diameter: 0.86, thickness: 0.075, tessellation: 20 }, this.scene);
      coil.position = new Vector3(0, 0.83, -0.42 + index * 0.14);
      coil.rotation.x = Math.PI / 2;
      coil.material = bronze;
      this.registerMesh(coil, root);
    }
    for (const z of [-0.58, 0.58]) {
      const wheel = MeshBuilder.CreateTorus(`winch-wheel-${z}`, { diameter: 0.92, thickness: 0.11, tessellation: 28 }, this.scene);
      wheel.position = new Vector3(0, 0.83, z);
      wheel.rotation.x = Math.PI / 2;
      wheel.material = bronze;
      this.registerMesh(wheel, root);
      for (let spoke = 0; spoke < 6; spoke += 1) {
        const arm = MeshBuilder.CreateBox(`winch-spoke-${z}-${spoke}`, { width: 0.85, depth: 0.055, height: 0.05 }, this.scene);
        arm.position = new Vector3(0, 0.83, z);
        arm.rotation.z = spoke * Math.PI / 6;
        arm.material = metal;
        this.registerMesh(arm, root);
      }
    }
    const crank = new TransformNode("winch-crank", this.scene);
    crank.position = new Vector3(0, 0.83, -0.69);
    crank.parent = root;
    const crankArm = MeshBuilder.CreateBox("winch-crank-arm", { width: 0.08, depth: 0.08, height: 0.7 }, this.scene);
    crankArm.position.y = 0.28;
    crankArm.material = bronze;
    this.registerMesh(crankArm, crank);
    const handle = MeshBuilder.CreateCylinder("winch-handle", { diameter: 0.13, height: 0.38, tessellation: 12 }, this.scene);
    handle.position = new Vector3(0, 0.62, -0.12);
    handle.rotation.x = Math.PI / 2;
    handle.material = metal;
    this.registerMesh(handle, crank);
    const runeMaterial = material(this.scene, "winch-rune", new Color3(0.015, 0.16, 0.2), new Color3(0.01, 0.2, 0.3));
    const rune = MeshBuilder.CreateTorus("winch-rune", { diameter: 1.26, thickness: 0.055, tessellation: 32 }, this.scene);
    rune.position.y = 0.22;
    rune.material = runeMaterial;
    this.registerMesh(rune, root, false);
    this.glow.addIncludedOnlyMesh(rune);
    if (door) {
      const doorCenter = this.rectCenter(door, 0.62);
      const start = root.position.add(new Vector3(0.55, 0.88, 0));
      const cable = MeshBuilder.CreateTube("winch-cable", { path: [start, doorCenter], radius: 0.025, tessellation: 8 }, this.scene);
      cable.material = bronze;
      this.registerMesh(cable, worldRoot, false);
    }
    return { root, drum, crank, rune, runeMaterial };
  }

  /**
   * Last Hold's "bridge stone" is rubble the past shoves into a gap — faceted
   * boulders with hand-worn grips, not a crated weight riding rails.
   */
  private dressBoulderCluster(
    root: TransformNode,
    rect: ForceObjectState,
    width: number,
    depth: number,
    stone: StandardMaterial,
    cyan: StandardMaterial,
    amber: StandardMaterial,
  ): WeightVisual {
    const random = this.seededRandom(rect.minX + rect.maxX + 977);
    const lumps: [number, number, number, number][] = [
      [0, 0.86, 0, 0.98],
      [-width * 0.24, 0.52, depth * 0.22, 0.62],
      [width * 0.26, 0.58, -depth * 0.2, 0.66],
      [-width * 0.1, 1.42, -depth * 0.16, 0.5],
      [width * 0.14, 1.34, depth * 0.2, 0.44],
      [0, 0.3, 0, 0.78],
    ];
    for (const [index, [x, y, z, radius]] of lumps.entries()) {
      const lump = MeshBuilder.CreateIcoSphere(`bridge-stone-${index}`, {
        radius,
        subdivisions: 1,
        flat: true,
      }, this.scene);
      lump.position = new Vector3(x, y, z);
      lump.rotation = new Vector3(random() * Math.PI, random() * Math.PI, random() * Math.PI);
      lump.scaling = new Vector3(1.15 + random() * 0.3, 0.82 + random() * 0.26, 1.05 + random() * 0.3);
      lump.material = stone;
      this.registerMesh(lump, root);
    }
    for (let index = 0; index < 5; index += 1) {
      const chip = MeshBuilder.CreateIcoSphere(`bridge-rubble-${index}`, {
        radius: 0.11 + random() * 0.1,
        subdivisions: 1,
        flat: true,
      }, this.scene);
      chip.position = new Vector3(
        (random() - 0.5) * (width + 1.1),
        0.08,
        (random() - 0.5) * (depth + 0.9),
      );
      chip.rotation = new Vector3(random() * Math.PI, random() * Math.PI, random() * Math.PI);
      chip.material = stone;
      this.registerMesh(chip, root);
    }
    // The two hand marks stay: they are how the room says who may push.
    const cyanMaterial = material(this.scene, "weight-cyan-sigil", new Color3(0.015, 0.12, 0.16), new Color3(0.01, 0.14, 0.2));
    const amberMaterial = material(this.scene, "weight-amber-sigil", new Color3(0.14, 0.07, 0.015), new Color3(0.15, 0.05, 0.005));
    const cyanSigil = MeshBuilder.CreateTorus("weight-cyan-hand", { diameter: 0.46, thickness: 0.07, tessellation: 24 }, this.scene);
    cyanSigil.position = new Vector3(-width / 2 - 0.12, 0.92, 0.5);
    cyanSigil.rotation.z = Math.PI / 2;
    cyanSigil.material = cyanMaterial;
    this.registerMesh(cyanSigil, root, false);
    const amberSigil = MeshBuilder.CreateTorus("weight-amber-hand", { diameter: 0.46, thickness: 0.07, tessellation: 24 }, this.scene);
    amberSigil.position = new Vector3(-width / 2 - 0.12, 0.92, -0.5);
    amberSigil.rotation.z = Math.PI / 2;
    amberSigil.material = amberMaterial;
    this.registerMesh(amberSigil, root, false);
    this.glow.addIncludedOnlyMesh(cyanSigil);
    this.glow.addIncludedOnlyMesh(amberSigil);
    void cyan;
    void amber;
    return { root, cyanSigil, amberSigil, cyanMaterial, amberMaterial };
  }

  private createWeight(
    rect: ForceObjectState,
    stone: StandardMaterial,
    metal: StandardMaterial,
    bronze: StandardMaterial,
    cyan: StandardMaterial,
    amber: StandardMaterial,
    worldRoot: TransformNode,
  ): WeightVisual {
    const root = new TransformNode("memory-weight-root", this.scene);
    root.position = this.rectCenter(rect, 0).add(new Vector3(0.88, 0, 0));
    root.parent = worldRoot;
    const width = rect.width * WORLD_SCALE;
    const depth = rect.height * WORLD_SCALE;
    if (rect.id.includes("stone")) return this.dressBoulderCluster(root, rect, width, depth, stone, cyan, amber);
    const body = MeshBuilder.CreateBox("memory-weight", { width, depth, height: 2.05 }, this.scene);
    body.position.y = 1.08;
    body.material = stone;
    this.registerMesh(body, root);
    const cap = MeshBuilder.CreateBox("memory-weight-cap", { width: width + 0.16, depth: depth + 0.16, height: 0.18 }, this.scene);
    cap.position.y = 2.14;
    cap.material = metal;
    this.registerMesh(cap, root);
    const foot = MeshBuilder.CreateBox("memory-weight-foot", { width: width + 0.24, depth: depth + 0.24, height: 0.2 }, this.scene);
    foot.position.y = 0.16;
    foot.material = metal;
    this.registerMesh(foot, root);
    for (const x of [-width / 2 - 0.035, width / 2 + 0.035]) {
      for (const z of [-depth / 2 - 0.035, depth / 2 + 0.035]) {
        const corner = MeshBuilder.CreateBox(`weight-corner-${x}-${z}`, { width: 0.13, depth: 0.13, height: 1.92 }, this.scene);
        corner.position = new Vector3(x, 1.08, z);
        corner.material = bronze;
        this.registerMesh(corner, root);
      }
    }
    for (const y of [0.44, 1.08, 1.72]) {
      const band = MeshBuilder.CreateBox(`weight-band-${y}`, { width: width + 0.08, depth: depth + 0.08, height: 0.085 }, this.scene);
      band.position.y = y;
      band.material = bronze;
      this.registerMesh(band, root);
    }
    for (const z of [-depth / 2 + 0.1, depth / 2 - 0.1]) {
      const runner = MeshBuilder.CreateBox(`weight-runner-${z}`, { width: width + 0.3, depth: 0.14, height: 0.13 }, this.scene);
      runner.position = new Vector3(0, 0.08, z);
      runner.material = bronze;
      this.registerMesh(runner, root);
    }
    const trackStart = rect.minX;
    const trackEnd = rect.maxX + rect.width;
    const trackLength = (trackEnd - trackStart) * WORLD_SCALE;
    const trackCenterX = this.worldPoint((trackStart + trackEnd) / 2, rect.y, 0).x;
    for (const zValue of [rect.y + 10, rect.y + rect.height - 10]) {
      const track = MeshBuilder.CreateBox(`weight-track-${zValue}`, { width: trackLength, depth: 0.1, height: 0.11 }, this.scene);
      track.position = new Vector3(trackCenterX, 0.055, this.worldPoint(rect.x, zValue, 0).z);
      track.material = metal;
      this.registerMesh(track, worldRoot);
      for (let index = 0; index < 8; index += 1) {
        const tie = MeshBuilder.CreateBox(`track-tie-${zValue}-${index}`, { width: 0.12, depth: 0.34, height: 0.06 }, this.scene);
        tie.position = new Vector3(trackCenterX - trackLength / 2 + index * trackLength / 7, 0.035, track.position.z);
        tie.material = bronze;
        this.registerMesh(tie, worldRoot, false);
      }
    }
    const facePanel = MeshBuilder.CreateBox("weight-engraved-panel", { width: width * 0.62, depth: 0.045, height: 1.04 }, this.scene);
    facePanel.position = new Vector3(0, 1.08, -depth / 2 - 0.035);
    facePanel.material = metal;
    this.registerMesh(facePanel, root);
    for (const y of [0.72, 1.08, 1.44]) {
      const groove = MeshBuilder.CreateBox(`weight-groove-${y}`, { width: width * 0.48, depth: 0.035, height: 0.035 }, this.scene);
      groove.position = new Vector3(0, y, -depth / 2 - 0.07);
      groove.material = bronze;
      this.registerMesh(groove, root, false);
    }
    for (const [index, z] of [-0.62, 0.62].entries()) {
      const handleMaterial = index === 0 ? amber : cyan;
      const grip = MeshBuilder.CreateCylinder(`weight-handle-grip-${index}`, { diameter: 0.11, height: 0.56, tessellation: 12 }, this.scene);
      grip.position = new Vector3(-width / 2 - 0.23, 1.17, z);
      grip.material = handleMaterial;
      this.registerMesh(grip, root, false);
      this.glow.addIncludedOnlyMesh(grip);
      for (const y of [0.91, 1.43]) {
        const bracket = MeshBuilder.CreateBox(`weight-handle-bracket-${index}-${y}`, { width: 0.34, depth: 0.1, height: 0.1 }, this.scene);
        bracket.position = new Vector3(-width / 2 - 0.08, y, z);
        bracket.material = bronze;
        this.registerMesh(bracket, root);
      }
    }
    const cyanMaterial = material(this.scene, "weight-cyan-sigil", new Color3(0.015, 0.12, 0.16), new Color3(0.01, 0.14, 0.2));
    const amberMaterial = material(this.scene, "weight-amber-sigil", new Color3(0.14, 0.07, 0.015), new Color3(0.15, 0.05, 0.005));
    const cyanSigil = MeshBuilder.CreateTorus("weight-cyan-hand", { diameter: 0.5, thickness: 0.075, tessellation: 24 }, this.scene);
    cyanSigil.position = new Vector3(-width / 2 - 0.025, 1.28, 0.62);
    cyanSigil.rotation.z = Math.PI / 2;
    cyanSigil.material = cyanMaterial;
    this.registerMesh(cyanSigil, root, false);
    const amberSigil = MeshBuilder.CreateTorus("weight-amber-hand", { diameter: 0.5, thickness: 0.075, tessellation: 24 }, this.scene);
    amberSigil.position = new Vector3(-width / 2 - 0.025, 1.28, -0.62);
    amberSigil.rotation.z = Math.PI / 2;
    amberSigil.material = amberMaterial;
    this.registerMesh(amberSigil, root, false);
    this.glow.addIncludedOnlyMesh(cyanSigil);
    this.glow.addIncludedOnlyMesh(amberSigil);
    return { root, cyanSigil, amberSigil, cyanMaterial, amberMaterial };
  }

  private createExit(
    rect: Rect,
    stone: StandardMaterial,
    bronze: StandardMaterial,
    white: StandardMaterial,
    worldRoot: TransformNode,
  ): ExitVisual {
    const root = new TransformNode("exit-root", this.scene);
    root.position = this.rectCenter(rect, 0).add(new Vector3(3.6, 0, 0));
    root.rotation.y = EXIT_YAW;
    root.parent = worldRoot;
    const depth = Math.max(2.35, rect.height * WORLD_SCALE * 1.05);
    const approach = MeshBuilder.CreateBox("exit-approach", { width: 4.2, depth: 3.15, height: 0.04 }, this.scene);
    approach.position = new Vector3(-1.65, -0.02, 0);
    approach.material = stone;
    this.registerMesh(approach, root);
    const portalMaterial = material(this.scene, "exit-portal-light", new Color3(0.62, 0.5, 0.3), new Color3(0.82, 0.64, 0.34), 0.74);
    const portal = MeshBuilder.CreateBox("exit-portal", { width: 0.08, depth: 0.8, height: 1.4 }, this.scene);
    portal.position = new Vector3(4.55, 0.84, 0);
    portal.material = portalMaterial;
    this.registerMesh(portal, root, false);
    this.glow.addIncludedOnlyMesh(portal);
    const tunnelStone = material(this.scene, "exit-tunnel-stone", new Color3(0.11, 0.105, 0.088), new Color3(0.03, 0.022, 0.013), 1, new Color3(0.12, 0.1, 0.07));
    // The arch must stay a dark frame around the light. It sits closest to the
    // exit lamp and the raised fill, so it opts out of most of the ambient
    // floor the rest of the vault relies on.
    tunnelStone.ambientColor = new Color3(0.3, 0.3, 0.34);
    const tunnelFloor = MeshBuilder.CreateBox("exit-tunnel-floor", { width: 4.4, depth: depth - 0.24, height: 0.035 }, this.scene);
    tunnelFloor.position = new Vector3(2.1, -0.017, 0);
    tunnelFloor.material = tunnelStone;
    this.registerMesh(tunnelFloor, root);
    // Two converging walls carry the perspective, with a frame at each end.
    // Four nested rings read as a barcode of dark bars rather than as depth.
    const farArchRim = material(this.scene, "exit-far-arch-rim", new Color3(0.42, 0.25, 0.08), new Color3(0.15, 0.065, 0.015));
    for (const z of [-1, 1]) {
      const side = MeshBuilder.CreateBox(`exit-tunnel-side-${z}`, { width: 4.5, depth: 0.32, height: 3.5 }, this.scene);
      side.position = new Vector3(2.2, 1.6, z * (depth / 2 - 0.06));
      side.rotation.y = z * -0.055;
      side.material = tunnelStone;
      this.registerMesh(side, root);
    }
    const ceiling = MeshBuilder.CreateBox("exit-tunnel-ceiling", { width: 4.5, depth: depth + 0.2, height: 0.3 }, this.scene);
    ceiling.position = new Vector3(2.2, 3.4, 0);
    ceiling.material = tunnelStone;
    this.registerMesh(ceiling, root);
    for (const [index, spec] of [
      { x: 0.2, height: 3.55, span: depth, inset: bronze },
      { x: 4.25, height: 2.35, span: depth * 0.62, inset: farArchRim },
    ].entries()) {
      for (const z of [-spec.span / 2, spec.span / 2]) {
        const jamb = MeshBuilder.CreateBox(`exit-arch-upright-${index}-${z}`, { width: 0.3, depth: 0.32, height: spec.height }, this.scene);
        jamb.position = new Vector3(spec.x, spec.height / 2, z);
        jamb.material = tunnelStone;
        this.registerMesh(jamb, root);
        if (index === 0) {
          const reveal = MeshBuilder.CreateBox(`exit-arch-inset-${index}-${z}`, { width: 0.06, depth: 0.12, height: spec.height * 0.8 }, this.scene);
          reveal.position = new Vector3(spec.x - 0.18, spec.height * 0.42, z * 0.94);
          reveal.material = spec.inset;
          this.registerMesh(reveal, root, false);
        }
      }
      const lintel = MeshBuilder.CreateBox(`exit-arch-top-${index}`, { width: 0.3, depth: spec.span + 0.36, height: 0.32 }, this.scene);
      lintel.position = new Vector3(spec.x, spec.height, 0);
      lintel.material = tunnelStone;
      this.registerMesh(lintel, root);
    }
    const lightPathMaterial = material(this.scene, "exit-light-path", new Color3(0.32, 0.22, 0.1), new Color3(0.42, 0.27, 0.1), 0.42);
    const approachLight = MeshBuilder.CreateBox("exit-approach-light", { width: 3.4, depth: 0.34, height: 0.026 }, this.scene);
    approachLight.position = new Vector3(-1.62, 0.14, 0);
    approachLight.material = lightPathMaterial;
    this.registerMesh(approachLight, root, false);
    const slab = MeshBuilder.CreateBox("exit-slab", { width: 0.18, depth: depth - 0.36, height: 3.45 }, this.scene);
    slab.position = new Vector3(-0.03, 1.84, 0);
    slab.material = stone;
    this.registerMesh(slab, root);
    // A broken arch over the mouth: the vault has already half-collapsed here,
    // which is what makes the light beyond it read as outside.
    const ruinRandom = this.seededRandom(1471);
    for (let index = 0; index < 7; index += 1) {
      if (index === 3 || index === 5) continue;
      const angle = -0.62 + index * 0.21;
      const voussoir = MeshBuilder.CreateBox(`exit-broken-arch-${index}`, {
        width: 0.34,
        depth: 0.52,
        height: 0.46 + ruinRandom() * 0.12,
      }, this.scene);
      voussoir.position = new Vector3(
        0.42 + Math.sin(angle) * 0.3,
        3.68 + Math.cos(angle) * 0.42,
        Math.sin(angle) * 1.5,
      );
      voussoir.rotation.x = angle * 0.85;
      voussoir.rotation.z = (ruinRandom() - 0.5) * 0.16;
      voussoir.material = stone;
      this.registerMesh(voussoir, root);
    }
    const lintelStub = MeshBuilder.CreateBox("exit-arch-stub", { width: 0.4, depth: 0.9, height: 0.34 }, this.scene);
    lintelStub.position = new Vector3(0.42, 3.42, -1.24);
    lintelStub.rotation.x = 0.12;
    lintelStub.material = stone;
    this.registerMesh(lintelStub, root);

    const light = new PointLight("exit-beacon", new Vector3(4.72, 0.88, 0), this.scene);
    light.diffuse = new Color3(1, 0.86, 0.62);
    light.intensity = 2.6;
    light.range = 7.5;
    light.parent = root;
    const { shaft, shaftMaterial, spillMaterial, beamMaterial } = this.createLightShaft(root);
    void white;
    return { root, portal, slab, portalMaterial, light, shaft, shaftMaterial, spillMaterial, beamMaterial };
  }

  /**
   * Procedural light-shaft texture: a soft blob whose centre can be pushed
   * toward one edge, so the same helper makes both the doorway halo and the
   * floor spill that streams away from it.
   */
  private createShaftTexture(name: string, centerY: number): DynamicTexture {
    const texture = new DynamicTexture(name, { width: 256, height: 256 }, this.scene, false);
    const context = texture.getContext();
    context.fillStyle = "#000000";
    context.fillRect(0, 0, 256, 256);
    const falloff = context.createRadialGradient(128, centerY, 4, 128, centerY, 206);
    falloff.addColorStop(0, "#fff2da");
    falloff.addColorStop(0.24, "#d7a165");
    falloff.addColorStop(0.58, "#432c15");
    falloff.addColorStop(1, "#000000");
    context.fillStyle = falloff;
    context.fillRect(0, 0, 256, 256);
    texture.update(false);
    return texture;
  }

  private createShaftMaterial(name: string, texture: DynamicTexture): StandardMaterial {
    const shaftMaterial = material(this.scene, name, Color3.Black(), new Color3(1, 1, 1), 1, Color3.Black());
    shaftMaterial.emissiveTexture = texture;
    shaftMaterial.disableLighting = true;
    shaftMaterial.backFaceCulling = false;
    shaftMaterial.alphaMode = Constants.ALPHA_ADD;
    shaftMaterial.disableDepthWrite = true;
    return shaftMaterial;
  }

  /**
   * Vertical ramp for the beam itself: bright where it leaves the doorway,
   * spent by the time it reaches the floor. Kept separate from the blob
   * texture so the cone reads as a shaft with edges rather than as fog.
   */
  private createBeamTexture(): DynamicTexture {
    const texture = new DynamicTexture("exit-beam-ramp", { width: 32, height: 256 }, this.scene, false);
    const context = texture.getContext();
    const ramp = context.createLinearGradient(0, 0, 0, 256);
    ramp.addColorStop(0, "#c9a274");
    ramp.addColorStop(0.32, "#8a6136");
    ramp.addColorStop(0.7, "#33220f");
    ramp.addColorStop(1, "#0a0603");
    context.fillStyle = ramp;
    context.fillRect(0, 0, 32, 256);
    texture.update(false);
    return texture;
  }

  /**
   * The doorway light is geometry, not a post-process. A cone aimed straight
   * out of the tunnel would be seen end-on — the tunnel faces the camera — so
   * the beam is raked steeply downward instead: from the top of the opening to
   * the floor of the room, which the camera sees side-on as a shaft crossing
   * dark air. The opening keeps a halo and the floor keeps the spill.
   */
  private createLightShaft(exitRoot: TransformNode): {
    shaft: TransformNode;
    shaftMaterial: StandardMaterial;
    spillMaterial: StandardMaterial;
    beamMaterial: StandardMaterial;
  } {
    const shaft = new TransformNode("exit-shaft-root", this.scene);
    shaft.parent = exitRoot;
    const place = (mesh: Mesh, shaftMaterial: StandardMaterial): Mesh => {
      mesh.material = shaftMaterial;
      mesh.parent = shaft;
      mesh.isPickable = false;
      mesh.receiveShadows = false;
      return mesh;
    };

    const shaftMaterial = this.createShaftMaterial("exit-shaft", this.createShaftTexture("exit-shaft-halo", 128));
    const halo = place(MeshBuilder.CreatePlane("exit-shaft-halo", { width: 1.7, height: 2.3 }, this.scene), shaftMaterial);
    halo.rotation.y = -Math.PI / 2;
    halo.position = new Vector3(4.42, 1.15, 0);
    this.glow.addIncludedOnlyMesh(halo);

    // Apex at the top of the opening, base on the flagstones inside the room:
    // a ~45-degree rake, which the camera reads as a beam rather than a blob.
    const beamMaterial = this.createShaftMaterial("exit-beam", this.createBeamTexture());
    // Without this the cone is a solid shape wherever the camera catches it
    // end-on. Weighting the emissive toward grazing angles is what turns the
    // mesh into a beam: bright at the silhouette, near-invisible face-on.
    const edgeWeighting = new FresnelParameters();
    edgeWeighting.bias = 0.05;
    edgeWeighting.power = 2;
    edgeWeighting.leftColor = Color3.White();
    edgeWeighting.rightColor = Color3.Black();
    beamMaterial.emissiveFresnelParameters = edgeWeighting;
    const beam = place(MeshBuilder.CreateCylinder("exit-shaft-beam", {
      height: 4.74,
      diameterTop: 0.5,
      diameterBottom: 1.7,
      tessellation: 26,
      // Caps would show as a lit disc wherever the camera catches the open end.
      cap: Mesh.NO_CAP,
    }, this.scene), beamMaterial);
    // A fake volumetric only reads while the camera sees it side-on, and the
    // exits are yawed toward the viewer. Raking the cone along the camera's
    // screen-right axis (rather than along the tunnel) keeps the beam broadside
    // in every room instead of collapsing into a lit shell in handoff.
    const beamYaw = Math.atan2(-Math.cos(CAMERA_ALPHA), -Math.sin(CAMERA_ALPHA)) - EXIT_YAW;
    beam.rotation = new Vector3(0, beamYaw, -0.83);
    beam.position = new Vector3(2.5, 1.72, 0);

    const spillMaterial = this.createShaftMaterial("exit-spill", this.createShaftTexture("exit-spill-falloff", 40));
    const spill = place(MeshBuilder.CreatePlane("exit-shaft-spill", { width: 2.9, height: 4.5 }, this.scene), spillMaterial);
    spill.rotation.x = Math.PI / 2;
    spill.rotation.z = -Math.PI / 2;
    spill.position = new Vector3(0.75, 0.03, 0);
    return { shaft, shaftMaterial, spillMaterial, beamMaterial };
  }

  private createPortalGlyph(position: Vector3, glyphMaterial: StandardMaterial, root: TransformNode): void {
    const head = MeshBuilder.CreateCylinder("portal-glyph-head", { diameter: 0.22, height: 0.025, tessellation: 24 }, this.scene);
    head.position = position.add(new Vector3(-0.22, 0.09, -0.02));
    head.material = glyphMaterial;
    this.registerMesh(head, root, false);
    const torso = MeshBuilder.CreateBox("portal-glyph-torso", { width: 0.48, height: 0.025, depth: 0.16 }, this.scene);
    torso.position = position.add(new Vector3(0.08, 0.09, 0));
    torso.rotation.y = -0.34;
    torso.material = glyphMaterial;
    this.registerMesh(torso, root, false);
    for (const [index, z] of [-0.15, 0.15].entries()) {
      const limb = MeshBuilder.CreateBox(`portal-glyph-limb-${index}`, { width: 0.42, height: 0.022, depth: 0.08 }, this.scene);
      limb.position = position.add(new Vector3(0.36, 0.095, z));
      limb.rotation.y = z < 0 ? 0.52 : -0.5;
      limb.material = glyphMaterial;
      this.registerMesh(limb, root, false);
    }
  }

  private createLimb(name: string, length: number, radius: number, limbMaterial: StandardMaterial, parent: TransformNode, echo: boolean): Mesh {
    const limb = MeshBuilder.CreateCapsule(name, { radius, height: length, tessellation: 12, subdivisions: 2, capSubdivisions: 4 }, this.scene);
    limb.position.y = -length / 2;
    limb.material = limbMaterial;
    limb.parent = parent;
    limb.isPickable = false;
    limb.receiveShadows = !echo;
    if (!echo) this.shadows.addShadowCaster(limb);
    return limb;
  }

  /**
   * The echo is light pretending to be a body: additive so it never occludes,
   * with a vertical ramp that both drives the shimmer and fades the limbs out
   * toward hands and boots.
   */
  private createEchoMaterials(): { core: StandardMaterial; fade: StandardMaterial } {
    const id = "shared";
    const ramp = new DynamicTexture(`echo-ramp-${id}`, { width: 16, height: 256 }, this.scene, false);
    const context = ramp.getContext();
    const gradient = context.createLinearGradient(0, 0, 0, 256);
    gradient.addColorStop(0, "#a8e9ff");
    gradient.addColorStop(0.22, "#4fc6f5");
    gradient.addColorStop(0.55, "#1a86bd");
    gradient.addColorStop(0.82, "#0d5c86");
    gradient.addColorStop(1, "#083c58");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 16, 256);
    for (let index = 0; index < 30; index += 1) {
      const y = Math.random() * 256;
      context.fillStyle = `rgba(170, 230, 255, ${0.04 + Math.random() * 0.09})`;
      context.fillRect(0, y, 16, 1 + Math.random() * 2);
    }
    ramp.update(false);
    ramp.wrapV = Texture.WRAP_ADDRESSMODE;

    const build = (name: string, strength: number): StandardMaterial => {
      const echoMaterial = material(this.scene, name, Color3.Black(), new Color3(strength, strength, strength), 1, Color3.Black());
      echoMaterial.emissiveTexture = ramp;
      echoMaterial.disableLighting = true;
      echoMaterial.alphaMode = Constants.ALPHA_ADD;
      echoMaterial.disableDepthWrite = true;
      return echoMaterial;
    };
    return { core: build(`echo-core-${id}`, 0.34), fade: build(`echo-fade-${id}`, 0.17) };
  }

  private bodyMaterials(echo: boolean): { jacket: StandardMaterial; skin: StandardMaterial; cloth: StandardMaterial; extremity: StandardMaterial } {
    if (echo) {
      if (!this.echoMaterials) {
        const built = this.createEchoMaterials();
        this.echoMaterials = { jacket: built.core, skin: built.fade, cloth: built.core, extremity: built.fade };
      }
      return this.echoMaterials;
    }
    if (!this.presentMaterials) {
      const cloth = material(this.scene, "present-cloth", new Color3(0.115, 0.12, 0.14));
      this.presentMaterials = {
        jacket: material(this.scene, "present-jacket", new Color3(0.52, 0.31, 0.12), new Color3(0.05, 0.014, 0)),
        skin: material(this.scene, "present-skin", new Color3(0.46, 0.3, 0.21)),
        cloth,
        extremity: cloth,
      };
    }
    return this.presentMaterials;
  }

  private createHumanoid(id: ActorId, echo: boolean): HumanoidRig {
    const root = new TransformNode(`human-${id}`, this.scene);
    const position = this.worldPoint(this.simulation.chamber.spawn.x, this.simulation.chamber.spawn.y, 0.12);
    root.position = position.clone();
    root.scaling.setAll(1.16);
    // Tunic, hood and boots read as one silhouette; skin is only face and hands.
    const { jacket, skin, cloth, extremity } = this.bodyMaterials(echo);
    const meshes: AbstractMesh[] = [];
    const addBodyMesh = (mesh: Mesh, bodyMaterial: StandardMaterial): Mesh => {
      mesh.material = bodyMaterial;
      mesh.parent = root;
      mesh.isPickable = false;
      mesh.receiveShadows = !echo;
      if (!echo) this.shadows.addShadowCaster(mesh);
      meshes.push(mesh);
      return mesh;
    };

    const torso = addBodyMesh(MeshBuilder.CreateCapsule(`human-${id}-torso`, { radius: 0.27, height: 0.96, tessellation: 14, subdivisions: 2, capSubdivisions: 5 }, this.scene), jacket);
    torso.position.y = 1.46;
    torso.scaling = new Vector3(0.7, 1, 1.06);
    torso.rotation.z = -0.05;
    // The tunic skirt below the belt is what gives the silhouette its taper.
    const tunic = addBodyMesh(MeshBuilder.CreateCylinder(`human-${id}-tunic`, {
      diameterTop: 0.5,
      diameterBottom: 0.66,
      height: 0.46,
      tessellation: 14,
    }, this.scene), jacket);
    tunic.position.y = 1.01;
    tunic.scaling.x = 0.78;
    const pelvis = addBodyMesh(MeshBuilder.CreateCapsule(`human-${id}-pelvis`, { radius: 0.2, height: 0.3, tessellation: 12, subdivisions: 1, capSubdivisions: 4 }, this.scene), cloth);
    pelvis.position.y = 0.9;
    pelvis.scaling.z = 1.1;
    const head = addBodyMesh(MeshBuilder.CreateSphere(`human-${id}-head`, { diameter: 0.29, segments: 16 }, this.scene), skin);
    head.position = new Vector3(0.02, 2.03, 0);
    const neck = addBodyMesh(MeshBuilder.CreateCylinder(`human-${id}-neck`, { diameter: 0.13, height: 0.18, tessellation: 10 }, this.scene), skin);
    neck.position.y = 1.86;
    if (!echo) {
      // Hood: a cone behind the head, plus the shoulder mantle it falls from.
      const hood = addBodyMesh(MeshBuilder.CreateCylinder(`human-${id}-hood`, {
        diameterTop: 0.2,
        diameterBottom: 0.46,
        height: 0.26,
        tessellation: 14,
      }, this.scene), cloth);
      hood.position = new Vector3(-0.13, 1.98, 0);
      hood.rotation.z = -0.62;
      // Small enough to stay a collar: the amber tunic has to carry the figure.
      const mantle = addBodyMesh(MeshBuilder.CreateCylinder(`human-${id}-mantle`, {
        diameterTop: 0.32,
        diameterBottom: 0.56,
        height: 0.18,
        tessellation: 14,
      }, this.scene), cloth);
      mantle.position.y = 1.79;
      mantle.scaling.x = 0.82;
    }

    const leftShoulder = new TransformNode(`human-${id}-left-shoulder`, this.scene);
    const rightShoulder = new TransformNode(`human-${id}-right-shoulder`, this.scene);
    leftShoulder.position = new Vector3(0, 1.72, -0.36);
    rightShoulder.position = new Vector3(0, 1.72, 0.36);
    leftShoulder.parent = rightShoulder.parent = root;
    const leftUpperArm = this.createLimb(`human-${id}-left-upper-arm`, 0.5, 0.1, jacket, leftShoulder, echo);
    const rightUpperArm = this.createLimb(`human-${id}-right-upper-arm`, 0.5, 0.1, jacket, rightShoulder, echo);
    meshes.push(leftUpperArm, rightUpperArm);
    const leftElbow = new TransformNode(`human-${id}-left-elbow`, this.scene);
    const rightElbow = new TransformNode(`human-${id}-right-elbow`, this.scene);
    leftElbow.position.y = rightElbow.position.y = -0.48;
    leftElbow.parent = leftShoulder;
    rightElbow.parent = rightShoulder;
    const leftLowerArm = this.createLimb(`human-${id}-left-lower-arm`, 0.45, 0.08, extremity, leftElbow, echo);
    const rightLowerArm = this.createLimb(`human-${id}-right-lower-arm`, 0.45, 0.08, extremity, rightElbow, echo);
    meshes.push(leftLowerArm, rightLowerArm);
    for (const [name, elbow] of [["left", leftElbow], ["right", rightElbow]] as const) {
      const hand = MeshBuilder.CreateSphere(`human-${id}-${name}-hand`, { diameter: 0.17, segments: 10 }, this.scene);
      hand.position.y = -0.47;
      hand.material = echo ? extremity : skin;
      hand.parent = elbow;
      hand.isPickable = false;
      if (!echo) this.shadows.addShadowCaster(hand);
      meshes.push(hand);
    }

    const leftHip = new TransformNode(`human-${id}-left-hip`, this.scene);
    const rightHip = new TransformNode(`human-${id}-right-hip`, this.scene);
    leftHip.position = new Vector3(0, 0.86, -0.17);
    rightHip.position = new Vector3(0, 0.86, 0.17);
    leftHip.parent = rightHip.parent = root;
    const leftThigh = this.createLimb(`human-${id}-left-thigh`, 0.5, 0.125, cloth, leftHip, echo);
    const rightThigh = this.createLimb(`human-${id}-right-thigh`, 0.5, 0.125, cloth, rightHip, echo);
    meshes.push(leftThigh, rightThigh);
    const leftKnee = new TransformNode(`human-${id}-left-knee`, this.scene);
    const rightKnee = new TransformNode(`human-${id}-right-knee`, this.scene);
    leftKnee.position.y = rightKnee.position.y = -0.48;
    leftKnee.parent = leftHip;
    rightKnee.parent = rightHip;
    const leftShin = this.createLimb(`human-${id}-left-shin`, 0.46, 0.1, extremity, leftKnee, echo);
    const rightShin = this.createLimb(`human-${id}-right-shin`, 0.46, 0.1, extremity, rightKnee, echo);
    meshes.push(leftShin, rightShin);
    for (const [name, z] of [["left", -0.17], ["right", 0.17]] as const) {
      const boot = addBodyMesh(MeshBuilder.CreateBox(`human-${id}-${name}-boot`, { width: 0.36, depth: 0.2, height: 0.22 }, this.scene), extremity);
      boot.position = new Vector3(0.07, 0.13, z);
      const cuff = addBodyMesh(MeshBuilder.CreateCylinder(`human-${id}-${name}-cuff`, {
        diameter: 0.26,
        height: 0.14,
        tessellation: 10,
      }, this.scene), extremity);
      cuff.position = new Vector3(0.02, 0.3, z);
    }
    return {
      echo,
      root,
      meshes,
      shimmer: echo && jacket.emissiveTexture instanceof Texture ? jacket.emissiveTexture : null,
      leftShoulder,
      rightShoulder,
      leftElbow,
      rightElbow,
      leftHip,
      rightHip,
      leftKnee,
      rightKnee,
      position,
      lastPosition: position.clone(),
      gait: 0,
    };
  }

  private disposeActorVisuals(): void {
    for (const rig of this.actorVisuals.values()) {
      for (const mesh of rig.meshes) this.shadows.removeShadowCaster(mesh);
      rig.root.dispose(false, false);
    }
    this.actorVisuals.clear();
  }

  private disposeWorld(): void {
    this.visuals.motes.dispose(true);
    this.visuals.burst.dispose(true);
    for (const mesh of this.visuals.root.getChildMeshes()) this.shadows.removeShadowCaster(mesh);
    this.visuals.root.dispose(false, false);
    for (const chamberMaterial of this.chamberMaterials) chamberMaterial.dispose(true, true);
    this.chamberMaterials = [];
  }

  /**
   * Latches the one recording beat the guide needs. It runs per simulation tick
   * rather than per rendered frame, so a throttled or stuttering renderer reads
   * the same grip length the card does.
   */
  private trackRecordingBeats(): void {
    const state = this.simulation.state;
    if (state.phase !== "recording") return;
    if (!state.hold?.active) {
      this.traceGripStartTick = null;
      return;
    }
    this.traceGripStartTick ??= state.tapeTick;
    if (state.tapeTick - this.traceGripStartTick >= traceRequiredHoldTicks()) this.traceWinchHeldLongEnough = true;
  }

  private resetRecordingBeats(): void {
    this.traceGripStartTick = null;
    this.traceWinchHeldLongEnough = false;
  }

  private targetGuidePosition(state: Readonly<SimulationState>): Vector3 | null {
    if (state.success) return null;
    const exit = (): Vector3 => this.rectCenter(state.exit, 0.05);
    const hold = (): Vector3 | null => state.hold ? this.worldPoint(state.hold.x, state.hold.y, 0.02) : null;
    const weight = (): Vector3 | null => state.forceObject
      ? this.worldPoint(state.forceObject.x - 24, state.forceObject.y + state.forceObject.height / 2, 0.02)
      : null;
    const plate = (): Vector3 | null => state.plate ? this.rectCenter(state.plate, 0.02) : null;

    switch (state.chamberId) {
      case "awakening":
        // The plate is the only thing to do here until the door is up.
        return state.door?.open === true ? exit() : plate();
      case "secondSelf":
        return state.phase === "recording" || state.phase === "rerecord" ? plate() : exit();
      case "handNotBody":
        if (state.phase === "recording" || state.phase === "rerecord") {
          // Nothing to walk to: the recording's whole job is pressing into the
          // shut door, so point at the door the echo will pass through.
          return state.door ? this.rectCenter(state.door.rect, 0.02) : exit();
        }
        return state.exit.open ? exit() : plate();
      case "crossing":
        return state.phase === "recording" || state.phase === "rerecord" ? hold() : exit();
      case "traceWeight":
        if (state.phase === "recording" || state.phase === "rerecord") {
          // Follow the recording's own beat, not the clock: a player who grips
          // the winch generously must not be waved at the weight while the card
          // is still telling them to hold on.
          return this.traceWinchHeldLongEnough ? weight() : hold();
        }
        if (state.door && !state.door.latched) {
          return this.worldPoint(
            state.door.rect.x + state.door.rect.width + 25,
            state.door.rect.y + state.door.rect.height / 2,
            0.02,
          );
        }
        if (state.forceObject && state.forceObject.x < state.forceObject.maxX) return weight();
        return exit();
      case "handoff":
        if (!state.handoff) return exit();
        // Pass 1 is only the switch; pass 2 is the box, then the cradle.
        if (state.phase === "recording" || state.phase === "rerecord") return hold();
        if (state.handoff.delivered) return exit();
        if (state.handoff.holder === "present") return this.rectCenter(state.handoff.delivery, 0.02);
        return this.worldPoint(state.handoff.x, state.handoff.y, 0.02);
      case "lastHold":
        return state.phase === "recording" || state.phase === "rerecord" ? hold() : exit();
    }
  }

  private updateVisuals(state: Readonly<SimulationState>): void {
    this.updateBeats(state);
    const activeIds = new Set(state.actors.map((actor) => actor.id));
    for (const [id, rig] of this.actorVisuals) {
      if (activeIds.has(id)) continue;
      for (const mesh of rig.meshes) this.shadows.removeShadowCaster(mesh);
      rig.root.dispose(false, false);
      this.actorVisuals.delete(id);
    }
    for (const actor of state.actors) {
      let rig = this.actorVisuals.get(actor.id);
      const shouldEcho = actor.id === "past" && state.phase !== "recording";
      if (rig && rig.echo !== shouldEcho) {
        for (const mesh of rig.meshes) this.shadows.removeShadowCaster(mesh);
        rig.root.dispose(false, false);
        this.actorVisuals.delete(actor.id);
        rig = undefined;
      }
      if (!rig) {
        rig = this.createHumanoid(actor.id, shouldEcho);
        this.actorVisuals.set(actor.id, rig);
      }
      this.updateHumanoid(rig, actor);
    }

    if (this.visuals.bridge && state.door) {
      const targetY = state.door.open ? this.visuals.bridge.openY : this.visuals.bridge.closedY;
      this.visuals.bridge.root.position.y += (targetY - this.visuals.bridge.root.position.y) * 0.16;
    }
    if (this.visuals.winch && state.hold) {
      if (state.hold.active) {
        this.visuals.winch.drum.rotation.z += 0.075;
        this.visuals.winch.crank.rotation.x += 0.075;
      }
      const glow = state.hold.active ? new Color3(0.03, 0.8, 1) : new Color3(0.01, 0.18, 0.26);
      this.visuals.winch.runeMaterial.emissiveColor = glow;
      const runeScale = state.hold.active ? 1.1 + Math.sin(performance.now() * 0.012) * 0.05 : 1;
      this.visuals.winch.rune.scaling.setAll(runeScale);
    }
    if (this.visuals.plate && state.plate) {
      // Cyan when the echo is holding it down, amber for the living body: the
      // ring says which self the plate is answering to.
      const pressedByPast = state.plate.pressedBy.includes("past") && state.phase !== "recording";
      const glow = !state.plate.active
        ? new Color3(0.02, 0.16, 0.24)
        : pressedByPast
          ? new Color3(0.03, 0.8, 1)
          : new Color3(1, 0.42, 0.06);
      this.visuals.plate.ringMaterial.emissiveColor = glow;
      this.visuals.plate.pad.position.y += ((state.plate.active ? 0.03 : 0.065) - this.visuals.plate.pad.position.y) * 0.2;
    }
    if (this.visuals.weight && state.forceObject) {
      const target = this.rectCenter(state.forceObject, 0);
      this.visuals.weight.root.position = Vector3.Lerp(this.visuals.weight.root.position, target, 0.38);
      const pastContributing = state.actors.some((actor) => actor.id === "past" && actor.actionHeld && actor.targetId === state.forceObject?.id);
      const presentContributing = state.actors.some((actor) => actor.id === "present" && actor.actionHeld && actor.targetId === state.forceObject?.id);
      this.visuals.weight.cyanMaterial.emissiveColor = pastContributing ? new Color3(0.04, 0.82, 1) : new Color3(0.01, 0.12, 0.17);
      this.visuals.weight.amberMaterial.emissiveColor = presentContributing ? new Color3(1, 0.34, 0.035) : new Color3(0.14, 0.04, 0.004);
      this.visuals.weight.cyanSigil.scaling.setAll(pastContributing ? 1.12 : 1);
      this.visuals.weight.amberSigil.scaling.setAll(presentContributing ? 1.12 : 1);
    }
    if (this.visuals.handoffOrb && state.handoff) {
      const target = this.worldPoint(state.handoff.x, state.handoff.y, 0.72 + Math.sin(performance.now() * 0.004) * 0.08);
      this.visuals.handoffOrb.position = Vector3.Lerp(this.visuals.handoffOrb.position, target, 0.22);
    }
    if (this.visuals.handoffDelivery && state.handoff) {
      this.visuals.handoffDelivery.scaling.y += ((state.handoff.delivered ? 1.8 : 1) - this.visuals.handoffDelivery.scaling.y) * 0.12;
    }

    const guideTarget = this.targetGuidePosition(state);
    this.visuals.guide.root.setEnabled(Boolean(guideTarget));
    if (guideTarget) {
      this.visuals.guide.root.position = guideTarget;
      const reducedMotion = document.body.classList.contains("reduce-motion");
      const pulse = reducedMotion ? 1 : 1 + Math.sin(performance.now() * 0.006) * 0.1;
      this.visuals.guide.ring.scaling.setAll(pulse);
      this.visuals.guide.arrow.position.y = reducedMotion ? 2.15 : 2.15 + Math.sin(performance.now() * 0.004) * 0.18;
      this.visuals.guide.arrow.rotation.y += reducedMotion ? 0 : 0.012;
    }

    const exitOpen = state.exit.open;
    const present = state.actors.find((actor) => actor.id === "present");
    const focusExit = state.success || Boolean(present && present.x >= state.exit.x - 80);
    const cameraTarget = focusExit ? this.cameraFocus : this.cameraRest;
    this.camera.target = Vector3.Lerp(this.camera.target, cameraTarget, 0.12);
    const restAlpha = focusExit ? CAMERA_ALPHA_EXIT : CAMERA_ALPHA;
    this.camera.alpha += (restAlpha + this.idleDrift() - this.camera.alpha) * 0.12;
    this.camera.radius += ((focusExit ? CAMERA_RADIUS_EXIT : CAMERA_RADIUS) - this.camera.radius) * 0.12;
    const shaftReach = exitOpen ? 0.15 : 0.06;
    this.visuals.exit.light.intensity = exitOpen ? 3 + Math.sin(performance.now() * 0.004) * 0.25 : 1.1;
    this.visuals.exit.portalMaterial.emissiveColor = exitOpen ? new Color3(0.65, 0.42, 0.18) : new Color3(0.08, 0.08, 0.07);
    this.visuals.exit.portalMaterial.alpha = exitOpen ? 0.65 : 0.16;
    this.visuals.exit.slab.position.y += ((exitOpen ? -2.05 : 1.84) - this.visuals.exit.slab.position.y) * 0.12;
    this.visuals.exit.shaftMaterial.emissiveColor = new Color3(shaftReach, shaftReach * 0.94, shaftReach * 0.86);
    this.visuals.exit.spillMaterial.emissiveColor = new Color3(shaftReach, shaftReach * 0.9, shaftReach * 0.78);
    const beamReach = shaftReach * 1.15;
    this.visuals.exit.beamMaterial.emissiveColor = new Color3(beamReach, beamReach * 0.92, beamReach * 0.82);
  }

  /**
   * One-shot beats: the echo materialising as the tape hands over, and the ring
   * that marks a fold. Both are motion, so both sit out under reduced motion.
   */
  private updateBeats(state: Readonly<SimulationState>): void {
    const reduced = this.prefersReducedMotion();
    if (this.lastPhase === "recording" && state.phase === "replay" && !reduced) {
      const past = state.actors.find((actor) => actor.id === "past");
      if (past) {
        this.visuals.burst.emitter = this.worldPoint(past.x, past.y, 0.1);
        this.visuals.burst.manualEmitCount = 70;
        this.visuals.burst.start();
      }
    }
    this.lastPhase = state.phase;

    if (this.rippleAge >= 0) {
      this.rippleAge += 1;
      const life = this.rippleAge / 42;
      if (life >= 1 || reduced) {
        this.visuals.ripple.mesh.setEnabled(false);
        this.rippleAge = -1;
      } else {
        const spread = 0.6 + life * 5.4;
        this.visuals.ripple.mesh.scaling.set(spread, 1, spread);
        const fade = (1 - life) * 0.7;
        this.visuals.ripple.material.emissiveColor.set(fade * 0.34, fade * 0.9, fade);
      }
    }
  }

  private startFoldRipple(): void {
    if (this.prefersReducedMotion()) return;
    const present = this.simulation.state.actors.find((actor) => actor.id === "present");
    if (!present) return;
    this.visuals.ripple.mesh.position = this.worldPoint(present.x, present.y, 0.12);
    this.visuals.ripple.mesh.setEnabled(true);
    this.rippleAge = 0;
  }

  /** Slow alpha sway that only breathes under the title card. */
  private idleDrift(): number {
    if (!this.cinematicIdle || this.prefersReducedMotion()) return 0;
    return Math.sin(this.idleClock * 0.00016) * 0.075;
  }

  private prefersReducedMotion(): boolean {
    return document.body.classList.contains("reduce-motion")
      || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
  }

  /**
   * Frame pacing guard: sustained slow frames step the render resolution down
   * one rung rather than letting the whole scene stutter. Never steps back up —
   * a machine that failed the budget once will fail it again.
   */
  private trackFramePacing(deltaMs: number): void {
    if (this.automatedRenderInterval !== 0 || this.pausedByPlayer) return;
    if (this.scalingRung >= SCALING_LADDER.length - 1) return;
    this.recentFrameMs.push(deltaMs);
    if (this.recentFrameMs.length < SCALING_SAMPLE_WINDOW) return;
    const sorted = [...this.recentFrameMs].sort((left, right) => left - right);
    const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
    this.recentFrameMs = [];
    if (median <= SLOW_FRAME_MS) return;
    this.scalingRung += 1;
    const level = SCALING_LADDER[this.scalingRung] ?? 1.5;
    this.engine.setHardwareScalingLevel(level);
    if (this.scalingRung > 1) this.pipeline.samples = 1;
    console.debug(`[memory-scene] ${median.toFixed(1)}ms frames — render scale stepped to ${level}`);
  }

  private updateHumanoid(rig: HumanoidRig, actor: ActorState): void {
    const target = this.worldPoint(actor.x, actor.y, 0.12);
    const targetId = actor.targetId ?? "";
    const pushing = actor.actionHeld && targetId.includes("weight");
    const operating = actor.actionHeld && (targetId.includes("winch") || targetId.includes("hold"));
    if (pushing) {
      target.x += rig.echo ? -1.15 : -0.68;
      target.z += rig.echo ? 0.64 : -0.64;
    }
    if (operating) target.x -= actor.facingX * 0.48;
    const distance = Vector3.Distance(target, rig.lastPosition);
    const moving = distance > 0.001;
    rig.position = Vector3.Lerp(rig.position, target, 0.5);
    if (moving) rig.gait += 0.3;
    const bob = moving ? Math.abs(Math.sin(rig.gait)) * 0.052 : Math.sin(performance.now() * 0.0025) * 0.012;
    // The echo's ramp scrolls upward; a still echo is a reduced-motion echo.
    if (rig.shimmer && !this.prefersReducedMotion()) rig.shimmer.vOffset = (rig.shimmer.vOffset + 0.0022) % 1;
    rig.root.position = rig.position.add(new Vector3(0, bob, 0));
    const facing = Math.atan2(-actor.facingY, actor.facingX || 0.001);
    rig.root.rotation.y += (shortestAngle(rig.root.rotation.y, facing) - rig.root.rotation.y) * 0.28;
    rig.root.rotation.z += ((pushing ? -0.3 : operating ? -0.12 : 0) - rig.root.rotation.z) * 0.25;

    if (pushing) {
      const shoulderOffset = rig.echo ? -0.08 : 0.08;
      rig.leftShoulder.rotation.z += (1.12 + shoulderOffset - rig.leftShoulder.rotation.z) * 0.25;
      rig.rightShoulder.rotation.z += (1.22 - shoulderOffset - rig.rightShoulder.rotation.z) * 0.25;
      rig.leftElbow.rotation.z += (-0.14 - rig.leftElbow.rotation.z) * 0.25;
      rig.rightElbow.rotation.z += (-0.22 - rig.rightElbow.rotation.z) * 0.25;
      // Lean-in: back leg straight and driving, front knee bent under the load.
      rig.leftHip.rotation.z = rig.echo ? 0.34 : -0.46;
      rig.rightHip.rotation.z = rig.echo ? -0.42 : 0.34;
      rig.leftKnee.rotation.z = rig.echo ? 0.2 : 0.46;
      rig.rightKnee.rotation.z = rig.echo ? 0.48 : 0.18;
    } else if (operating) {
      // Crouch into the winch: weight down, both hands committed to the crank.
      rig.leftShoulder.rotation.z += (0.94 - rig.leftShoulder.rotation.z) * 0.25;
      rig.rightShoulder.rotation.z += (0.94 - rig.rightShoulder.rotation.z) * 0.25;
      rig.leftElbow.rotation.z = 0.34;
      rig.rightElbow.rotation.z = 0.34;
      rig.leftHip.rotation.z = -0.3;
      rig.rightHip.rotation.z = 0.26;
      rig.leftKnee.rotation.z = 0.42;
      rig.rightKnee.rotation.z = 0.38;
    } else if (moving) {
      const swing = Math.sin(rig.gait) * 0.72;
      rig.leftShoulder.rotation.z = swing * 0.62;
      rig.rightShoulder.rotation.z = -swing * 0.62;
      rig.leftElbow.rotation.z = Math.max(0, -swing) * 0.3;
      rig.rightElbow.rotation.z = Math.max(0, swing) * 0.3;
      rig.leftHip.rotation.z = -swing;
      rig.rightHip.rotation.z = swing;
      rig.leftKnee.rotation.z = Math.max(0, swing) * 0.55;
      rig.rightKnee.rotation.z = Math.max(0, -swing) * 0.55;
    } else {
      for (const joint of [rig.leftShoulder, rig.rightShoulder, rig.leftElbow, rig.rightElbow, rig.leftHip, rig.rightHip, rig.leftKnee, rig.rightKnee]) {
        joint.rotation.z *= 0.78;
      }
    }
    rig.lastPosition = target;
  }
}
