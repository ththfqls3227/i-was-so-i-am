import { Engine } from "@babylonjs/core/Engines/engine";
import { GlowLayer } from "@babylonjs/core/Layers/glowLayer";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { ImageProcessingConfiguration } from "@babylonjs/core/Materials/imageProcessingConfiguration";
import type { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3, Vector4 } from "@babylonjs/core/Maths/math.vector";
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { DefaultRenderingPipeline } from "@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline";
import { Scene } from "@babylonjs/core/scene";

import { Simulation, simConstants } from "../sim/simulation";
import { encodeFrame } from "../sim/input";
import { radiansFromYawUnits, yawUnitsFromRadians } from "../sim/trig";
import type { ActorId, ActorState, SimState } from "../sim/types";
import { AWAKENING, ROOM_SHELL } from "../world/room";
import { echoMaterial, matteMaterial, panelMaterial, scratchContext, signalMaterial } from "./materials";
import { createHumanoid, poseHumanoid, type Humanoid } from "./rig";

// One texture tile carries a 2x2 block of panels, so this is a 1.2 m module.
const PANEL_MODULE = 2.4;
const CYAN = new Color3(0.24, 0.78, 0.95);
const AMBER = new Color3(1, 0.62, 0.24);

export const DEFAULT_MOUSE_SENSITIVITY = 0.0022;
const PITCH_LIMIT = 1.5;

export interface ViewModel {
  phase: SimState["phase"];
  tapeTick: number;
  tapeDuration: number;
  replaySpan: number;
  canFold: boolean;
  focus: string | null;
  plateActive: boolean;
  doorOpen: boolean;
  echoPresent: boolean;
  success: boolean;
  lastError: SimState["lastError"];
  foldedAtTick: number | null;
  fps: number;
  paused: boolean;
  started: boolean;
}

export interface SceneEvents {
  onFrame: (view: ViewModel) => void;
  onPhaseChange: (phase: SimState["phase"], previous: SimState["phase"]) => void;
  onFold: () => void;
}

interface Snapshot {
  x: number;
  y: number;
  z: number;
  yaw: number;
  speed: number;
  grounded: boolean;
}

function snapshotOf(actor: ActorState): Snapshot {
  return {
    x: actor.x,
    y: actor.y,
    z: actor.z,
    yaw: radiansFromYawUnits(actor.yawUnits),
    speed: Math.sqrt(actor.vx * actor.vx + actor.vz * actor.vz),
    grounded: actor.grounded,
  };
}

function lerp(from: number, to: number, alpha: number): number {
  return from + (to - from) * alpha;
}

/** Interpolating a heading has to take the short way round or it spins on the wrap. */
function lerpAngle(from: number, to: number, alpha: number): number {
  let delta = to - from;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return from + delta * alpha;
}

export class FirstPersonScene {
  readonly canvas: HTMLCanvasElement;
  private readonly engine: Engine;
  private readonly scene: Scene;
  private readonly camera: UniversalCamera;
  private readonly glow: GlowLayer;
  private readonly pipeline: DefaultRenderingPipeline;
  private simulation = new Simulation(AWAKENING);
  private events: SceneEvents | null = null;

  private readonly pressed = new Set<string>();
  private yaw = radiansFromYawUnits(AWAKENING.spawn.yawUnits);
  private pitch = 0;
  private sensitivity = DEFAULT_MOUSE_SENSITIVITY;
  private pointerLocked = false;

  private previous = new Map<ActorId, Snapshot>();
  private current = new Map<ActorId, Snapshot>();
  private stride = new Map<ActorId, number>();
  private accumulator = 0;
  private lastFrameTime = 0;
  private bobPhase = 0;
  private clock = 0;
  private fps = 60;
  private running = false;
  private paused = true;
  private started = false;

  private echo: Humanoid;
  private echoMaterials: StandardMaterial[] = [];
  private doorSlab: Mesh;
  private doorOffset = 0;
  private plateRing: Mesh;
  private plateGlow: PointLight;
  private plateRingMaterial: StandardMaterial;
  private shadows: ShadowGenerator | null = null;
  private readonly resizeObserver: ResizeObserver;

  constructor(parent: HTMLElement) {
    this.canvas = document.createElement("canvas");
    this.canvas.id = "fp-canvas";
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute("aria-label", "I WAS, SO I AM — first-person view");
    parent.appendChild(this.canvas);

    this.engine = new Engine(this.canvas, true, {
      adaptToDeviceRatio: true,
      antialias: true,
      powerPreference: "high-performance",
      preserveDrawingBuffer: false,
      stencil: true,
    });
    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0.06, 0.07, 0.08, 1);
    // Low, so the lights have somewhere to go. A high flat ambient is what
    // flattens a white room into a single value with no light in it.
    this.scene.ambientColor = new Color3(0.1, 0.105, 0.12);
    this.scene.fogMode = Scene.FOGMODE_EXP2;
    this.scene.fogDensity = 0.008;
    this.scene.fogColor = new Color3(0.66, 0.69, 0.74);

    this.camera = new UniversalCamera("fp-camera", new Vector3(0, simConstants.eyeHeight, AWAKENING.spawn.z), this.scene);
    this.camera.inputs.clear();
    this.camera.rotationQuaternion = null;
    this.camera.fov = 1.05;
    this.camera.minZ = 0.08;
    this.camera.maxZ = 70;

    this.pipeline = new DefaultRenderingPipeline("fp-pipeline", true, this.scene, [this.camera]);
    this.pipeline.fxaaEnabled = true;
    this.pipeline.samples = 4;
    this.pipeline.bloomEnabled = true;
    // A white room hits any low threshold on every wall at once. Bloom is for the
    // emissive signals — the ring, the strips, the exit — and nothing else.
    this.pipeline.bloomThreshold = 0.82;
    this.pipeline.bloomWeight = 0.46;
    this.pipeline.bloomKernel = 52;
    this.pipeline.bloomScale = 0.6;
    const grade = this.pipeline.imageProcessing;
    grade.toneMappingEnabled = true;
    grade.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
    grade.contrast = 1.1;
    grade.exposure = 1.02;
    grade.vignetteEnabled = true;
    grade.vignetteWeight = 0.9;
    grade.vignetteStretch = 0.3;
    grade.vignetteColor = new Color4(0.03, 0.04, 0.06, 1);
    grade.vignetteBlendMode = ImageProcessingConfiguration.VIGNETTEMODE_MULTIPLY;

    this.glow = new GlowLayer("fp-glow", this.scene, { blurKernelSize: 32 });
    this.glow.intensity = 0.62;

    const built = this.buildWorld();
    this.doorSlab = built.doorSlab;
    this.plateRing = built.plateRing;
    this.plateGlow = built.plateGlow;
    this.plateRingMaterial = built.plateRingMaterial;
    this.echo = built.echo;
    this.echoMaterials = built.echoMaterials;

    this.captureSnapshots();
    this.previous = new Map(this.current);

    this.installInput();
    this.resizeObserver = new ResizeObserver(() => this.engine.resize());
    this.resizeObserver.observe(this.canvas);
  }

  get ready(): boolean {
    return this.engine.isDisposed === false;
  }

  get rendererContext(): "webgl1" | "webgl2" {
    return this.engine.webGLVersion === 2 ? "webgl2" : "webgl1";
  }

  get state(): Readonly<SimState> {
    return this.simulation.state;
  }

  get checksum(): string {
    return this.simulation.checksum();
  }

  get mouseSensitivity(): number {
    return this.sensitivity;
  }

  set mouseSensitivity(value: number) {
    this.sensitivity = Math.max(0.0004, Math.min(0.01, value));
  }

  attach(events: SceneEvents): void {
    this.events = events;
  }

  // ---------------------------------------------------------------- world

  private surface(
    name: string,
    width: number,
    height: number,
    position: Vector3,
    rotation: Vector3,
    material: StandardMaterial,
    parent: TransformNode,
    receive = true,
  ): Mesh {
    const plane = MeshBuilder.CreatePlane(
      name,
      { width, height, sideOrientation: 2, frontUVs: new Vector4(0, 0, 1, 1), backUVs: new Vector4(0, 0, 1, 1) },
      this.scene,
    );
    // Tiling is baked into the mesh UVs rather than the material, so one shared
    // panel texture keeps the same texel density on a 12 m wall and a 0.6 m jamb.
    const uvs = plane.getVerticesData(VertexBuffer.UVKind);
    if (uvs) {
      const scaleU = width / PANEL_MODULE;
      const scaleV = height / PANEL_MODULE;
      for (let index = 0; index < uvs.length; index += 2) {
        uvs[index] = (uvs[index] ?? 0) * scaleU;
        uvs[index + 1] = (uvs[index + 1] ?? 0) * scaleV;
      }
      plane.setVerticesData(VertexBuffer.UVKind, uvs);
    }
    plane.position = position;
    plane.rotation = rotation;
    plane.material = material;
    plane.receiveShadows = receive;
    plane.isPickable = false;
    plane.parent = parent;
    return plane;
  }

  private buildWorld(): {
    doorSlab: Mesh;
    plateRing: Mesh;
    plateGlow: PointLight;
    plateRingMaterial: StandardMaterial;
    echo: Humanoid;
    echoMaterials: StandardMaterial[];
  } {
    const root = new TransformNode("world", this.scene);
    const shell = ROOM_SHELL;
    const width = shell.halfWidth * 2;

    const wallMaterial = panelMaterial(this.scene, "panel-wall", {
      columns: 2, rows: 2, base: "#e9e7e1", seam: "#b6b4ae", bevel: 6, seed: 1861,
    });
    // The floor sits a clear step below the walls in value, and the ceiling
    // below that: three separated bands is what stops a white room reading flat.
    const floorMaterial = panelMaterial(this.scene, "panel-floor", {
      columns: 2, rows: 2, base: "#d6d4ce", seam: "#8f8d88", bevel: 8, seed: 3391,
      tint: new Color3(0.6, 0.6, 0.62),
    });
    const ceilingMaterial = panelMaterial(this.scene, "panel-ceiling", {
      columns: 2, rows: 2, base: "#dedcd6", seam: "#9e9c97", bevel: 5, seed: 6577,
      tint: new Color3(0.7, 0.71, 0.75),
    });
    const trimMaterial = matteMaterial(this.scene, "trim", new Color3(0.19, 0.2, 0.23));
    const darkZone = matteMaterial(this.scene, "dark-zone", new Color3(0.13, 0.14, 0.16));

    const flat = (x: number, y: number, z: number): Vector3 => new Vector3(x, y, z);
    const HALF_PI = Math.PI / 2;

    // Lights first: everything built after this can register itself as a caster.
    this.buildLighting(root, trimMaterial);

    // Main chamber shell.
    this.surface("floor", width, shell.depth, flat(0, 0, shell.depth / 2), new Vector3(HALF_PI, 0, 0), floorMaterial, root);
    this.surface("ceiling", width, shell.depth, flat(0, shell.height, shell.depth / 2), new Vector3(-HALF_PI, 0, 0), ceilingMaterial, root, false);
    this.surface("wall-west", shell.depth, shell.height, flat(-shell.halfWidth, shell.height / 2, shell.depth / 2), new Vector3(0, HALF_PI, 0), wallMaterial, root);
    this.surface("wall-east", shell.depth, shell.height, flat(shell.halfWidth, shell.height / 2, shell.depth / 2), new Vector3(0, -HALF_PI, 0), wallMaterial, root);
    this.surface("wall-back", width, shell.height, flat(0, shell.height / 2, 0), new Vector3(0, 0, 0), wallMaterial, root);

    // Far wall, split around the doorway.
    const sideWidth = shell.halfWidth - shell.doorwayHalfWidth;
    for (const side of [-1, 1] as const) {
      this.surface(
        `wall-far-${side < 0 ? "left" : "right"}`,
        sideWidth,
        shell.height,
        flat(side * (shell.doorwayHalfWidth + sideWidth / 2), shell.height / 2, shell.depth),
        new Vector3(0, Math.PI, 0),
        wallMaterial,
        root,
      );
    }
    this.surface(
      "wall-far-lintel",
      shell.doorwayHalfWidth * 2,
      shell.height - shell.doorwayHeight,
      flat(0, (shell.height + shell.doorwayHeight) / 2, shell.depth),
      new Vector3(0, Math.PI, 0),
      wallMaterial,
      root,
    );

    // Door reveal: the wall has thickness, and seeing it is what sells the slab
    // as a moving part rather than a decal.
    for (const side of [-1, 1] as const) {
      this.surface(
        `jamb-${side < 0 ? "left" : "right"}`,
        shell.wallThickness,
        shell.doorwayHeight,
        flat(side * shell.doorwayHalfWidth, shell.doorwayHeight / 2, shell.depth + shell.wallThickness / 2),
        new Vector3(0, side < 0 ? HALF_PI : -HALF_PI, 0),
        trimMaterial,
        root,
      );
    }
    this.surface(
      "jamb-head",
      shell.doorwayHalfWidth * 2,
      shell.wallThickness,
      flat(0, shell.doorwayHeight, shell.depth + shell.wallThickness / 2),
      new Vector3(-HALF_PI, 0, 0),
      trimMaterial,
      root,
      false,
    );

    // Corridor.
    const corridorDepth = shell.corridorEnd - shell.depth;
    const corridorMid = shell.depth + corridorDepth / 2;
    const corridorWidth = shell.corridorHalfWidth * 2;
    this.surface("corridor-floor", corridorWidth, corridorDepth, flat(0, 0, corridorMid), new Vector3(HALF_PI, 0, 0), floorMaterial, root);
    this.surface("corridor-ceiling", corridorWidth, corridorDepth, flat(0, shell.corridorHeight, corridorMid), new Vector3(-HALF_PI, 0, 0), ceilingMaterial, root, false);
    this.surface("corridor-west", corridorDepth, shell.corridorHeight, flat(-shell.corridorHalfWidth, shell.corridorHeight / 2, corridorMid), new Vector3(0, HALF_PI, 0), wallMaterial, root);
    this.surface("corridor-east", corridorDepth, shell.corridorHeight, flat(shell.corridorHalfWidth, shell.corridorHeight / 2, corridorMid), new Vector3(0, -HALF_PI, 0), wallMaterial, root);
    this.surface("corridor-end", corridorWidth, shell.corridorHeight, flat(0, shell.corridorHeight / 2, shell.corridorEnd), new Vector3(0, Math.PI, 0), wallMaterial, root);

    // Structural ribs: vertical trim between panel bays, so a 12 m wall has rhythm.
    for (const z of [3, 6, 9]) {
      for (const side of [-1, 1] as const) {
        const rib = MeshBuilder.CreateBox(`rib-${side}-${z}`, { width: 0.1, height: shell.height, depth: 0.16 }, this.scene);
        rib.position = new Vector3(side * (shell.halfWidth - 0.05), shell.height / 2, z);
        rib.material = trimMaterial;
        rib.isPickable = false;
        rib.parent = root;
        this.cast(rib);
      }
    }

    this.buildDarkZones(root, darkZone);
    this.buildRouteLines(root);
    this.buildSign(root);
    this.buildObservationWindow(root, trimMaterial);

    const plate = this.buildPlate(root, darkZone);
    const doorSlab = this.buildDoor(root, trimMaterial);
    this.buildExit(root, trimMaterial);

    const echoSkin = echoMaterial(this.scene, "echo-core");
    const echo = createHumanoid(this.scene, "echo", echoSkin);
    echo.root.parent = root;
    echo.root.setEnabled(false);
    for (const part of echo.parts) {
      part.receiveShadows = false;
      // A translucent ghost casting a hard shadow reads as a solid body. It does not.
      part.applyFog = false;
    }
    this.glow.addIncludedOnlyMesh(echo.parts[0] as Mesh);

    return {
      doorSlab,
      plateRing: plate.ring,
      plateGlow: plate.light,
      plateRingMaterial: plate.ringMaterial,
      echo,
      echoMaterials: [echoSkin],
    };
  }

  /** Register a mesh with the key light. Contact shadow is what seats an object on a floor. */
  private cast(mesh: Mesh): void {
    this.shadows?.addShadowCaster(mesh, false);
  }

  private buildLighting(root: TransformNode, trim: StandardMaterial): void {
    const shell = ROOM_SHELL;
    const sky = new HemisphericLight("sky", new Vector3(0, 1, 0), this.scene);
    sky.diffuse = new Color3(0.9, 0.93, 1);
    sky.groundColor = new Color3(0.42, 0.44, 0.5);
    sky.intensity = 0.36;

    const key = new DirectionalLight("key", new Vector3(-0.34, -1, 0.22), this.scene);
    key.position = new Vector3(4, shell.height + 4, 3);
    key.diffuse = new Color3(1, 0.99, 0.96);
    key.specular = new Color3(0.24, 0.24, 0.26);
    key.intensity = 1.15;
    this.shadows = new ShadowGenerator(2048, key);
    this.shadows.useBlurExponentialShadowMap = true;
    this.shadows.blurKernel = 22;
    this.shadows.bias = 0.0018;
    this.shadows.darkness = 0.5;

    const stripMaterial = signalMaterial(this.scene, "light-strip", new Color3(1, 0.98, 0.93));
    for (const side of [-1, 1] as const) {
      const x = side * 2.7;
      const housing = MeshBuilder.CreateBox(`strip-housing-${side}`, { width: 0.46, height: 0.14, depth: 9.4 }, this.scene);
      housing.position = new Vector3(x, shell.height - 0.07, shell.depth / 2);
      housing.material = trim;
      housing.isPickable = false;
      housing.parent = root;
      this.cast(housing);

      const strip = MeshBuilder.CreateBox(`strip-${side}`, { width: 0.32, height: 0.04, depth: 9.1 }, this.scene);
      strip.position = new Vector3(x, shell.height - 0.15, shell.depth / 2);
      strip.material = stripMaterial;
      strip.isPickable = false;
      strip.parent = root;
      this.glow.addIncludedOnlyMesh(strip);

      for (const z of [2.6, 6, 9.4]) {
        const lamp = new PointLight(`lamp-${side}-${z}`, new Vector3(x, shell.height - 0.35, z), this.scene);
        lamp.diffuse = new Color3(1, 0.98, 0.94);
        lamp.specular = new Color3(0.3, 0.3, 0.3);
        lamp.intensity = 0.68;
        lamp.range = 10;
      }
    }

    // The corridor is dimmer on purpose: the amber exit has to be the brightest
    // thing in it, or "walk toward the light" is just a sentence in the HUD.
    const corridorStrip = MeshBuilder.CreateBox("corridor-strip", { width: 0.26, height: 0.04, depth: 3.4 }, this.scene);
    corridorStrip.position = new Vector3(0, shell.corridorHeight - 0.09, shell.depth + 1.9);
    corridorStrip.material = stripMaterial;
    corridorStrip.isPickable = false;
    corridorStrip.parent = root;
    this.glow.addIncludedOnlyMesh(corridorStrip);
    const corridorLamp = new PointLight("corridor-lamp", new Vector3(0, shell.corridorHeight - 0.4, shell.depth + 1.9), this.scene);
    corridorLamp.diffuse = new Color3(0.95, 0.96, 1);
    corridorLamp.intensity = 0.34;
    corridorLamp.range = 7;
  }

  /** The floor drops to the mechanism palette wherever the room does something. */
  private buildDarkZones(root: TransformNode, dark: StandardMaterial): void {
    const shell = ROOM_SHELL;
    const pad = MeshBuilder.CreateBox("plate-zone", { width: 4.6, height: 0.02, depth: 4.6 }, this.scene);
    pad.position = new Vector3(0, 0.011, shell.plateCentreZ);
    pad.material = dark;
    pad.receiveShadows = true;
    pad.isPickable = false;
    pad.parent = root;

    const threshold = MeshBuilder.CreateBox("door-zone", { width: shell.doorwayHalfWidth * 2 + 1.6, height: 0.02, depth: 2.2 }, this.scene);
    threshold.position = new Vector3(0, 0.011, shell.depth - 0.7);
    threshold.material = dark;
    threshold.receiveShadows = true;
    threshold.isPickable = false;
    threshold.parent = root;

    // Dark frame around the doorway: the one place the white wall gives way.
    for (const side of [-1, 1] as const) {
      const post = MeshBuilder.CreateBox(`door-frame-${side}`, { width: 0.22, height: shell.doorwayHeight + 0.24, depth: 0.14 }, this.scene);
      post.position = new Vector3(side * (shell.doorwayHalfWidth + 0.11), (shell.doorwayHeight + 0.24) / 2, shell.depth - 0.07);
      post.material = dark;
      post.isPickable = false;
      post.parent = root;
      this.cast(post);
    }
    const head = MeshBuilder.CreateBox("door-frame-head", { width: shell.doorwayHalfWidth * 2 + 0.44, height: 0.24, depth: 0.14 }, this.scene);
    head.position = new Vector3(0, shell.doorwayHeight + 0.12, shell.depth - 0.07);
    head.material = dark;
    head.isPickable = false;
    head.parent = root;
    this.cast(head);
  }

  /** Cyan dashed for what the recording should walk, amber solid for what the present should. */
  private buildRouteLines(root: TransformNode): void {
    const shell = ROOM_SHELL;
    const past = signalMaterial(this.scene, "route-past", CYAN.scale(0.42), 0.85);
    const present = signalMaterial(this.scene, "route-present", AMBER.scale(0.38), 0.85);

    const dashesFrom = shell.spawnZ + 0.9;
    const dashesTo = shell.plateCentreZ - shell.plateRadius - 0.2;
    const dashCount = Math.max(1, Math.round((dashesTo - dashesFrom) / 0.62));
    for (let index = 0; index < dashCount; index += 1) {
      const dash = MeshBuilder.CreateBox(`route-past-${index}`, { width: 0.11, height: 0.012, depth: 0.34 }, this.scene);
      dash.position = new Vector3(0, 0.026, dashesFrom + (index + 0.5) * ((dashesTo - dashesFrom) / dashCount));
      dash.material = past;
      dash.isPickable = false;
      dash.parent = root;
      this.glow.addIncludedOnlyMesh(dash);
    }

    const line = MeshBuilder.CreateBox("route-present", { width: 0.09, height: 0.012, depth: shell.depth - shell.plateCentreZ - 0.7 }, this.scene);
    line.position = new Vector3(0, 0.026, (shell.plateCentreZ + shell.plateRadius + shell.depth) / 2 - 0.1);
    line.material = present;
    line.isPickable = false;
    line.parent = root;
    this.glow.addIncludedOnlyMesh(line);
  }

  /** Entrance sign: the big number is what makes a corridor read as a facility. */
  private buildSign(root: TransformNode): void {
    const shell = ROOM_SHELL;
    const width = 1024;
    const height = 512;
    const texture = new DynamicTexture("chamber-sign", { width, height }, this.scene, true);
    const context = scratchContext(width, height);
    context.fillStyle = "#1b1e23";
    context.fillRect(0, 0, width, height);
    context.fillStyle = "#e8e6e0";
    context.fillRect(0, 0, width, 10);
    context.font = "700 300px Helvetica, Arial, sans-serif";
    context.fillStyle = "#f2f0ea";
    context.textBaseline = "top";
    context.fillText("00", 54, 78);
    context.font = "500 74px Helvetica, Arial, sans-serif";
    context.fillStyle = "#8fd8ec";
    context.fillText(AWAKENING.name, 400, 128);
    context.font = "400 46px Helvetica, Arial, sans-serif";
    context.fillStyle = "#9aa3ad";
    context.fillText(AWAKENING.subtitle.toUpperCase(), 402, 226);
    // Progress bar: one of ten chambers, so the room knows where it sits.
    context.fillStyle = "#33383f";
    context.fillRect(402, 320, 560, 14);
    context.fillStyle = "#8fd8ec";
    context.fillRect(402, 320, 56, 14);
    context.font = "400 34px Helvetica, Arial, sans-serif";
    context.fillStyle = "#6f7883";
    context.fillText("기억 보관소 · MEMORY ARCHIVE", 402, 372);
    // DynamicTexture samples with invertY on, so a straight blit lands the sign
    // upside down — the footer line came out above the chamber number. Flipping
    // here cancels it and keeps the drawing code reading top to bottom.
    const target = texture.getContext();
    target.save();
    target.translate(0, height);
    target.scale(1, -1);
    target.drawImage(context.canvas, 0, 0);
    target.restore();
    texture.update(false);

    const panel = signalMaterial(this.scene, "sign", new Color3(1, 1, 1));
    panel.emissiveTexture = texture;
    panel.emissiveColor = new Color3(0.62, 0.63, 0.66);

    const signX = -shell.doorwayHalfWidth - 1.95;
    // Frame behind, face in front. Same trap as the exit: a plane at the frame's
    // own depth is a plane inside the frame.
    const frame = MeshBuilder.CreateBox("sign-frame", { width: 2.78, height: 1.48, depth: 0.1 }, this.scene);
    frame.position = new Vector3(signX, 2.1, shell.depth - 0.05);
    frame.material = matteMaterial(this.scene, "sign-frame-material", new Color3(0.14, 0.15, 0.18));
    frame.isPickable = false;
    frame.parent = root;
    this.cast(frame);

    // Single-sided and unrotated: this is the orientation whose *front* faces the
    // room. A double-sided version stayed visible but showed its back face, which
    // is the same texture read right-to-left — the sign came out mirrored.
    const sign = MeshBuilder.CreatePlane("chamber-sign-plane", { width: 2.6, height: 1.3 }, this.scene);
    sign.position = new Vector3(signX, 2.1, shell.depth - 0.115);
    sign.material = panel;
    sign.isPickable = false;
    sign.parent = root;
  }

  /**
   * The observation room: one dark window per chamber, always empty. It gives a
   * twelve-metre wall something to be about, and it is the only thing in the
   * room that suggests the place is staffed.
   */
  private buildObservationWindow(root: TransformNode, trim: StandardMaterial): void {
    const shell = ROOM_SHELL;
    const x = shell.halfWidth;
    const centreZ = 4.6;
    const width = 3.6;
    const height = 1.7;
    const centreY = 2.15;

    const recess = MeshBuilder.CreatePlane(
      "observation-recess",
      { width, height, sideOrientation: Mesh.DOUBLESIDE },
      this.scene,
    );
    recess.position = new Vector3(x - 0.02, centreY, centreZ);
    recess.rotation = new Vector3(0, -Math.PI / 2, 0);
    recess.material = matteMaterial(this.scene, "observation-interior", new Color3(0.05, 0.055, 0.07));
    recess.isPickable = false;
    recess.parent = root;

    const glass = MeshBuilder.CreatePlane(
      "observation-glass",
      { width: width - 0.06, height: height - 0.06, sideOrientation: Mesh.DOUBLESIDE },
      this.scene,
    );
    glass.position = new Vector3(x - 0.09, centreY, centreZ);
    glass.rotation = new Vector3(0, -Math.PI / 2, 0);
    const glassMaterial = matteMaterial(this.scene, "observation-glass-material", new Color3(0.1, 0.13, 0.16));
    glassMaterial.alpha = 0.34;
    glassMaterial.specularColor = new Color3(0.7, 0.75, 0.8);
    glassMaterial.specularPower = 220;
    // The shared helper turns a depth pre-pass on for translucency; on a single
    // flat pane it only costs a pass and can bite on the glow layer.
    glassMaterial.needDepthPrePass = false;
    glass.material = glassMaterial;
    glass.isPickable = false;
    glass.parent = root;

    for (const side of [-1, 1] as const) {
      const rail = MeshBuilder.CreateBox(`observation-rail-${side}`, { width: 0.14, height: 0.16, depth: width + 0.3 }, this.scene);
      rail.position = new Vector3(x - 0.06, centreY + side * (height / 2 + 0.07), centreZ);
      rail.material = trim;
      rail.isPickable = false;
      rail.parent = root;
      this.cast(rail);
    }
    for (const side of [-1, 1] as const) {
      const post = MeshBuilder.CreateBox(`observation-post-${side}`, { width: 0.14, height: height + 0.3, depth: 0.16 }, this.scene);
      post.position = new Vector3(x - 0.06, centreY, centreZ + side * (width / 2 + 0.07));
      post.material = trim;
      post.isPickable = false;
      post.parent = root;
      this.cast(post);
    }
  }

  private buildPlate(root: TransformNode, dark: StandardMaterial): { ring: Mesh; light: PointLight; ringMaterial: StandardMaterial } {
    const shell = ROOM_SHELL;
    const centre = new Vector3(0, 0, shell.plateCentreZ);

    const base = MeshBuilder.CreateCylinder("plate-base", { diameter: shell.plateRadius * 2 + 0.3, height: 0.07, tessellation: 48 }, this.scene);
    base.position = centre.add(new Vector3(0, 0.035, 0));
    base.material = dark;
    base.receiveShadows = true;
    base.isPickable = false;
    base.parent = root;
    this.cast(base);

    const face = MeshBuilder.CreateCylinder("plate-face", { diameter: shell.plateRadius * 2 - 0.16, height: 0.05, tessellation: 48 }, this.scene);
    face.position = centre.add(new Vector3(0, 0.062, 0));
    face.material = matteMaterial(this.scene, "plate-face-material", new Color3(0.27, 0.29, 0.33));
    face.receiveShadows = true;
    face.isPickable = false;
    face.parent = root;

    const ringMaterial = signalMaterial(this.scene, "plate-ring", CYAN);
    const ring = MeshBuilder.CreateTorus("plate-ring-mesh", { diameter: shell.plateRadius * 2 - 0.06, thickness: 0.055, tessellation: 52 }, this.scene);
    ring.position = centre.add(new Vector3(0, 0.075, 0));
    ring.material = ringMaterial;
    ring.isPickable = false;
    ring.parent = root;
    this.glow.addIncludedOnlyMesh(ring);

    const light = new PointLight("plate-light", centre.add(new Vector3(0, 0.6, 0)), this.scene);
    light.diffuse = CYAN;
    light.intensity = 0.55;
    light.range = 5.5;

    return { ring, light, ringMaterial };
  }

  private buildDoor(root: TransformNode, trim: StandardMaterial): Mesh {
    const shell = ROOM_SHELL;
    const slab = MeshBuilder.CreateBox("door-slab", {
      width: shell.doorwayHalfWidth * 2 - 0.04,
      height: shell.doorwayHeight - 0.03,
      depth: 0.34,
    }, this.scene);
    slab.position = new Vector3(0, (shell.doorwayHeight - 0.03) / 2, shell.depth + shell.wallThickness / 2);
    slab.material = matteMaterial(this.scene, "door-slab-material", new Color3(0.72, 0.72, 0.74));
    slab.receiveShadows = true;
    slab.isPickable = false;
    slab.parent = root;
    this.cast(slab);

    const stripe = MeshBuilder.CreateBox("door-stripe", {
      width: shell.doorwayHalfWidth * 2 - 0.04,
      height: 0.1,
      depth: 0.36,
    }, this.scene);
    stripe.position = new Vector3(0, -(shell.doorwayHeight - 0.03) / 2 + 0.16, 0);
    stripe.material = trim;
    stripe.isPickable = false;
    stripe.parent = slab;
    return slab;
  }

  private buildExit(root: TransformNode, trim: StandardMaterial): void {
    const shell = ROOM_SHELL;
    const wall = shell.corridorEnd;

    // A doorway of light, not a lit wall. Filling the corridor's whole end with
    // emissive read as a blown-out white screen from two metres away; the exit
    // has to be a shape you walk through, with dark around it to be bright against.
    const openingWidth = 1.62;
    const openingHeight = 2.28;
    const openingCentreY = openingHeight / 2 + 0.04;

    for (const side of [-1, 1] as const) {
      const post = MeshBuilder.CreateBox(`exit-post-${side}`, { width: 0.2, height: openingHeight + 0.34, depth: 0.16 }, this.scene);
      post.position = new Vector3(side * (openingWidth / 2 + 0.1), (openingHeight + 0.34) / 2, wall - 0.09);
      post.material = trim;
      post.isPickable = false;
      post.parent = root;
      this.cast(post);
    }
    const head = MeshBuilder.CreateBox("exit-head", { width: openingWidth + 0.4, height: 0.2, depth: 0.16 }, this.scene);
    head.position = new Vector3(0, openingHeight + 0.14, wall - 0.09);
    head.material = trim;
    head.isPickable = false;
    head.parent = root;
    this.cast(head);

    const glowPanel = signalMaterial(this.scene, "exit-glow", new Color3(0.98, 0.76, 0.46));
    const panel = MeshBuilder.CreatePlane("exit-panel", {
      width: openingWidth,
      height: openingHeight,
      sideOrientation: Mesh.DOUBLESIDE,
    }, this.scene);
    panel.position = new Vector3(0, openingCentreY, wall - 0.12);
    panel.material = glowPanel;
    panel.isPickable = false;
    panel.parent = root;

    // A lit lip on the floor in front of the panel: the light lands somewhere.
    const spillFloor = MeshBuilder.CreateBox("exit-floor", {
      width: openingWidth,
      height: 0.012,
      depth: 1.2,
    }, this.scene);
    spillFloor.position = new Vector3(0, 0.03, wall - 0.78);
    spillFloor.material = signalMaterial(this.scene, "exit-floor-glow", AMBER.scale(0.34), 0.9);
    spillFloor.isPickable = false;
    spillFloor.parent = root;

    const lamp = new PointLight("exit-lamp", new Vector3(0, 1.5, wall - 1.5), this.scene);
    lamp.diffuse = AMBER;
    lamp.intensity = 2.2;
    lamp.range = 10;

    const spill = new PointLight("exit-spill", new Vector3(0, 1.4, shell.depth + 1.6), this.scene);
    spill.diffuse = AMBER;
    spill.intensity = 0.55;
    spill.range = 8;
  }

  // ---------------------------------------------------------------- input

  private installInput(): void {
    this.canvas.addEventListener("keydown", (event) => this.onKey(event, true));
    this.canvas.addEventListener("keyup", (event) => this.onKey(event, false));
    // Held keys must not survive losing focus, or the echo records a walk the
    // player never took.
    this.canvas.addEventListener("blur", () => this.pressed.clear());
    document.addEventListener("pointerlockchange", () => {
      this.pointerLocked = document.pointerLockElement === this.canvas;
      // Escape releases the pointer; the game has to stop with it, or the tape
      // keeps recording an empty room while the player reads their email.
      if (!this.pointerLocked && this.started) this.pause();
    });
    document.addEventListener("mousemove", (event) => {
      if (!this.pointerLocked) return;
      this.look(event.movementX, event.movementY);
    });
  }

  private onKey(event: KeyboardEvent, down: boolean): void {
    const code = event.code;
    if (["Space", "Enter", "KeyR", "KeyW", "KeyA", "KeyS", "KeyD", "KeyE", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(code)) {
      event.preventDefault();
    }
    if (down) {
      if (this.pressed.has(code)) return;
      this.pressed.add(code);
      if (code === "Enter") this.fold();
      if (code === "KeyR") this.rerecord();
    } else {
      this.pressed.delete(code);
    }
  }

  /** Absolute aim, in radians. Used by rerecord and by capture choreography. */
  setLook(yaw: number, pitch: number): void {
    this.yaw = yaw;
    this.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitch));
  }

  look(deltaX: number, deltaY: number): void {
    this.yaw += deltaX * this.sensitivity;
    this.pitch += deltaY * this.sensitivity;
    if (this.pitch > PITCH_LIMIT) this.pitch = PITCH_LIMIT;
    if (this.pitch < -PITCH_LIMIT) this.pitch = -PITCH_LIMIT;
  }

  press(code: string): void {
    this.pressed.add(code);
    if (code === "Enter") this.fold();
    if (code === "KeyR") this.rerecord();
  }

  release(code: string): void {
    this.pressed.delete(code);
  }

  requestPointerLock(): void {
    this.canvas.focus();
    void this.canvas.requestPointerLock();
  }

  fold(): boolean {
    const folded = this.simulation.fold();
    if (folded) {
      this.captureSnapshots();
      this.previous = new Map(this.current);
      this.events?.onFold();
      this.events?.onPhaseChange("replay", "recording");
    }
    return folded;
  }

  rerecord(): void {
    if (this.simulation.state.phase === "recording") return;
    const previousPhase = this.simulation.state.phase;
    this.simulation.rerecord();
    this.yaw = radiansFromYawUnits(AWAKENING.spawn.yawUnits);
    this.pitch = 0;
    this.doorOffset = 0;
    this.captureSnapshots();
    this.previous = new Map(this.current);
    this.events?.onPhaseChange("recording", previousPhase);
  }

  private has(...codes: string[]): boolean {
    return codes.some((code) => this.pressed.has(code));
  }

  // ---------------------------------------------------------------- loop

  /** Begin rendering. The simulation stays parked until `resume`. */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastFrameTime = performance.now();
    this.engine.runRenderLoop(() => this.frame());
  }

  get isPaused(): boolean {
    return this.paused;
  }

  get hasStarted(): boolean {
    return this.started;
  }

  resume(): void {
    this.paused = false;
    if (!this.started) {
      this.started = true;
      this.yaw = radiansFromYawUnits(AWAKENING.spawn.yawUnits);
      this.pitch = 0;
    }
    this.lastFrameTime = performance.now();
    this.accumulator = 0;
  }

  pause(): void {
    this.paused = true;
    this.pressed.clear();
  }

  private frame(): void {
    const now = performance.now();
    let elapsed = now - this.lastFrameTime;
    this.lastFrameTime = now;
    // A backgrounded tab must not spend its return catching up on ten seconds
    // of simulation the player never saw.
    if (elapsed > 120) elapsed = 120;
    this.fps = this.fps * 0.92 + (1000 / Math.max(1, elapsed)) * 0.08;
    this.clock += elapsed / 1000;

    if (this.paused) {
      // The world renders behind the title card, but the tape does not start
      // burning until the player does.
      this.accumulator = 0;
      if (!this.started) {
        this.yaw = radiansFromYawUnits(AWAKENING.spawn.yawUnits) + Math.sin(this.clock * 0.16) * 0.09;
        this.pitch = Math.sin(this.clock * 0.11) * 0.02;
      }
    } else {
      this.accumulator += elapsed;
      let steps = 0;
      while (this.accumulator >= simConstants.tickMs && steps < 5) {
        this.tick();
        this.accumulator -= simConstants.tickMs;
        steps += 1;
      }
    }

    const alpha = Math.min(1, this.accumulator / simConstants.tickMs);
    this.render(alpha, elapsed / 1000);
    this.scene.render();
    this.events?.onFrame(this.viewModel());
  }

  private tick(): void {
    const phaseBefore = this.simulation.state.phase;
    const frame = encodeFrame({
      forward: this.has("KeyW", "ArrowUp"),
      back: this.has("KeyS", "ArrowDown"),
      left: this.has("KeyA", "ArrowLeft"),
      right: this.has("KeyD", "ArrowRight"),
      jump: this.has("Space"),
      act: this.has("KeyE"),
      yawUnits: yawUnitsFromRadians(this.yaw),
    });
    const result = this.simulation.step(frame);
    this.captureSnapshots();
    if (result.phaseChanged) this.events?.onPhaseChange(result.state.phase, phaseBefore);
  }

  private captureSnapshots(): void {
    this.previous = this.current;
    const next = new Map<ActorId, Snapshot>();
    for (const actor of this.simulation.state.actors) {
      next.set(actor.id, snapshotOf(actor));
      const travelled = this.previous.get(actor.id);
      if (travelled) {
        const dx = actor.x - travelled.x;
        const dz = actor.z - travelled.z;
        const step = Math.sqrt(dx * dx + dz * dz);
        // Stride advances with distance, not time, so the feet never skate.
        this.stride.set(actor.id, (this.stride.get(actor.id) ?? 0) + step * 2.6);
      }
    }
    this.current = next;
  }

  private render(alpha: number, deltaSeconds: number): void {
    const state = this.simulation.state;
    const present = this.interpolated("present", alpha);
    if (present) {
      const gait = Math.min(1, present.speed / simConstants.walkSpeed);
      this.bobPhase += present.speed * deltaSeconds * 3.4;
      const bob = Math.sin(this.bobPhase * 2) * 0.022 * gait;
      const sway = Math.sin(this.bobPhase) * 0.0075 * gait;
      this.camera.position.set(present.x, present.y + simConstants.eyeHeight + bob, present.z);
      this.camera.rotation.set(this.pitch, this.yaw, sway);
    }

    const echoSnapshot = this.interpolated("past", alpha);
    const echoActive = state.phase !== "recording" && echoSnapshot !== null;
    this.echo.root.setEnabled(echoActive);
    if (echoActive && echoSnapshot) {
      this.echo.root.position.set(echoSnapshot.x, echoSnapshot.y, echoSnapshot.z);
      this.echo.root.rotation.y = echoSnapshot.yaw;
      poseHumanoid(this.echo, {
        speed: echoSnapshot.speed,
        phase: this.stride.get("past") ?? 0,
        grounded: echoSnapshot.grounded,
        clock: this.clock,
      });
      // The echo arrives rather than appearing: a short fade-in on the first
      // second of the second pass.
      const arrival = Math.min(1, state.tapeTick / 18);
      for (const material of this.echoMaterials) material.alpha = 0.34 * (0.35 + arrival * 0.65);
    }

    const door = state.doors[0];
    const target = door?.open ? ROOM_SHELL.doorwayHeight + 0.06 : 0;
    // Ease rather than snap: a slab that teleports open reads as a bug.
    this.doorOffset += (target - this.doorOffset) * Math.min(1, deltaSeconds * 6.5);
    this.doorSlab.position.y = (ROOM_SHELL.doorwayHeight - 0.03) / 2 + this.doorOffset;

    const plateActive = state.plates[0]?.active ?? false;
    const pulse = plateActive ? 1.35 + Math.sin(this.clock * 5.2) * 0.18 : 0.62 + Math.sin(this.clock * 1.5) * 0.06;
    this.plateRingMaterial.emissiveColor = CYAN.scale(pulse);
    this.plateGlow.intensity = plateActive ? 1.5 : 0.55;
    this.plateRing.scaling.y = plateActive ? 0.7 : 1;
  }

  private interpolated(id: ActorId, alpha: number): Snapshot | null {
    const to = this.current.get(id);
    if (!to) return null;
    const from = this.previous.get(id) ?? to;
    return {
      x: lerp(from.x, to.x, alpha),
      y: lerp(from.y, to.y, alpha),
      z: lerp(from.z, to.z, alpha),
      yaw: lerpAngle(from.yaw, to.yaw, alpha),
      speed: lerp(from.speed, to.speed, alpha),
      grounded: to.grounded,
    };
  }

  viewModel(): ViewModel {
    const state = this.simulation.state;
    const present = state.actors.find((actor) => actor.id === "present");
    return {
      phase: state.phase,
      tapeTick: state.tapeTick,
      tapeDuration: AWAKENING.tapeDurationTicks,
      replaySpan: AWAKENING.tapeDurationTicks + AWAKENING.replayGraceTicks,
      canFold: this.simulation.canFold,
      focus: present?.focusId ?? null,
      plateActive: state.plates[0]?.active ?? false,
      doorOpen: state.doors[0]?.open ?? false,
      echoPresent: state.actors.some((actor) => actor.id === "past"),
      success: state.success,
      lastError: state.lastError,
      foldedAtTick: state.foldedAtTick,
      fps: this.fps,
      paused: this.paused,
      started: this.started,
    };
  }

  dispose(): void {
    this.running = false;
    this.resizeObserver.disconnect();
    this.engine.stopRenderLoop();
    this.scene.dispose();
    this.engine.dispose();
  }
}
