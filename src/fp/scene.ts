import { Engine } from "@babylonjs/core/Engines/engine";
import { GlowLayer } from "@babylonjs/core/Layers/glowLayer";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { ImageProcessingConfiguration } from "@babylonjs/core/Materials/imageProcessingConfiguration";
import type { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
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
import { echoMaterial, matteMaterial, signalMaterial } from "./materials";
import {
  brassMaterial,
  brickFloorMaterial,
  buildSalchang,
  buildShelfWall,
  buildSignBoard,
  hanjiMaterial,
  PALETTE,
  plasterMaterial,
  timberMaterial,
} from "./janggyeonggak";
import { createHumanoid, poseHumanoid, type Humanoid } from "./rig";

// One texture tile per 2.4 m of surface, so a 12 m wall and a 0.6 m jamb keep
// the same texel density.
const PANEL_MODULE = 2.4;
/** Shelving stops here; salchang and plaster carry the wall above it. */
const SHELF_HEIGHT = 2.72;

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
  /** The browser refused pointer lock, so looking around means dragging. */
  pointerLockDenied: boolean;
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
  private dragging = false;
  private pointerLockDenied = false;
  private lastPointerX = 0;
  private lastPointerY = 0;

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
    occludes = false,
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
    if (occludes) this.cast(plane);
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

    // The archive's material set. Timber and near-black cases carry the walls,
    // lime plaster and fired brick carry the light — the reference is a
    // high-contrast building, not a dark one.
    const timber = timberMaterial(this.scene, "timber", PALETTE.timber, 1861, { scale: 1.4 });
    const timberBeam = timberMaterial(this.scene, "timber-beam", PALETTE.timber.scale(0.86), 6577, { grainAlong: "u", scale: 2.2 });
    const plaster = plasterMaterial(this.scene, "plaster", 3391, 3.2);
    const brick = brickFloorMaterial(this.scene, "brick", 9137, 4.4);
    const brass = brassMaterial(this.scene, "brass");
    const boxCase = matteMaterial(this.scene, "memory-box-case", PALETTE.box);
    boxCase.specularColor = new Color3(0.08, 0.07, 0.06);
    boxCase.specularPower = 44;
    // The few boxes that still hold something playable.
    const boxLit = signalMaterial(this.scene, "memory-box-lit", PALETTE.cyan.scale(0.62));

    const flat = (x: number, y: number, z: number): Vector3 => new Vector3(x, y, z);
    const HALF_PI = Math.PI / 2;

    this.buildLighting(root, timber);

    // Shell: brick underfoot, plaster overhead and at both ends.
    this.surface("floor", width, shell.depth, flat(0, 0, shell.depth / 2), new Vector3(HALF_PI, 0, 0), brick, root);
    this.surface("ceiling", width, shell.depth, flat(0, shell.height, shell.depth / 2), new Vector3(-HALF_PI, 0, 0), plaster, root, false, true);
    this.surface("wall-back", width, shell.height, flat(0, shell.height / 2, 0), new Vector3(0, 0, 0), plaster, root, true, true);

    const sideWidth = shell.halfWidth - shell.doorwayHalfWidth;
    for (const side of [-1, 1] as const) {
      this.surface(
        `wall-far-${side < 0 ? "left" : "right"}`,
        sideWidth,
        shell.height,
        flat(side * (shell.doorwayHalfWidth + sideWidth / 2), shell.height / 2, shell.depth),
        new Vector3(0, Math.PI, 0),
        plaster,
        root,
      );
    }
    this.surface(
      "wall-far-lintel",
      shell.doorwayHalfWidth * 2,
      shell.height - shell.doorwayHeight,
      flat(0, (shell.height + shell.doorwayHeight) / 2, shell.depth),
      new Vector3(0, Math.PI, 0),
      plaster,
      root,
    );
    // Side walls are built as bands around the window openings rather than one
    // plane. The sun only enters where the lattice is, and that is the whole
    // reason the slats read as stripes instead of decoration.
    const sillY = SHELF_HEIGHT + 0.24;
    const windowHeight = shell.height - SHELF_HEIGHT - 0.52;
    const headY = sillY + windowHeight;
    for (const side of [-1, 1] as const) {
      const rotation = new Vector3(0, side < 0 ? HALF_PI : -HALF_PI, 0);
      const x = side * shell.halfWidth;
      this.surface(`wall-${side}-sill`, shell.depth, sillY, flat(x, sillY / 2, shell.depth / 2), rotation, plaster, root, true, true);
      this.surface(`wall-${side}-head`, shell.depth, shell.height - headY, flat(x, (shell.height + headY) / 2, shell.depth / 2), rotation, plaster, root, true, true);
      // Piers between and beyond the three windows.
      for (const [index, bounds] of [[0, 1.3], [3.9, 4.7], [7.3, 8.1], [10.7, shell.depth]].entries()) {
        const [from, to] = bounds as [number, number];
        this.surface(
          `wall-${side}-pier-${index}`,
          to - from,
          windowHeight,
          flat(x, sillY + windowHeight / 2, (from + to) / 2),
          rotation,
          plaster,
          root,
          true,
          true,
        );
      }
    }

    // The image the whole identity rests on: both long walls packed with cases.
    for (const side of [-1, 1] as const) {
      buildShelfWall(this.scene, root, timber, boxCase, boxLit, {
        x: side * shell.halfWidth,
        facing: side < 0 ? 1 : -1,
        fromZ: 0.55,
        toZ: shell.depth - 0.55,
        height: SHELF_HEIGHT,
        seed: side < 0 ? 4211 : 8123,
      });
    }

    // Salchang above the shelving. Its slats are the only shadow casters that
    // matter: the stripe bands on the floor are cast, not painted, so they move
    // correctly as the player walks and fall over whatever is standing in them.
    const salchangGlass = signalMaterial(this.scene, "salchang-glass", new Color3(1, 0.93, 0.78));
    for (const side of [-1, 1] as const) {
      for (const centreZ of [2.6, 6, 9.4]) {
        const slats = buildSalchang(this.scene, root, timber, salchangGlass, {
          x: side * shell.halfWidth,
          facing: side < 0 ? 1 : -1,
          centreZ,
          width: 2.6,
          sillY: SHELF_HEIGHT + 0.24,
          height: shell.height - SHELF_HEIGHT - 0.52,
          seed: 100 + centreZ,
        });
        // West is the sun side; its slats cast the bands.
        if (side < 0) for (const slat of slats) this.cast(slat);
      }
    }

    // Post and beam: the frame the building is actually made of.
    for (const z of [0.5, 3.4, 6.3, 9.2, 11.6]) {
      const beam = MeshBuilder.CreateBox(`beam-${z}`, { width: width + 0.4, height: 0.3, depth: 0.26 }, this.scene);
      beam.position = new Vector3(0, shell.height - 0.2, z);
      beam.material = timberBeam;
      beam.isPickable = false;
      beam.parent = root;
      beam.receiveShadows = true;
      this.cast(beam);
      for (const side of [-1, 1] as const) {
        const bracket = MeshBuilder.CreateBox(`bracket-${side}-${z}`, { width: 0.5, height: 0.22, depth: 0.3 }, this.scene);
        bracket.position = new Vector3(side * (shell.halfWidth - 0.28), shell.height - 0.44, z);
        bracket.material = timberBeam;
        bracket.isPickable = false;
        bracket.parent = root;
      }
    }
    // Purlins running the length, so the ceiling has a grain of its own.
    for (const x of [-3.4, 0, 3.4]) {
      const purlin = MeshBuilder.CreateBox(`purlin-${x}`, { width: 0.2, height: 0.18, depth: shell.depth }, this.scene);
      purlin.position = new Vector3(x, shell.height - 0.42, shell.depth / 2);
      purlin.material = timberBeam;
      purlin.isPickable = false;
      purlin.parent = root;
    }

    // Corridor: same materials, tighter section.
    const corridorDepth = shell.corridorEnd - shell.depth;
    const corridorMid = shell.depth + corridorDepth / 2;
    const corridorWidth = shell.corridorHalfWidth * 2;
    this.surface("corridor-floor", corridorWidth, corridorDepth, flat(0, 0, corridorMid), new Vector3(HALF_PI, 0, 0), brick, root);
    this.surface("corridor-ceiling", corridorWidth, corridorDepth, flat(0, shell.corridorHeight, corridorMid), new Vector3(-HALF_PI, 0, 0), plaster, root, false);
    this.surface("corridor-west", corridorDepth, shell.corridorHeight, flat(-shell.corridorHalfWidth, shell.corridorHeight / 2, corridorMid), new Vector3(0, HALF_PI, 0), plaster, root);
    this.surface("corridor-east", corridorDepth, shell.corridorHeight, flat(shell.corridorHalfWidth, shell.corridorHeight / 2, corridorMid), new Vector3(0, -HALF_PI, 0), plaster, root);
    this.surface("corridor-end", corridorWidth, shell.corridorHeight, flat(0, shell.corridorHeight / 2, shell.corridorEnd), new Vector3(0, Math.PI, 0), plaster, root);
    for (const z of [13.1, 14.6, 16.1, 17.6]) {
      const rib = MeshBuilder.CreateBox(`corridor-beam-${z}`, { width: corridorWidth + 0.3, height: 0.24, depth: 0.2 }, this.scene);
      rib.position = new Vector3(0, shell.corridorHeight - 0.14, z);
      rib.material = timberBeam;
      rib.isPickable = false;
      rib.parent = root;
      for (const side of [-1, 1] as const) {
        const bracket = MeshBuilder.CreateBox(`corridor-bracket-${side}-${z}`, { width: 0.4, height: 0.18, depth: 0.24 }, this.scene);
        bracket.position = new Vector3(side * (shell.corridorHalfWidth - 0.22), shell.corridorHeight - 0.36, z);
        bracket.material = timberBeam;
        bracket.isPickable = false;
        bracket.parent = root;
      }
    }
    const corridorPurlin = MeshBuilder.CreateBox("corridor-purlin", { width: 0.18, height: 0.16, depth: corridorDepth }, this.scene);
    corridorPurlin.position = new Vector3(0, shell.corridorHeight - 0.34, corridorMid);
    corridorPurlin.material = timberBeam;
    corridorPurlin.isPickable = false;
    corridorPurlin.parent = root;

    // The archive does not stop at the door: a shallow run of cases follows you
    // out, so the corridor reads as more of the same building rather than as a
    // exit tube. This is the grammar the later chambers will connect with.
    buildShelfWall(this.scene, root, timber, boxCase, boxLit, {
      x: -shell.corridorHalfWidth,
      facing: 1,
      fromZ: shell.depth + 0.6,
      toZ: shell.corridorEnd - 1.4,
      height: 1.94,
      seed: 5309,
      depth: 0.3,
    });
    // And one lattice opposite it, so the light has a source on this side too.
    buildSalchang(this.scene, root, timber, salchangGlass, {
      x: shell.corridorHalfWidth,
      facing: -1,
      centreZ: 14.4,
      width: 2.2,
      sillY: 1.62,
      height: 0.86,
      seed: 611,
    });
    const corridorSun = new PointLight("corridor-salchang", new Vector3(shell.corridorHalfWidth - 0.7, 2.05, 14.4), this.scene);
    corridorSun.diffuse = new Color3(1, 0.85, 0.62);
    corridorSun.intensity = 0.5;
    corridorSun.range = 6;
    // A gradient toward the exit: each lamp a little warmer and stronger than
    // the one behind it, so leaving reads as walking into daylight.
    for (const [index, z] of [13.6, 15.6, 17.4].entries()) {
      const lamp = new PointLight(`corridor-gradient-${index}`, new Vector3(0, shell.corridorHeight - 0.6, z), this.scene);
      lamp.diffuse = new Color3(1, 0.86 + index * 0.03, 0.66 + index * 0.05);
      lamp.intensity = 0.22 + index * 0.26;
      lamp.range = 7;
    }

    // Doorway reveal, in timber rather than the old painted trim.
    for (const side of [-1, 1] as const) {
      this.surface(
        `jamb-${side < 0 ? "left" : "right"}`,
        shell.wallThickness,
        shell.doorwayHeight,
        flat(side * shell.doorwayHalfWidth, shell.doorwayHeight / 2, shell.depth + shell.wallThickness / 2),
        new Vector3(0, side < 0 ? HALF_PI : -HALF_PI, 0),
        timber,
        root,
      );
      const post = MeshBuilder.CreateBox(`door-post-${side}`, { width: 0.2, height: shell.doorwayHeight + 0.28, depth: 0.2 }, this.scene);
      post.position = new Vector3(side * (shell.doorwayHalfWidth + 0.1), (shell.doorwayHeight + 0.28) / 2, shell.depth - 0.08);
      post.material = timber;
      post.isPickable = false;
      post.parent = root;
      this.cast(post);
    }
    this.surface(
      "jamb-head",
      shell.doorwayHalfWidth * 2,
      shell.wallThickness,
      flat(0, shell.doorwayHeight, shell.depth + shell.wallThickness / 2),
      new Vector3(-HALF_PI, 0, 0),
      timber,
      root,
      false,
    );
    const doorHead = MeshBuilder.CreateBox("door-head", { width: shell.doorwayHalfWidth * 2 + 0.5, height: 0.26, depth: 0.22 }, this.scene);
    doorHead.position = new Vector3(0, shell.doorwayHeight + 0.13, shell.depth - 0.08);
    doorHead.material = timber;
    doorHead.isPickable = false;
    doorHead.parent = root;
    this.cast(doorHead);

    this.buildLightBands(root);
    this.buildRouteLines(root);
    this.buildSign(root, timber);
    this.buildReadingAlcove(root, timber, plaster);

    const plate = this.buildPlate(root, brass, timber);
    const doorSlab = this.buildDoor(root, timber);
    this.buildExit(root, timber);

    const echoSkin = echoMaterial(this.scene, "echo-core");
    const echo = createHumanoid(this.scene, "echo", echoSkin);
    echo.root.parent = root;
    echo.root.setEnabled(false);
    for (const part of echo.parts) {
      part.receiveShadows = false;
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

  private buildLighting(root: TransformNode, timber: StandardMaterial): void {
    const shell = ROOM_SHELL;
    // Sky is the cool bounce off plaster; ground is the warm one off brick.
    const sky = new HemisphericLight("sky", new Vector3(0, 1, 0), this.scene);
    sky.diffuse = new Color3(0.62, 0.66, 0.76);
    sky.groundColor = new Color3(0.34, 0.28, 0.21);
    sky.intensity = 0.52;

    // The sun, outside the west salchang. Everything warm in the room is this
    // light arriving through slats, so it is angled across the room rather than
    // down it — a raking angle is what turns slats into bands.
    const key = new DirectionalLight("key", new Vector3(0.86, -0.46, 0.22), this.scene);
    key.position = new Vector3(-shell.halfWidth - 3, SHELF_HEIGHT + 2.1, 3.2);
    key.diffuse = new Color3(1, 0.87, 0.66);
    key.specular = new Color3(0.3, 0.26, 0.2);
    key.intensity = 4.6;
    // The frustum is pinned to the room. Left to auto-fit over every wall it
    // spanned far more than the space and spent its resolution on nothing.
    key.shadowMinZ = 1;
    key.shadowMaxZ = 26;
    key.autoUpdateExtends = false;
    key.orthoLeft = -10;
    key.orthoRight = 10;
    key.orthoTop = 10;
    key.orthoBottom = -10;
    this.shadows = new ShadowGenerator(2048, key);
    // PCF rather than blurred exponential. ESM bleeds through thin occluders,
    // and a 10 cm slat is exactly that — the bands washed out entirely under it.
    this.shadows.usePercentageCloserFiltering = true;
    this.shadows.filteringQuality = ShadowGenerator.QUALITY_MEDIUM;
    this.shadows.bias = 0.0009;
    this.shadows.normalBias = 0.012;
    this.shadows.darkness = 0.28;

    // Warm fill from the sunlit side so the shelf faces do not go to pitch.
    for (const z of [2.6, 6, 9.4]) {
      const bounce = new PointLight(`salchang-bounce-${z}`, new Vector3(-shell.halfWidth + 1.1, SHELF_HEIGHT + 0.4, z), this.scene);
      bounce.diffuse = new Color3(1, 0.84, 0.62);
      bounce.specular = new Color3(0.2, 0.17, 0.12);
      bounce.intensity = 0.62;
      bounce.range = 9;
    }
    // A cooler, weaker answer from the east wall keeps the far shelves readable.
    for (const z of [3.4, 8.6]) {
      const fill = new PointLight(`east-fill-${z}`, new Vector3(shell.halfWidth - 1.2, SHELF_HEIGHT + 0.3, z), this.scene);
      fill.diffuse = new Color3(0.74, 0.76, 0.86);
      fill.intensity = 0.3;
      fill.range = 8;
    }
    void timber;
    void root;
  }

  /**
   * The slatted light on the floor.
   *
   * These were cast for three passes and never survived: a 9 cm slat twelve
   * metres from the light is smaller than a shadow-map texel once the frustum
   * covers the room, and PCF erases what is left. The sun still casts real
   * shadows for anything standing in the room; this places the pattern itself,
   * at the pitch of the slats and where the window geometry puts it.
   */
  private buildLightBands(root: TransformNode): void {
    const shell = ROOM_SHELL;
    const sillY = SHELF_HEIGHT + 0.24;
    const windowHeight = shell.height - SHELF_HEIGHT - 0.52;
    const slope = 0.46 / 0.86;
    const drift = 0.22 / 0.86;
    const nearX = -shell.halfWidth + sillY / slope;
    const farX = -shell.halfWidth + (sillY + windowHeight) / slope;
    const bandLength = Math.abs(farX - nearX);
    const centreX = (nearX + farX) / 2;

    const glow = signalMaterial(this.scene, "salchang-band", new Color3(1, 0.84, 0.58).scale(0.62), 0.92);
    const slatPitch = 0.17;
    for (const windowZ of [2.6, 6, 9.4]) {
      const landedZ = windowZ + (sillY * drift) / slope;
      const stripes = Math.round(2.6 / slatPitch);
      for (let index = 0; index < stripes; index += 1) {
        const z = landedZ - 1.3 + (index + 0.5) * (2.6 / stripes);
        const band = MeshBuilder.CreateBox(`salchang-band-${windowZ}-${index}`, {
          width: bandLength,
          height: 0.008,
          depth: slatPitch * 0.46,
        }, this.scene);
        band.position = new Vector3(centreX, 0.014, z);
        band.material = glow;
        band.isPickable = false;
        band.parent = root;
      }
      for (let index = 0; index < stripes; index += 1) {
        const z = landedZ - 1.3 + (index + 0.5) * (2.6 / stripes);
        const wallBand = MeshBuilder.CreateBox(`salchang-band-wall-${windowZ}-${index}`, {
          width: 0.01,
          height: 0.9,
          depth: slatPitch * 0.42,
        }, this.scene);
        wallBand.position = new Vector3(shell.halfWidth - 0.44, 0.62, z);
        wallBand.material = glow;
        wallBand.isPickable = false;
        wallBand.parent = root;
      }
    }
  }

  /** Cyan dashed for what the recording should walk, amber solid for the present. */
  private buildRouteLines(root: TransformNode): void {
    const shell = ROOM_SHELL;
    const past = signalMaterial(this.scene, "route-past", PALETTE.cyan.scale(0.4), 0.8);
    const present = signalMaterial(this.scene, "route-present", PALETTE.amber.scale(0.34), 0.8);

    const dashesFrom = shell.spawnZ + 0.9;
    const dashesTo = shell.plateCentreZ - shell.plateRadius - 0.2;
    const dashCount = Math.max(1, Math.round((dashesTo - dashesFrom) / 0.62));
    for (let index = 0; index < dashCount; index += 1) {
      const dash = MeshBuilder.CreateBox(`route-past-${index}`, { width: 0.1, height: 0.01, depth: 0.32 }, this.scene);
      dash.position = new Vector3(0, 0.022, dashesFrom + (index + 0.5) * ((dashesTo - dashesFrom) / dashCount));
      dash.material = past;
      dash.isPickable = false;
      dash.parent = root;
      this.glow.addIncludedOnlyMesh(dash);
    }

    const line = MeshBuilder.CreateBox("route-present", { width: 0.08, height: 0.01, depth: shell.depth - shell.plateCentreZ - 0.7 }, this.scene);
    line.position = new Vector3(0, 0.022, (shell.plateCentreZ + shell.plateRadius + shell.depth) / 2 - 0.1);
    line.material = present;
    line.isPickable = false;
    line.parent = root;
    this.glow.addIncludedOnlyMesh(line);
  }

  /**
   * The hyeonpan: a hanji board hung beside the door, chamber name written down
   * it and the number carved into a red seal. The one red in the room, and the
   * only thing here that names where you are.
   */
  private buildSign(root: TransformNode, timber: StandardMaterial): void {
    const shell = ROOM_SHELL;
    const signX = -shell.doorwayHalfWidth - 1.5;
    const board = buildSignBoard(this.scene, "chamber-sign", AWAKENING.name, AWAKENING.subtitle, "00");

    const backing = MeshBuilder.CreateBox("sign-backing", { width: 1.08, height: 1.92, depth: 0.09 }, this.scene);
    backing.position = new Vector3(signX, 2.05, shell.depth - 0.06);
    backing.material = timber;
    backing.isPickable = false;
    backing.parent = root;
    this.cast(backing);

    // Single-sided and unrotated: this is the orientation whose front faces the
    // room. Double-siding it shows the back face, which is the same texture read
    // right to left.
    const face = MeshBuilder.CreatePlane("chamber-sign-plane", { width: 0.92, height: 1.76 }, this.scene);
    face.position = new Vector3(signX, 2.05, shell.depth - 0.115);
    face.material = board;
    face.isPickable = false;
    face.parent = root;

    // A small brass lamp over the board, because a sign nobody lit is a sign
    // nobody reads.
    const hood = MeshBuilder.CreateBox("sign-lamp", { width: 0.42, height: 0.07, depth: 0.16 }, this.scene);
    hood.position = new Vector3(signX, 3.02, shell.depth - 0.24);
    hood.material = brassMaterial(this.scene, "sign-lamp-brass");
    hood.isPickable = false;
    hood.parent = root;
    const lamp = new PointLight("sign-lamp-light", new Vector3(signX, 2.86, shell.depth - 0.5), this.scene);
    lamp.diffuse = new Color3(1, 0.88, 0.68);
    lamp.intensity = 0.42;
    lamp.range = 3.4;
  }

  /**
   * The reading alcove: a lit room glimpsed through a salchang in the east wall,
   * always empty. It replaces the observation window, and it is the only thing
   * here suggesting the archive is staffed at all.
   */
  private buildReadingAlcove(root: TransformNode, timber: StandardMaterial, plaster: StandardMaterial): void {
    const shell = ROOM_SHELL;
    const x = shell.halfWidth;
    const centreZ = 6;
    const width = 2.4;
    const height = 1.5;
    const centreY = 1.5;

    // The room behind: floor, back wall, and its own warm lamp. An unlit recess
    // reads as a hole in the wall rather than a space beyond it.
    const backing = MeshBuilder.CreatePlane("alcove-back", { width, height, sideOrientation: Mesh.DOUBLESIDE }, this.scene);
    backing.position = new Vector3(x + 1.1, centreY, centreZ);
    backing.rotation = new Vector3(0, -Math.PI / 2, 0);
    backing.material = plaster;
    backing.isPickable = false;
    backing.parent = root;

    const alcoveFloor = MeshBuilder.CreateBox("alcove-floor", { width: 1.2, height: 0.04, depth: width }, this.scene);
    alcoveFloor.position = new Vector3(x + 0.6, centreY - height / 2, centreZ);
    alcoveFloor.material = timber;
    alcoveFloor.isPickable = false;
    alcoveFloor.parent = root;

    const desk = MeshBuilder.CreateBox("alcove-desk", { width: 0.5, height: 0.06, depth: 0.9 }, this.scene);
    desk.position = new Vector3(x + 0.72, centreY - height / 2 + 0.34, centreZ);
    desk.material = timber;
    desk.isPickable = false;
    desk.parent = root;

    const lamp = new PointLight("alcove-lamp", new Vector3(x + 0.7, centreY + 0.5, centreZ), this.scene);
    lamp.diffuse = new Color3(1, 0.86, 0.6);
    lamp.intensity = 0.62;
    lamp.range = 4;

    // The lattice you see it through.
    buildSalchang(this.scene, root, timber, signalMaterial(this.scene, "alcove-glass", new Color3(0.34, 0.3, 0.24)), {
      x,
      facing: -1,
      centreZ,
      width,
      sillY: centreY - height / 2,
      height,
      seed: 771,
    });
  }

  private buildPlate(root: TransformNode, brass: StandardMaterial, timber: StandardMaterial): { ring: Mesh; light: PointLight; ringMaterial: StandardMaterial } {
    const shell = ROOM_SHELL;
    const centre = new Vector3(0, 0, shell.plateCentreZ);

    // A brass disc set into a timber surround, flush enough to walk over.
    const surround = MeshBuilder.CreateCylinder("plate-surround", { diameter: shell.plateRadius * 2 + 0.46, height: 0.05, tessellation: 56 }, this.scene);
    surround.position = centre.add(new Vector3(0, 0.025, 0));
    surround.material = timber;
    surround.receiveShadows = true;
    surround.isPickable = false;
    surround.parent = root;

    const face = MeshBuilder.CreateCylinder("plate-face", { diameter: shell.plateRadius * 2, height: 0.055, tessellation: 56 }, this.scene);
    face.position = centre.add(new Vector3(0, 0.052, 0));
    face.material = brass;
    face.receiveShadows = true;
    face.isPickable = false;
    face.parent = root;

    // Concentric turned grooves, so the brass reads as a machined part.
    for (const [index, diameter] of [0.5, 0.9, 1.4].entries()) {
      const groove = MeshBuilder.CreateTorus(`plate-groove-${index}`, { diameter: shell.plateRadius * diameter, thickness: 0.016, tessellation: 44 }, this.scene);
      groove.position = centre.add(new Vector3(0, 0.079, 0));
      groove.material = brassMaterial(this.scene, `plate-groove-material-${index}`, 0.7);
      groove.isPickable = false;
      groove.parent = root;
    }

    const ringMaterial = signalMaterial(this.scene, "plate-ring", PALETTE.cyan);
    const ring = MeshBuilder.CreateTorus("plate-ring-mesh", { diameter: shell.plateRadius * 2 - 0.08, thickness: 0.05, tessellation: 56 }, this.scene);
    ring.position = centre.add(new Vector3(0, 0.082, 0));
    ring.material = ringMaterial;
    ring.isPickable = false;
    ring.parent = root;
    this.glow.addIncludedOnlyMesh(ring);

    const light = new PointLight("plate-light", centre.add(new Vector3(0, 0.6, 0)), this.scene);
    light.diffuse = PALETTE.cyan;
    light.intensity = 0.55;
    light.range = 5.5;

    return { ring, light, ringMaterial };
  }

  /**
   * Janjimun: a timber lattice door papered in hanji, lit from the corridor
   * behind it. It slides sideways into the wall rather than lifting — a paper
   * door that rose into a lintel would read as a shutter.
   */
  private buildDoor(root: TransformNode, timber: StandardMaterial): Mesh {
    const shell = ROOM_SHELL;
    const leafWidth = shell.doorwayHalfWidth * 2 - 0.04;
    const leafHeight = shell.doorwayHeight - 0.03;

    const slab = MeshBuilder.CreateBox("door-slab", { width: leafWidth, height: leafHeight, depth: 0.1 }, this.scene);
    slab.position = new Vector3(0, leafHeight / 2, shell.depth + shell.wallThickness / 2);
    slab.material = timber;
    slab.receiveShadows = true;
    slab.isPickable = false;
    slab.parent = root;
    this.cast(slab);

    // Paper panels between the muntins, glowing with the corridor behind.
    const paper = hanjiMaterial(this.scene, "door-hanji", 5501, 0.34);
    const columns = 3;
    const rows = 4;
    const stileWidth = 0.09;
    const cellWidth = (leafWidth - stileWidth * (columns + 1)) / columns;
    const cellHeight = (leafHeight - stileWidth * (rows + 1)) / rows;
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const panel = MeshBuilder.CreatePlane(`door-paper-${row}-${column}`, {
          width: cellWidth,
          height: cellHeight,
          sideOrientation: Mesh.DOUBLESIDE,
        }, this.scene);
        panel.position = new Vector3(
          -leafWidth / 2 + stileWidth * (column + 1) + cellWidth * (column + 0.5),
          -leafHeight / 2 + stileWidth * (row + 1) + cellHeight * (row + 0.5),
          -0.056,
        );
        panel.material = paper;
        panel.isPickable = false;
        panel.parent = slab;
      }
    }
    // Muntins over the paper.
    for (let column = 0; column <= columns; column += 1) {
      const stile = MeshBuilder.CreateBox(`door-stile-${column}`, { width: stileWidth, height: leafHeight, depth: 0.13 }, this.scene);
      stile.position = new Vector3(-leafWidth / 2 + stileWidth / 2 + column * (cellWidth + stileWidth), 0, -0.02);
      stile.material = timber;
      stile.isPickable = false;
      stile.parent = slab;
    }
    for (let row = 0; row <= rows; row += 1) {
      const rail = MeshBuilder.CreateBox(`door-rail-${row}`, { width: leafWidth, height: stileWidth, depth: 0.13 }, this.scene);
      rail.position = new Vector3(0, -leafHeight / 2 + stileWidth / 2 + row * (cellHeight + stileWidth), -0.02);
      rail.material = timber;
      rail.isPickable = false;
      rail.parent = slab;
    }
    const pull = MeshBuilder.CreateTorus("door-pull", { diameter: 0.16, thickness: 0.022, tessellation: 20 }, this.scene);
    pull.position = new Vector3(leafWidth / 2 - 0.24, 0.05, -0.09);
    pull.rotation.x = Math.PI / 2;
    pull.material = brassMaterial(this.scene, "door-pull-brass");
    pull.isPickable = false;
    pull.parent = slab;

    // The pocket the leaf slides into, so it disappears somewhere real.
    const pocket = MeshBuilder.CreateBox("door-pocket", { width: leafWidth + 0.2, height: leafHeight + 0.2, depth: 0.16 }, this.scene);
    pocket.position = new Vector3(shell.doorwayHalfWidth + leafWidth / 2 + 0.1, leafHeight / 2, shell.depth + shell.wallThickness / 2 + 0.1);
    pocket.material = timber;
    pocket.isPickable = false;
    pocket.parent = root;
    return slab;
  }

  private buildExit(root: TransformNode, timber: StandardMaterial): void {
    const shell = ROOM_SHELL;
    const wall = shell.corridorEnd;
    const openingWidth = 1.62;
    const openingHeight = 2.28;

    for (const side of [-1, 1] as const) {
      const post = MeshBuilder.CreateBox(`exit-post-${side}`, { width: 0.2, height: openingHeight + 0.34, depth: 0.18 }, this.scene);
      post.position = new Vector3(side * (openingWidth / 2 + 0.1), (openingHeight + 0.34) / 2, wall - 0.1);
      post.material = timber;
      post.isPickable = false;
      post.parent = root;
      this.cast(post);
    }
    const head = MeshBuilder.CreateBox("exit-head", { width: openingWidth + 0.4, height: 0.22, depth: 0.18 }, this.scene);
    head.position = new Vector3(0, openingHeight + 0.15, wall - 0.1);
    head.material = timber;
    head.isPickable = false;
    head.parent = root;
    this.cast(head);

    // Daylight past the last door: paper-warm rather than white, so leaving the
    // archive reads as stepping outside it.
    const panel = MeshBuilder.CreatePlane("exit-panel", {
      width: openingWidth,
      height: openingHeight,
      sideOrientation: Mesh.DOUBLESIDE,
    }, this.scene);
    panel.position = new Vector3(0, openingHeight / 2 + 0.04, wall - 0.13);
    panel.material = hanjiMaterial(this.scene, "exit-hanji", 8801, 0.78);
    panel.isPickable = false;
    panel.parent = root;
    // Deliberately not in the glow layer. Bloom already carries it, and the
    // extra pass was what turned the way out into a blank white rectangle from
    // halfway down the corridor.

    // The way out is a papered door too, so it keeps a lattice at any distance.
    const exitColumns = 2;
    const exitRows = 3;
    const exitStile = 0.08;
    for (let column = 0; column <= exitColumns; column += 1) {
      const stile = MeshBuilder.CreateBox(`exit-stile-${column}`, {
        width: exitStile,
        height: openingHeight,
        depth: 0.07,
      }, this.scene);
      stile.position = new Vector3(-openingWidth / 2 + (column / exitColumns) * openingWidth, openingHeight / 2 + 0.04, wall - 0.16);
      stile.material = timber;
      stile.isPickable = false;
      stile.parent = root;
    }
    for (let row = 0; row <= exitRows; row += 1) {
      const rail = MeshBuilder.CreateBox(`exit-rail-${row}`, {
        width: openingWidth,
        height: exitStile,
        depth: 0.07,
      }, this.scene);
      rail.position = new Vector3(0, 0.04 + (row / exitRows) * openingHeight, wall - 0.16);
      rail.material = timber;
      rail.isPickable = false;
      rail.parent = root;
    }

    const spillFloor = MeshBuilder.CreateBox("exit-floor", { width: openingWidth, height: 0.01, depth: 1.2 }, this.scene);
    spillFloor.position = new Vector3(0, 0.026, wall - 0.78);
    spillFloor.material = signalMaterial(this.scene, "exit-floor-glow", PALETTE.amber.scale(0.3), 0.85);
    spillFloor.isPickable = false;
    spillFloor.parent = root;

    const lamp = new PointLight("exit-lamp", new Vector3(0, 1.5, wall - 1.5), this.scene);
    lamp.diffuse = PALETTE.amber;
    lamp.intensity = 2;
    lamp.range = 10;

    const spill = new PointLight("exit-spill", new Vector3(0, 1.4, shell.depth + 1.6), this.scene);
    spill.diffuse = PALETTE.amber;
    spill.intensity = 0.5;
    spill.range = 8;
  }

  // ---------------------------------------------------------------- input

  private installInput(): void {
    this.canvas.addEventListener("keydown", (event) => this.onKey(event, true));
    this.canvas.addEventListener("keyup", (event) => this.onKey(event, false));
    // Held keys must not survive losing focus, or the echo records a walk the
    // player never took.
    this.canvas.addEventListener("blur", () => this.pressed.clear());
    // The promise rejection is the modern signal and pointerlockerror is the one
    // every browser sends. Chromium also refuses the lock outright while the
    // browser is under automation, which is why this path has to be real.
    document.addEventListener("pointerlockerror", () => {
      this.pointerLockDenied = true;
    });
    document.addEventListener("pointerlockchange", () => {
      this.pointerLocked = document.pointerLockElement === this.canvas;
      // Escape releases the pointer; the game has to stop with it, or the tape
      // keeps recording an empty room while the player reads their email.
      if (!this.pointerLocked && this.started) this.pause();
    });
    // Pointer events, not mouse events. Babylon's own input manager consumes
    // pointerdown on the canvas, and a consumed pointerdown suppresses the
    // compatibility mousedown/mousemove that would otherwise follow — so a
    // mouse-event listener here receives nothing at all.
    //
    // Two ways to look. Pointer lock is the good one; dragging is the one that
    // still works when a browser refuses the lock, which it may do for reasons
    // the player has no control over. A first-person game with no way to turn is
    // not a game, so the fallback is always wired rather than a setting.
    this.canvas.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      this.dragging = true;
      this.lastPointerX = event.clientX;
      this.lastPointerY = event.clientY;
    });
    document.addEventListener("pointerup", () => {
      this.dragging = false;
    });
    document.addEventListener("pointercancel", () => {
      this.dragging = false;
    });
    document.addEventListener("pointermove", (event) => {
      if (this.pointerLocked) {
        this.look(event.movementX, event.movementY);
        return;
      }
      if (!this.dragging) return;
      // movementX is only dependable under pointer lock, so the drag path
      // measures the delta itself.
      this.look(event.clientX - this.lastPointerX, event.clientY - this.lastPointerY);
      this.lastPointerX = event.clientX;
      this.lastPointerY = event.clientY;
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
    // Newer browsers return a promise that rejects when the request is denied;
    // older ones return nothing. A denial is not fatal, it just means the player
    // turns by dragging, so record it and let the HUD say so.
    const request: unknown = this.canvas.requestPointerLock();
    if (request instanceof Promise) {
      request.then(
        () => {
          this.pointerLockDenied = false;
        },
        () => {
          this.pointerLockDenied = true;
        },
      );
    }
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
    // Sideways, into the pocket: a papered leaf that rose into the lintel would
    // read as a shutter rather than a door.
    const target = door?.open ? ROOM_SHELL.doorwayHalfWidth * 2 - 0.08 : 0;
    // Ease rather than snap: a leaf that teleports open reads as a bug.
    this.doorOffset += (target - this.doorOffset) * Math.min(1, deltaSeconds * 6.5);
    this.doorSlab.position.x = this.doorOffset;

    const plateActive = state.plates[0]?.active ?? false;
    const pulse = plateActive ? 1.35 + Math.sin(this.clock * 5.2) * 0.18 : 0.62 + Math.sin(this.clock * 1.5) * 0.06;
    this.plateRingMaterial.emissiveColor = PALETTE.cyan.scale(pulse);
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
      pointerLockDenied: this.pointerLockDenied && !this.pointerLocked,
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
