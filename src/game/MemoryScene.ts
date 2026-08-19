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
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { DefaultRenderingPipeline } from "@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline";
import { Scene, ScenePerformancePriority } from "@babylonjs/core/scene";
import { InputBit, NEUTRAL_INPUT, type InputFrame } from "../core/input";
import { Simulation } from "../core/simulation";
import { TICK_MS, type ActorId, type ActorState, type ChamberId, type ForceObjectState, type Rect, type SimulationState, type Tape } from "../core/types";
import { CHAMBERS } from "../content/chambers";

const WORLD_SCALE = 0.02;
const MAX_STEPS_PER_FRAME = 4;
const TRAIL_SAMPLE_INTERVAL = 4;
const TRAIL_CAPACITY = 18;

/** Cinematic framing: close enough that a humanoid fills ~1/5 of frame height. */
const CAMERA_RADIUS = 13.5;
const CAMERA_RADIUS_EXIT = 12.2;
const CAMERA_ALPHA = -2.05;
const CAMERA_ALPHA_EXIT = -2.14;

/**
 * Resolution ladder. Rendering starts sharp and only steps down when the
 * machine cannot hold the frame budget — a software rasterizer (or an old
 * integrated GPU) lands on the last rung instead of dropping frames.
 */
const SCALING_LADDER = [1, 1.25, 1.5] as const;
const SLOW_FRAME_MS = 28;
const SCALING_SAMPLE_WINDOW = 60;

type VirtualControl = "up" | "down" | "left" | "right" | "action";

interface HumanoidRig {
  echo: boolean;
  root: TransformNode;
  meshes: AbstractMesh[];
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
}

interface TargetGuideVisual {
  root: TransformNode;
  ring: Mesh;
  arrow: Mesh;
}

interface WorldVisuals {
  root: TransformNode;
  bridge: BridgeVisual | null;
  winch: WinchVisual | null;
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
  private trailTick = 0;
  private trailPositions: Vector3[] = [];
  private scalingRung = 0;
  private recentFrameMs: number[] = [];
  private cinematicIdle = false;
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
    this.engine.setHardwareScalingLevel(SCALING_LADDER[this.scalingRung] ?? 1);
    this.scene = new Scene(this.engine);
    this.scene.performancePriority = ScenePerformancePriority.Aggressive;
    this.scene.clearColor = new Color4(0.004, 0.008, 0.014, 1);
    this.scene.ambientColor = new Color3(0.07, 0.086, 0.115);
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
    this.pipeline.samples = 4;
    this.pipeline.bloomEnabled = true;
    this.pipeline.bloomThreshold = 0.65;
    this.pipeline.bloomWeight = 0.25;
    this.pipeline.bloomKernel = 48;
    const grade = this.pipeline.imageProcessing;
    grade.toneMappingEnabled = true;
    grade.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
    grade.contrast = 1.35;
    grade.exposure = 1.4;
    grade.vignetteEnabled = true;
    grade.vignetteWeight = 2.2;
    grade.vignetteStretch = 0.35;
    grade.vignetteColor = new Color4(0.012, 0.024, 0.06, 1);
    grade.vignetteBlendMode = ImageProcessingConfiguration.VIGNETTEMODE_MULTIPLY;

    // Cool steel-blue ambient stands in for the vault's own gloom; every warm
    // value in the room comes from the doorway instead.
    const sky = new HemisphericLight("memory-sky", new Vector3(-0.2, 1, 0.35), this.scene);
    sky.diffuse = new Color3(0.36, 0.5, 0.72);
    sky.groundColor = new Color3(0.022, 0.03, 0.048);
    sky.intensity = 1.05;
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

    this.visuals = this.buildWorld();
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

  setEventsAdapter(adapter: MemorySceneEvents): void {
    this.eventsAdapter = adapter;
    this.publish();
  }

  switchChamber(chamberId: ChamberId): void {
    this.simulation = new Simulation(CHAMBERS[chamberId]);
    this.accumulator = 0;
    this.previousAction = false;
    this.recordingStarted = false;
    this.trailTick = 0;
    this.trailPositions = [];
    this.disposeActorVisuals();
    this.disposeWorld();
    this.visuals = this.buildWorld();
    this.eventsAdapter?.onChamberChange(chamberId);
    this.updateVisuals(this.simulation.state);
    this.publish();
  }

  rerecord(): void {
    this.simulation.rerecord();
    this.accumulator = 0;
    this.previousAction = false;
    this.recordingStarted = false;
    this.trailTick = 0;
    this.trailPositions = [];
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
    this.trailTick = 0;
    this.trailPositions = [];
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
        this.captureTrail();
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

  private createStoneMaterial(name: string, seed: number): StandardMaterial {
    const texture = new DynamicTexture(`${name}-texture`, { width: 512, height: 512 }, this.scene, false);
    const context = texture.getContext();
    context.fillStyle = "#20262a";
    context.fillRect(0, 0, 512, 512);
    let value = seed >>> 0;
    const random = (): number => {
      value = (value * 1664525 + 1013904223) >>> 0;
      return value / 0xffffffff;
    };
    const tileSize = 64;
    for (let row = 0; row < 8; row += 1) {
      for (let column = 0; column < 8; column += 1) {
        const inset = 3 + random() * 3;
        const shade = 28 + Math.floor(random() * 20);
        context.fillStyle = `rgb(${shade}, ${shade + 5}, ${shade + 7})`;
        context.fillRect(column * tileSize + inset, row * tileSize + inset, tileSize - inset * 2, tileSize - inset * 2);
        context.strokeStyle = `rgba(156, 143, 116, ${0.08 + random() * 0.1})`;
        context.lineWidth = 1.5;
        context.strokeRect(column * tileSize + inset, row * tileSize + inset, tileSize - inset * 2, tileSize - inset * 2);
      }
    }
    for (let index = 0; index < 46; index += 1) {
      const startX = random() * 512;
      const startY = random() * 512;
      context.beginPath();
      context.moveTo(startX, startY);
      for (let segment = 1; segment <= 3; segment += 1) {
        context.lineTo(startX + (random() - 0.5) * 55 * segment, startY + random() * 28 * segment);
      }
      context.strokeStyle = `rgba(4, 7, 9, ${0.28 + random() * 0.35})`;
      context.lineWidth = 1 + random() * 2;
      context.stroke();
    }
    for (let index = 0; index < 900; index += 1) {
      const shade = random() > 0.55 ? 110 : 8;
      context.fillStyle = `rgba(${shade}, ${shade}, ${shade}, ${0.02 + random() * 0.035})`;
      context.fillRect(random() * 512, random() * 512, 1 + random() * 2, 1 + random() * 2);
    }
    texture.wrapU = Texture.WRAP_ADDRESSMODE;
    texture.wrapV = Texture.WRAP_ADDRESSMODE;
    texture.uScale = 3;
    texture.vScale = 3;
    texture.update(false);
    const stone = material(this.scene, name, new Color3(0.72, 0.75, 0.78), Color3.Black(), 1, new Color3(0.18, 0.2, 0.22));
    stone.diffuseTexture = texture;
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

  private buildWorld(): WorldVisuals {
    const root = new TransformNode(`world-${this.simulation.chamber.id}`, this.scene);
    const chamber = this.simulation.chamber;
    this.updateCameraFraming();
    const roomWidth = chamber.world.width * WORLD_SCALE;
    const roomDepth = chamber.world.height * WORLD_SCALE;
    const materialSeed = [...chamber.id].reduce((sum, character) => sum + character.charCodeAt(0), 17);
    const basalt = this.createStoneMaterial("basalt", materialSeed);
    const basaltEdge = this.createStoneMaterial("basalt-edge", materialSeed * 7);
    const metal = material(this.scene, "aged-metal", new Color3(0.09, 0.105, 0.12), Color3.Black(), 1, new Color3(0.34, 0.36, 0.38));
    const bronze = material(this.scene, "memory-bronze", new Color3(0.3, 0.2, 0.09), new Color3(0.035, 0.018, 0.004), 1, new Color3(0.48, 0.32, 0.13));
    const voidMaterial = material(this.scene, "memory-void", new Color3(0.002, 0.006, 0.012), new Color3(0, 0.025, 0.06));
    const cyan = material(this.scene, "temporal-cyan", new Color3(0.025, 0.24, 0.32), new Color3(0.02, 0.68, 0.94));
    const cyanGlass = material(this.scene, "temporal-glass", new Color3(0.015, 0.18, 0.24), new Color3(0.02, 0.38, 0.56), 0.48);
    const amber = material(this.scene, "living-amber", new Color3(0.55, 0.25, 0.065), new Color3(0.2, 0.07, 0.008));
    const white = material(this.scene, "exit-white", new Color3(0.82, 0.78, 0.67), new Color3(0.9, 0.82, 0.62), 0.82);

    const lowerVault = MeshBuilder.CreateBox("lower-vault-floor", {
      width: roomWidth + 10,
      depth: roomDepth + 8,
      height: 0.4,
    }, this.scene);
    lowerVault.position = new Vector3(1.8, -2.15, 0.8);
    lowerVault.material = basaltEdge;
    this.registerMesh(lowerVault, root, false);
    for (const [index, x] of [-7.5, -3.5, 0.5, 4.5, 8.5, 12.5].entries()) {
      const lowerPier = MeshBuilder.CreateBox(`lower-vault-pier-${index}`, { width: 0.8, depth: 1.1, height: 4.2 }, this.scene);
      lowerPier.position = new Vector3(x, -3.9, 3.9 - index % 2 * 1.2);
      lowerPier.material = basalt;
      this.registerMesh(lowerPier, root, false);
    }

    const foundation = MeshBuilder.CreateBox("chamber-foundation", {
      width: roomWidth - 0.3,
      depth: roomDepth - 0.3,
      height: 0.24,
    }, this.scene);
    foundation.position.y = -0.16;
    foundation.material = basalt;
    this.registerMesh(foundation, root, false);

    for (let index = 0; index < 15; index += 1) {
      const slab = MeshBuilder.CreateBox(`floor-slab-${index}`, { width: 0.86, depth: 3.35, height: 0.055 }, this.scene);
      slab.position = new Vector3(-6.45 + index * 0.92, -0.005 + (index % 3) * 0.003, 0);
      slab.material = index % 2 === 0 ? basaltEdge : basalt;
      this.registerMesh(slab, root, false);
    }
    for (const z of [-1.82, 1.82]) {
      const inlay = MeshBuilder.CreateBox(`bronze-inlay-${z}`, { width: roomWidth - 1.2, depth: 0.055, height: 0.035 }, this.scene);
      inlay.position = new Vector3(0, 0.04, z);
      inlay.material = bronze;
      this.registerMesh(inlay, root, false);
    }

    for (const [index, wall] of chamber.walls.entries()) {
      const boundary = wall.x === 0 || wall.y === 0 || wall.x + wall.width === chamber.world.width || wall.y + wall.height === chamber.world.height;
      const wallHeight = boundary ? 0.72 : 0.48;
      this.createBox(`wall-${index}`, wall, wallHeight, boundary ? basaltEdge : basalt, root, wallHeight / 2);
      if (!boundary) this.createBox(`wall-cap-${index}`, wall, 0.08, bronze, root, wallHeight + 0.04);
    }
    const backWall = MeshBuilder.CreateBox("memory-vault-backdrop", { width: roomWidth + 12, depth: 0.48, height: 8 }, this.scene);
    backWall.position = new Vector3(2.2, 3.65, roomDepth / 2 - 0.18);
    backWall.material = basalt;
    this.registerMesh(backWall, root);
    for (let index = 0; index < 8; index += 1) {
      const x = -7.2 + index * 2.65;
      const z = 4.08;
      const pillarHeight = 3.1 + (index % 2) * 0.5;
      const pillar = MeshBuilder.CreateBox(`ruin-pillar-${index}`, { width: 0.48, depth: 0.55, height: pillarHeight }, this.scene);
      pillar.position = new Vector3(x, pillarHeight / 2, z);
      pillar.material = basaltEdge;
      this.registerMesh(pillar, root);
      const cap = MeshBuilder.CreateBox(`ruin-cap-${index}`, { width: 0.7, depth: 0.72, height: 0.18 }, this.scene);
      cap.position = new Vector3(x, pillarHeight + 0.09, z);
      cap.material = bronze;
      this.registerMesh(cap, root);
      const rune = MeshBuilder.CreateBox(`wall-rune-${index}`, { width: 0.3, depth: 0.035, height: 1.25 }, this.scene);
      rune.position = new Vector3(x, 1.6, z - 0.31);
      rune.material = index < 2 ? cyanGlass : bronze;
      this.registerMesh(rune, root, false);
      if (index < 7) {
        const beam = MeshBuilder.CreateBox(`vault-beam-${index}`, { width: 2.18, depth: 0.42, height: 0.26 }, this.scene);
        beam.position = new Vector3(x + 1.32, 4.2 + (index % 2) * 0.34, z - 0.02);
        beam.material = basaltEdge;
        this.registerMesh(beam, root);
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

    let bridge: BridgeVisual | null = null;
    if (chamber.door) {
      const center = this.rectCenter(chamber.door.rect, 0);
      const chasm = MeshBuilder.CreateBox("memory-chasm", { width: 1.8, depth: roomDepth - 0.65, height: 0.05 }, this.scene);
      chasm.position = new Vector3(center.x, -3.25, 0);
      chasm.material = voidMaterial;
      this.registerMesh(chasm, root, false);
      for (const offset of [-0.96, 0.96]) {
        const chasmWall = MeshBuilder.CreateBox(`chasm-wall-${offset}`, { width: 0.2, depth: roomDepth - 0.65, height: 6.4 }, this.scene);
        chasmWall.position = new Vector3(center.x + offset, -3.15, 0);
        chasmWall.material = basaltEdge;
        this.registerMesh(chasmWall, root, false);
      }
      for (const offset of [-0.84, 0.84]) {
        const edge = MeshBuilder.CreateBox(`chasm-edge-${offset}`, { width: 0.055, depth: roomDepth - 0.65, height: 0.07 }, this.scene);
        edge.position = new Vector3(center.x + offset, 0.07, 0);
        edge.material = cyan;
        this.registerMesh(edge, root, false);
      }
      for (const z of [-2.9, 0, 2.9]) {
        const depthRune = MeshBuilder.CreateCylinder(`chasm-rune-${z}`, { diameter: 0.15, height: 3.8, tessellation: 10 }, this.scene);
        depthRune.position = new Vector3(center.x, -2.05, z);
        depthRune.material = cyan;
        this.registerMesh(depthRune, root, false);
        this.glow.addIncludedOnlyMesh(depthRune);
      }
      const bridgeRoot = new TransformNode("bridge-root", this.scene);
      bridgeRoot.parent = root;
      bridgeRoot.position = new Vector3(center.x, -1.15, center.z);
      const deckDepth = Math.max(1.35, chamber.door.rect.height * WORLD_SCALE * 0.92);
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
      bridge = { root: bridgeRoot, openY: 0.13, closedY: -1.15 };
      const chasmLight = new PointLight("chasm-light", new Vector3(center.x, -1.9, center.z), this.scene);
      chasmLight.diffuse = new Color3(0.02, 0.45, 0.8);
      chasmLight.intensity = 7;
      chasmLight.range = 8;
      chasmLight.parent = root;
      const mist = MeshBuilder.CreateBox("chasm-memory-mist", { width: 1.5, depth: roomDepth - 0.9, height: 0.12 }, this.scene);
      mist.position = new Vector3(center.x, -2.72, 0);
      mist.material = cyanGlass;
      this.registerMesh(mist, root, false);
      for (const z of [-2.7, 0, 2.7]) {
        const lowerBrace = MeshBuilder.CreateBox(`chasm-lower-brace-${z}`, { width: 1.72, depth: 0.28, height: 0.26 }, this.scene);
        lowerBrace.position = new Vector3(center.x, -2.28, z);
        lowerBrace.material = metal;
        this.registerMesh(lowerBrace, root, false);
      }
    }

    const winch = chamber.hold ? this.createWinch(chamber.hold.x, chamber.hold.y, chamber.door?.rect ?? null, metal, bronze, cyan, root) : null;
    const weight = chamber.forceObject ? this.createWeight(chamber.forceObject, basaltEdge, metal, bronze, cyan, amber, root) : null;

    let handoffOrb: Mesh | null = null;
    let handoffDelivery: Mesh | null = null;
    if (chamber.handoff) {
      handoffOrb = MeshBuilder.CreateSphere("memory-core", { diameter: 0.54, segments: 24 }, this.scene);
      handoffOrb.position = this.worldPoint(chamber.handoff.x, chamber.handoff.y, 0.72);
      handoffOrb.material = cyan;
      this.registerMesh(handoffOrb, root, false);
      this.glow.addIncludedOnlyMesh(handoffOrb);
      handoffDelivery = this.createBox("memory-cradle", chamber.handoff.delivery, 0.42, metal, root, 0.2);
      const altar = MeshBuilder.CreateCylinder("handoff-altar", { diameter: 1.2, height: 0.2, tessellation: 8 }, this.scene);
      altar.position = this.rectCenter(chamber.handoff.delivery, 0.42);
      altar.material = bronze;
      this.registerMesh(altar, root);
      const junction = MeshBuilder.CreateTorus("handoff-junction", { diameter: chamber.handoff.junction.radius * WORLD_SCALE * 2, thickness: 0.065, tessellation: 36 }, this.scene);
      junction.position = this.worldPoint(chamber.handoff.junction.x, chamber.handoff.junction.y, 0.08);
      junction.material = cyanGlass;
      this.registerMesh(junction, root, false);
    }

    const exit = this.createExit(chamber.exit, basaltEdge, bronze, white, root);
    const guide = this.createTargetGuide(root);
    // Architecture materials never change after the chamber is built; the
    // signal materials (cyan/amber/portal/rune) keep animating their emissive.
    for (const stoneLike of [basalt, basaltEdge, metal, bronze, voidMaterial]) stoneLike.freeze();
    return { root, bridge, winch, weight, handoffOrb, handoffDelivery, exit, guide };
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
    for (const z of [-0.58, 0.58]) {
      const wheel = MeshBuilder.CreateTorus(`winch-wheel-${z}`, { diameter: 0.92, thickness: 0.11, tessellation: 28 }, this.scene);
      wheel.position = new Vector3(0, 0.83, z);
      wheel.rotation.x = Math.PI / 2;
      wheel.material = bronze;
      this.registerMesh(wheel, root);
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
    root.rotation.y = -1.02;
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
    const tunnelStone = material(this.scene, "exit-tunnel-stone", new Color3(0.22, 0.21, 0.18), new Color3(0.035, 0.026, 0.016), 1, new Color3(0.12, 0.1, 0.07));
    const tunnelFloor = MeshBuilder.CreateBox("exit-tunnel-floor", { width: 4.4, depth: depth - 0.24, height: 0.035 }, this.scene);
    tunnelFloor.position = new Vector3(2.1, -0.017, 0);
    tunnelFloor.material = tunnelStone;
    this.registerMesh(tunnelFloor, root);
    const farArchRim = material(this.scene, "exit-far-arch-rim", new Color3(0.42, 0.25, 0.08), new Color3(0.15, 0.065, 0.015));
    for (let index = 0; index < 4; index += 1) {
      const x = 0.18 + index * 1.1;
      const scale = 1 - index * 0.14;
      const archHeight = 3.62 * scale;
      const openingDepth = (depth - 0.08) * scale;
      for (const z of [-openingDepth / 2, openingDepth / 2]) {
        const upright = MeshBuilder.CreateBox(`exit-arch-upright-${index}-${z}`, { width: 0.28, depth: 0.3, height: archHeight }, this.scene);
        upright.position = new Vector3(x, archHeight / 2, z);
        upright.material = tunnelStone;
        this.registerMesh(upright, root);
        const inset = MeshBuilder.CreateBox(`exit-arch-inset-${index}-${z}`, { width: 0.055, depth: 0.12, height: archHeight * 0.82 }, this.scene);
        inset.position = new Vector3(x - 0.17, archHeight * 0.43, z * 0.94);
        inset.material = index >= 2 ? farArchRim : bronze;
        this.registerMesh(inset, root, false);
      }
      const archTop = MeshBuilder.CreateBox(`exit-arch-top-${index}`, { width: 0.28, depth: openingDepth + 0.34, height: 0.3 }, this.scene);
      archTop.position = new Vector3(x, archHeight, 0);
      archTop.material = tunnelStone;
      this.registerMesh(archTop, root);
      const topInset = MeshBuilder.CreateBox(`exit-arch-top-inset-${index}`, { width: 0.055, depth: openingDepth * 0.86, height: 0.075 }, this.scene);
      topInset.position = new Vector3(x - 0.17, archHeight - 0.18, 0);
      topInset.material = index >= 2 ? farArchRim : bronze;
      this.registerMesh(topInset, root, false);
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
    const light = new PointLight("exit-beacon", new Vector3(4.72, 0.88, 0), this.scene);
    light.diffuse = new Color3(1, 0.86, 0.62);
    light.intensity = 5.2;
    light.range = 9;
    light.parent = root;
    const { shaft, shaftMaterial, spillMaterial } = this.createLightShaft(root);
    void white;
    return { root, portal, slab, portalMaterial, light, shaft, shaftMaterial, spillMaterial };
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
   * The doorway light is geometry, not a post-process. The tunnel points back
   * at the camera, so a cone would only ever be seen end-on: instead the
   * opening carries an additive halo and the floor keeps the spill that
   * streams out of it.
   */
  private createLightShaft(exitRoot: TransformNode): {
    shaft: TransformNode;
    shaftMaterial: StandardMaterial;
    spillMaterial: StandardMaterial;
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
    const halo = place(MeshBuilder.CreatePlane("exit-shaft-halo", { width: 1.9, height: 2.6 }, this.scene), shaftMaterial);
    halo.rotation.y = -Math.PI / 2;
    halo.position = new Vector3(4.42, 1.15, 0);
    this.glow.addIncludedOnlyMesh(halo);
    const throat = place(MeshBuilder.CreatePlane("exit-shaft-throat", { width: 1.15, height: 1.75 }, this.scene), shaftMaterial);
    throat.rotation.y = -Math.PI / 2;
    throat.position = new Vector3(3.05, 0.95, 0);

    const spillMaterial = this.createShaftMaterial("exit-spill", this.createShaftTexture("exit-spill-falloff", 40));
    const spill = place(MeshBuilder.CreatePlane("exit-shaft-spill", { width: 3.6, height: 5.6 }, this.scene), spillMaterial);
    spill.rotation.x = Math.PI / 2;
    spill.rotation.z = -Math.PI / 2;
    spill.position = new Vector3(0.35, 0.03, 0);
    return { shaft, shaftMaterial, spillMaterial };
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

  private createHumanoid(id: ActorId, echo: boolean): HumanoidRig {
    const root = new TransformNode(`human-${id}`, this.scene);
    const position = this.worldPoint(this.simulation.chamber.spawn.x, this.simulation.chamber.spawn.y, 0.12);
    root.position = position.clone();
    root.scaling.setAll(1.16);
    const echoMaterial = material(this.scene, `echo-body-${id}`, new Color3(0.04, 0.35, 0.48), new Color3(0.04, 0.45, 0.68));
    const jacket = echo ? echoMaterial : material(this.scene, `amber-jacket-${id}`, new Color3(0.52, 0.31, 0.12), new Color3(0.05, 0.014, 0));
    const skin = echo ? echoMaterial : material(this.scene, `skin-${id}`, new Color3(0.46, 0.3, 0.21));
    const cloth = echo ? echoMaterial : material(this.scene, `cloth-${id}`, new Color3(0.055, 0.065, 0.075));
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

    const torso = addBodyMesh(MeshBuilder.CreateCapsule(`human-${id}-torso`, { radius: 0.28, height: 0.78, tessellation: 14, subdivisions: 2, capSubdivisions: 5 }, this.scene), jacket);
    torso.position.y = 1.34;
    torso.scaling = new Vector3(0.72, 1, 1.08);
    torso.rotation.z = -0.05;
    const pelvis = addBodyMesh(MeshBuilder.CreateCapsule(`human-${id}-pelvis`, { radius: 0.22, height: 0.34, tessellation: 12, subdivisions: 1, capSubdivisions: 4 }, this.scene), cloth);
    pelvis.position.y = 0.89;
    pelvis.scaling.z = 1.1;
    const head = addBodyMesh(MeshBuilder.CreateSphere(`human-${id}-head`, { diameter: 0.36, segments: 16 }, this.scene), skin);
    head.position = new Vector3(0.02, 1.9, 0);
    const neck = addBodyMesh(MeshBuilder.CreateCylinder(`human-${id}-neck`, { diameter: 0.15, height: 0.16, tessellation: 10 }, this.scene), skin);
    neck.position.y = 1.68;
    if (!echo) {
      const hair = addBodyMesh(MeshBuilder.CreateSphere(`human-${id}-hair`, { diameter: 0.37, segments: 12, slice: 0.55 }, this.scene), cloth);
      hair.position = new Vector3(0.01, 1.97, 0);
      hair.rotation.z = Math.PI;
    }

    const leftShoulder = new TransformNode(`human-${id}-left-shoulder`, this.scene);
    const rightShoulder = new TransformNode(`human-${id}-right-shoulder`, this.scene);
    leftShoulder.position = new Vector3(0, 1.57, -0.38);
    rightShoulder.position = new Vector3(0, 1.57, 0.38);
    leftShoulder.parent = rightShoulder.parent = root;
    const leftUpperArm = this.createLimb(`human-${id}-left-upper-arm`, 0.48, 0.105, jacket, leftShoulder, echo);
    const rightUpperArm = this.createLimb(`human-${id}-right-upper-arm`, 0.48, 0.105, jacket, rightShoulder, echo);
    meshes.push(leftUpperArm, rightUpperArm);
    const leftElbow = new TransformNode(`human-${id}-left-elbow`, this.scene);
    const rightElbow = new TransformNode(`human-${id}-right-elbow`, this.scene);
    leftElbow.position.y = rightElbow.position.y = -0.46;
    leftElbow.parent = leftShoulder;
    rightElbow.parent = rightShoulder;
    const leftLowerArm = this.createLimb(`human-${id}-left-lower-arm`, 0.43, 0.085, skin, leftElbow, echo);
    const rightLowerArm = this.createLimb(`human-${id}-right-lower-arm`, 0.43, 0.085, skin, rightElbow, echo);
    meshes.push(leftLowerArm, rightLowerArm);
    for (const [name, elbow] of [["left", leftElbow], ["right", rightElbow]] as const) {
      const hand = MeshBuilder.CreateSphere(`human-${id}-${name}-hand`, { diameter: 0.19, segments: 10 }, this.scene);
      hand.position.y = -0.45;
      hand.material = skin;
      hand.parent = elbow;
      hand.isPickable = false;
      if (!echo) this.shadows.addShadowCaster(hand);
      meshes.push(hand);
    }

    const leftHip = new TransformNode(`human-${id}-left-hip`, this.scene);
    const rightHip = new TransformNode(`human-${id}-right-hip`, this.scene);
    leftHip.position = new Vector3(0, 0.82, -0.18);
    rightHip.position = new Vector3(0, 0.82, 0.18);
    leftHip.parent = rightHip.parent = root;
    const leftThigh = this.createLimb(`human-${id}-left-thigh`, 0.52, 0.13, cloth, leftHip, echo);
    const rightThigh = this.createLimb(`human-${id}-right-thigh`, 0.52, 0.13, cloth, rightHip, echo);
    meshes.push(leftThigh, rightThigh);
    const leftKnee = new TransformNode(`human-${id}-left-knee`, this.scene);
    const rightKnee = new TransformNode(`human-${id}-right-knee`, this.scene);
    leftKnee.position.y = rightKnee.position.y = -0.5;
    leftKnee.parent = leftHip;
    rightKnee.parent = rightHip;
    const leftShin = this.createLimb(`human-${id}-left-shin`, 0.52, 0.105, cloth, leftKnee, echo);
    const rightShin = this.createLimb(`human-${id}-right-shin`, 0.52, 0.105, cloth, rightKnee, echo);
    meshes.push(leftShin, rightShin);
    for (const [name, z] of [["left", -0.18], ["right", 0.18]] as const) {
      const boot = addBodyMesh(MeshBuilder.CreateBox(`human-${id}-${name}-boot`, { width: 0.38, depth: 0.18, height: 0.16 }, this.scene), cloth);
      boot.position = new Vector3(0.09, 0.16, z);
    }
    return {
      echo,
      root,
      meshes,
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
      rig.root.dispose(false, true);
    }
    this.actorVisuals.clear();
  }

  private disposeWorld(): void {
    for (const mesh of this.visuals.root.getChildMeshes()) this.shadows.removeShadowCaster(mesh);
    this.visuals.root.dispose(false, true);
  }

  private captureTrail(): void {
    const past = this.simulation.state.actors.find((actor) => actor.id === "past");
    if (!past || this.simulation.state.phase !== "replay") return;
    this.trailTick += 1;
    if (this.trailTick % TRAIL_SAMPLE_INTERVAL !== 0) return;
    this.trailPositions.push(this.worldPoint(past.x, past.y, 0.04));
    if (this.trailPositions.length > TRAIL_CAPACITY) this.trailPositions.shift();
  }

  private targetGuidePosition(state: Readonly<SimulationState>): Vector3 | null {
    if (state.success) return null;
    const exit = (): Vector3 => this.rectCenter(state.exit, 0.05);
    const hold = (): Vector3 | null => state.hold ? this.worldPoint(state.hold.x, state.hold.y, 0.02) : null;
    const weight = (): Vector3 | null => state.forceObject
      ? this.worldPoint(state.forceObject.x - 24, state.forceObject.y + state.forceObject.height / 2, 0.02)
      : null;

    switch (state.chamberId) {
      case "crossing":
        return state.phase === "recording" || state.phase === "rerecord" ? hold() : exit();
      case "traceWeight":
        if (state.phase === "recording" || state.phase === "rerecord") {
          return state.tapeTick < 110 ? hold() : weight();
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
        if (!state.handoff.stagedByPast) return this.worldPoint(state.handoff.x, state.handoff.y, 0.02);
        if (!state.handoff.receivedByPresent) return this.worldPoint(state.handoff.junction.x, state.handoff.junction.y, 0.02);
        if (!state.handoff.delivered) return this.rectCenter(state.handoff.delivery, 0.02);
        return exit();
      case "lastHold":
        return state.phase === "recording" || state.phase === "rerecord" ? hold() : exit();
    }
  }

  private updateVisuals(state: Readonly<SimulationState>): void {
    const activeIds = new Set(state.actors.map((actor) => actor.id));
    for (const [id, rig] of this.actorVisuals) {
      if (activeIds.has(id)) continue;
      for (const mesh of rig.meshes) this.shadows.removeShadowCaster(mesh);
      rig.root.dispose(false, true);
      this.actorVisuals.delete(id);
    }
    for (const actor of state.actors) {
      let rig = this.actorVisuals.get(actor.id);
      const shouldEcho = actor.id === "past" && state.phase !== "recording";
      if (rig && rig.echo !== shouldEcho) {
        for (const mesh of rig.meshes) this.shadows.removeShadowCaster(mesh);
        rig.root.dispose(false, true);
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
    const shaftReach = exitOpen ? 0.3 : 0.12;
    this.visuals.exit.light.intensity = exitOpen ? 6.2 + Math.sin(performance.now() * 0.004) * 0.4 : 1.8;
    this.visuals.exit.portalMaterial.emissiveColor = exitOpen ? new Color3(0.65, 0.42, 0.18) : new Color3(0.08, 0.08, 0.07);
    this.visuals.exit.portalMaterial.alpha = exitOpen ? 0.65 : 0.16;
    this.visuals.exit.slab.position.y += ((exitOpen ? -2.05 : 1.84) - this.visuals.exit.slab.position.y) * 0.12;
    this.visuals.exit.shaftMaterial.emissiveColor = new Color3(shaftReach, shaftReach * 0.94, shaftReach * 0.86);
    this.visuals.exit.spillMaterial.emissiveColor = new Color3(shaftReach, shaftReach * 0.9, shaftReach * 0.78);
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
    if (moving) rig.gait += 0.34;
    const bob = moving ? Math.abs(Math.sin(rig.gait)) * 0.035 : Math.sin(performance.now() * 0.0025) * 0.012;
    rig.root.position = rig.position.add(new Vector3(0, bob, 0));
    const facing = Math.atan2(-actor.facingY, actor.facingX || 0.001);
    rig.root.rotation.y += (shortestAngle(rig.root.rotation.y, facing) - rig.root.rotation.y) * 0.28;
    rig.root.rotation.z += ((pushing ? -0.18 : 0) - rig.root.rotation.z) * 0.25;

    if (pushing) {
      const shoulderOffset = rig.echo ? -0.08 : 0.08;
      rig.leftShoulder.rotation.z += (1.12 + shoulderOffset - rig.leftShoulder.rotation.z) * 0.25;
      rig.rightShoulder.rotation.z += (1.22 - shoulderOffset - rig.rightShoulder.rotation.z) * 0.25;
      rig.leftElbow.rotation.z += (-0.14 - rig.leftElbow.rotation.z) * 0.25;
      rig.rightElbow.rotation.z += (-0.22 - rig.rightElbow.rotation.z) * 0.25;
      rig.leftHip.rotation.z = rig.echo ? 0.28 : -0.34;
      rig.rightHip.rotation.z = rig.echo ? -0.32 : 0.24;
      rig.leftKnee.rotation.z = rig.echo ? 0.18 : 0.34;
      rig.rightKnee.rotation.z = rig.echo ? 0.36 : 0.16;
    } else if (operating) {
      rig.leftShoulder.rotation.z += (0.88 - rig.leftShoulder.rotation.z) * 0.25;
      rig.rightShoulder.rotation.z += (0.88 - rig.rightShoulder.rotation.z) * 0.25;
      rig.leftElbow.rotation.z = 0.3;
      rig.rightElbow.rotation.z = 0.3;
      rig.leftHip.rotation.z = -0.12;
      rig.rightHip.rotation.z = 0.12;
    } else if (moving) {
      const swing = Math.sin(rig.gait) * 0.55;
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
