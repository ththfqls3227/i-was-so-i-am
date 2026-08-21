import { Engine } from "@babylonjs/core/Engines/engine";
import { GlowLayer } from "@babylonjs/core/Layers/glowLayer";
import type { Light } from "@babylonjs/core/Lights/light";
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
import { TapeArchive } from "../sim/archive";
import { encodeFrame } from "../sim/input";
import { radiansFromYawUnits, yawUnitsFromRadians } from "../sim/trig";
import type { ActorId, ActorState, SimState } from "../sim/types";
import type { Chamber } from "../world/chamber";
import { ROSTER } from "../world/roster";
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
  /** False in a room that takes no recording; the HUD drops the whole apparatus. */
  recordingEnabled: boolean;
  /** The colour this room's fold stamps its seal in. Cyan only in the finale. */
  sealColour: "red" | "cyan";
  /** The seal is landing: the crosshair fades first so the freeze does not read as a hang. */
  sealing: boolean;
  /** What rerecord says in this room, when the room wants to say something else. */
  rerecordNotice: string | null;
  /** The chamber being played, and whether the archive goes any deeper. */
  chamberNumber: string;
  chamberName: string;
  hasNextChamber: boolean;
  /** What the facility says on the way into this chamber. */
  entryLine: string;
  /** The browser refused pointer lock, so looking around means dragging. */
  pointerLockDenied: boolean;
}

export interface SceneEvents {
  onFrame: (view: ViewModel) => void;
  onPhaseChange: (phase: SimState["phase"], previous: SimState["phase"]) => void;
  onFold: () => void;
  /** The finale's fold has begun and will land in this many seconds. */
  onSealing: (seconds: number) => void;
}

/**
 * The echo skins a room owns.
 *
 * `live` is the recording this run made. `archival` is a second, desaturated
 * skin for a record the archive is replaying on its own — 08 puts an older self
 * on a plate and never explains it. They are named rather than indexed because
 * the two are faded on different schedules: the live echo arrives over the first
 * second of the second pass, and in the finale it is never taken away at all.
 */
export interface RoomEchoes {
  live: StandardMaterial | null;
  archival: StandardMaterial | null;
}

interface PlateVisual {
  id: string;
  ring: Mesh;
  light: PointLight;
  material: StandardMaterial;
  accent: Color3;
  /** Whether the ring is a coloured signal or plain brass. See buildPlates. */
  signal: boolean;
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
  private chamber: Chamber;
  private simulation: Simulation;
  /** Everything the player has recorded, kept for the rooms that ask for it back. */
  readonly tapes = new TapeArchive();
  /** Ticks left of the finale's sealing hold, or 0 when nothing is being sealed. */
  private sealingTicks = 0;
  /** The last frame handed to the tick, repeated while the seal lands. */
  private lastFrame = 0;
  private events: SceneEvents | null = null;

  private readonly pressed = new Set<string>();
  private yaw: number;
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
  private echoes: RoomEchoes = { live: null, archival: null };
  private doorSlab: Mesh;
  private doorOffset = 0;
  /** Where the leaf sits when shut, and how far it slides. Both come from its brush. */
  private doorHome = 0;
  private doorTravel = 0;
  private plates: PlateVisual[];
  private shadows: ShadowGenerator | null = null;
  /** One band material per salchang, so a single window can be lit on its own. */
  private bandMaterials = new Map<string, StandardMaterial>();
  /** Sync-beat state: how much of the swell is left, and whether it has fired. */
  private warmBandLeft = 0;
  private warmBandSpent = false;
  private readonly bandRest = new Color3(1, 0.93, 0.78);
  private readonly bandWarm = new Color3(1, 0.72, 0.42);
  /** Everything the current chamber built. Dropped whole when the room changes. */
  private worldRoot: TransformNode | null = null;
  private roomLights: Light[] = [];
  private readonly resizeObserver: ResizeObserver;

  constructor(parent: HTMLElement, chamber: Chamber = ROSTER.first) {
    this.chamber = chamber;
    this.simulation = new Simulation(chamber.sim);
    this.yaw = radiansFromYawUnits(chamber.sim.spawn.yawUnits);
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

    this.camera = new UniversalCamera("fp-camera", new Vector3(0, simConstants.eyeHeight, chamber.sim.spawn.z), this.scene);
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

    const built = this.dressRoom();
    this.doorSlab = built.doorSlab;
    this.plates = built.plates;
    this.echo = built.echo;
    this.echoes = built.echoes;

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
    // Every shell surface occludes the glow layer. The layer draws only the
    // meshes it includes, so without this nothing writes depth for it and the
    // echo — the brightest thing in the game and the one the player is most
    // likely to have a wall between them and — shines through the shell. Adding
    // the panels one at a time chases it around the room; the shell is a dozen
    // planes and none of them cost anything unlit.
    this.glow.addIncludedOnlyMesh(plane);
    return plane;
  }

  /**
   * Build one chamber. Everything it makes hangs off a single root, and the
   * lights it adds are noted by diffing the scene, because lights are not
   * children of anything — that pair is what makes a room disposable.
   */
  private dressRoom(): {
    doorSlab: Mesh;
    plates: PlateVisual[];
    echo: Humanoid;
    echoes: RoomEchoes;
  } {
    const root = new TransformNode(`world-${this.chamber.sim.id}`, this.scene);
    const lightsBefore = new Set(this.scene.lights);
    this.bandMaterials.clear();
    const shell = this.chamber.shell;
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
    if (!this.chamber.dressing.corridor) {
      // No corridor means no doorway in the far wall: it is one solid plane, as
      // the room's own brush already says it is.
      this.surface("wall-far", width, shell.height, flat(0, shell.height / 2, shell.depth), new Vector3(0, Math.PI, 0), plaster, root, true, true);
    } else {
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
    }
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
      // Piers between and beyond the windows, derived from where the windows
      // actually are. Hardcoding 00's spacing put solid wall across 03's
      // openings and left gaps where it had none.
      const openings = this.chamber.dressing.salchang
        .filter((window) => Math.abs(window.x) === shell.halfWidth)
        .map((window) => [window.centreZ - window.width / 2, window.centreZ + window.width / 2] as const)
        .sort((left, right) => left[0] - right[0]);
      const piers: [number, number][] = [];
      let cursor = 0;
      for (const [from, to] of openings) {
        if (from - cursor > 0.05) piers.push([cursor, from]);
        cursor = Math.max(cursor, to);
      }
      if (shell.depth - cursor > 0.05) piers.push([cursor, shell.depth]);
      for (const [index, bounds] of piers.entries()) {
        const [from, to] = bounds;
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

    // Structure the shell does not describe: a partition across the floor, the
    // lining of a dead end. Drawn before the shelving so an alcove run stands
    // against a wall that is already there.
    for (const block of this.chamber.dressing.blocks) {
      const size = new Vector3(
        block.max.x - block.min.x,
        block.max.y - block.min.y,
        block.max.z - block.min.z,
      );
      const piece = MeshBuilder.CreateBox(`block-${block.id}`, { width: size.x, height: size.y, depth: size.z }, this.scene);
      piece.position = new Vector3(
        (block.min.x + block.max.x) / 2,
        (block.min.y + block.max.y) / 2,
        (block.min.z + block.max.z) / 2,
      );
      piece.material = block.finish === "timber" ? timber : plaster;
      piece.receiveShadows = true;
      piece.isPickable = false;
      piece.parent = root;
      this.cast(piece);
      // Into the glow layer as well, unlit. The layer renders only the meshes it
      // includes, so nothing else in the room writes depth for it and every
      // glowing thing shows through every wall — which nothing noticed until a
      // room put a cyan floor behind a partition and it printed itself on the
      // partition. Included and black, the wall occludes and adds no light.
      this.glow.addIncludedOnlyMesh(piece);
      // Timber joinery gets a banded face, so a partition reads as built rather
      // than as a box someone left in the hall.
      if (block.finish === "timber" && size.y > 1) {
        for (const y of [size.y * 0.28, size.y * 0.72]) {
          const band = MeshBuilder.CreateBox(`block-${block.id}-band-${y}`, {
            width: size.x + 0.05,
            height: 0.09,
            depth: size.z + 0.05,
          }, this.scene);
          band.position = piece.position.add(new Vector3(0, -size.y / 2 + y, 0));
          band.material = timberBeam;
          band.isPickable = false;
          band.parent = root;
        }
      }
      // Plaster over a timber frame is how these walls are actually built, and a
      // skirt and a rail are the two parts of that frame you see. Without them a
      // partition four metres tall is a blank panel the size of the screen.
      if (block.finish === "plaster" && size.y > 2.4 && size.x > 1) {
        for (const [part, y, height] of [["skirt", 0.16, 0.32], ["rail", 2.6, 0.14]] as const) {
          const trim = MeshBuilder.CreateBox(`block-${block.id}-${part}`, {
            width: size.x,
            height,
            depth: size.z + 0.06,
          }, this.scene);
          trim.position = new Vector3(piece.position.x, y, piece.position.z);
          trim.material = timberBeam;
          trim.receiveShadows = true;
          trim.isPickable = false;
          trim.parent = root;
        }
      }
    }

    // Gallery railings. Open, because the room's one frame is the player leaning
    // over this to look down at him, and the brush behind it is a solid metre of
    // parapet — the collision stops you falling, the balusters let you see.
    for (const rail of this.chamber.dressing.balustrades) {
      const span = rail.toZ - rail.fromZ;
      const centreZ = (rail.fromZ + rail.toZ) / 2;
      for (const [part, y, size] of [
        ["sill", rail.baseY + 0.09, 0.14],
        ["hand", rail.baseY + rail.height - 0.07, 0.16],
      ] as const) {
        const bar = MeshBuilder.CreateBox(`balustrade-${rail.id}-${part}`, {
          width: 0.19, height: size, depth: span,
        }, this.scene);
        bar.position = new Vector3(rail.x, y, centreZ);
        bar.material = timberBeam;
        bar.isPickable = false;
        bar.parent = root;
        this.cast(bar);
      }
      const count = Math.max(2, Math.round(span / 0.19));
      for (let index = 0; index <= count; index += 1) {
        const baluster = MeshBuilder.CreateBox(`balustrade-${rail.id}-post-${index}`, {
          width: 0.075, height: rail.height - 0.3, depth: 0.075,
        }, this.scene);
        baluster.position = new Vector3(
          rail.x,
          rail.baseY + rail.height / 2 - 0.01,
          rail.fromZ + (index / count) * span,
        );
        baluster.material = timber;
        baluster.isPickable = false;
        baluster.parent = root;
      }
    }

    // The image the whole identity rests on: walls packed with cases. Which walls
    // and how they lean is the room's to say.
    for (const run of this.chamber.dressing.shelves) {
      const wall = buildShelfWall(this.scene, root, timber, boxCase, boxLit, run);
      if (run.tiltRadians) wall.root.rotation.z = run.tiltRadians;
    }

    // Salchang above the shelving. Its slats are the only shadow casters that
    // matter: the stripe bands on the floor are cast, not painted, so they move
    // correctly as the player walks and fall over whatever is standing in them.
    const salchangGlass = signalMaterial(this.scene, "salchang-glass", new Color3(1, 0.93, 0.78));
    for (const window of this.chamber.dressing.salchang) {
      const slats = buildSalchang(this.scene, root, timber, salchangGlass, window);
      // Only the sun side's slats cast the bands.
      if (window.castsBands) for (const slat of slats) this.cast(slat);
    }

    // Post and beam: the frame the building is actually made of.
    // A fixed bay of 2.9 m from the entrance, and whatever short bay is left
    // over lands against the far wall — which is how the hand-authored row for
    // the 12 m hall was spaced, and reproduces it exactly. Spreading a fixed
    // count evenly instead looked equivalent and was not: it gave the 12 m hall
    // four beams where it had five and moved every one of them, along with the
    // shadows they throw down the floor.
    const beamPitch = 2.9;
    const lastBeamZ = shell.depth - 0.4;
    const beamRow: number[] = [];
    for (let z = 0.5; z < lastBeamZ - 0.5; z += beamPitch) beamRow.push(z);
    beamRow.push(lastBeamZ);
    for (const z of beamRow) {
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

    // Corridor: same materials, tighter section. Only for rooms that have one —
    // 03 leaves through its own east wall, and drawing it a corridor puts a
    // walkable-looking passage behind a solid wall.
    if (this.chamber.dressing.corridor) {
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

    // The archive does not stop at the door — the corridor's run of cases and the
    // lattice opposite it are both in the room's dressing, built with the rest.
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
    }

    // Doorway reveal, in timber rather than the old painted trim.
    if (this.chamber.dressing.corridor) {
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
    }

    this.buildLightBands(root);
    this.buildRouteLines(root);
    this.buildSign(root, timber);
    this.buildReadingAlcove(root, timber, plaster);

    const plates = this.buildPlates(root, brass, timber);
    const grips = this.buildGrips(root, brass, timber);
    void grips;
    const doorSlab = this.buildDoor(root, timber);
    if (this.chamber.dressing.corridor) this.buildExit(root, timber);
    else this.buildThreshold(root, timber);
    this.buildOpenBox(root, timber, brass);

    const echoSkin = echoMaterial(this.scene, "echo-core");
    const echo = createHumanoid(this.scene, "echo", echoSkin);
    echo.root.parent = root;
    echo.root.setEnabled(false);
    for (const part of echo.parts) {
      part.receiveShadows = false;
      part.applyFog = false;
    }
    this.glow.addIncludedOnlyMesh(echo.parts[0] as Mesh);

    this.worldRoot = root;
    this.roomLights = this.scene.lights.filter((light) => !lightsBefore.has(light));

    return {
      doorSlab,
      plates,
      echo,
      echoes: { live: echoSkin, archival: null },
    };
  }

  /** Drop the current chamber: its tree, its materials and its lights. */
  private clearRoom(): void {
    for (const light of this.roomLights) light.dispose();
    this.roomLights = [];
    // A chamber's materials and textures are procedural and its own, so they go
    // with it rather than accumulating one room's worth of atlases per switch.
    this.worldRoot?.dispose(false, true);
    this.worldRoot = null;
    this.shadows = null;
  }

  get currentChamber(): Chamber {
    return this.chamber;
  }

  /** Move on to the next chamber in the roster. False at the end of the archive. */
  advanceChamber(): boolean {
    const next = ROSTER.after(this.chamber.sim.id);
    if (!next) return false;
    this.switchChamber(next);
    return true;
  }

  /**
   * Tear the room down and put another one up. The simulation is replaced
   * wholesale rather than reset, because a chamber is a different world and
   * carrying anything across would be a bug waiting to be found later.
   */
  switchChamber(chamber: Chamber): void {
    const previousPhase = this.simulation.state.phase;
    // Whatever this room recorded belongs to the player now, not to the
    // simulation that is about to be thrown away.
    this.tapes.keep(this.simulation.currentTape);
    this.sealingTicks = 0;
    this.clearRoom();
    this.chamber = chamber;
    this.simulation = new Simulation(chamber.sim);

    const built = this.dressRoom();
    this.doorSlab = built.doorSlab;
    this.plates = built.plates;
    this.echo = built.echo;
    this.echoes = built.echoes;

    this.doorOffset = 0;
    this.stride.clear();
    this.pressed.clear();
    this.setLook(radiansFromYawUnits(chamber.sim.spawn.yawUnits), 0);
    this.captureSnapshots();
    this.previous = new Map(this.current);
    this.accumulator = 0;
    this.lastFrameTime = performance.now();
    this.events?.onPhaseChange(this.simulation.state.phase, previousPhase);
  }

  /** Register a mesh with the key light. Contact shadow is what seats an object on a floor. */
  private cast(mesh: Mesh): void {
    this.shadows?.addShadowCaster(mesh, false);
  }

  private buildLighting(root: TransformNode, timber: StandardMaterial): void {
    const shell = this.chamber.shell;
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
    // Sized to the room rather than to a number. Pinned at ±10 it covered the
    // 12 m hall it was tuned in and stopped partway down 06's 34 m one, which
    // put a hard straight edge across the floor where the cast bands simply
    // ended. The frustum is square about the room's middle, so a long room gets
    // a coarser map rather than a truncated one.
    const reach = Math.max(10, shell.depth * 0.62);
    key.shadowMinZ = 1;
    key.shadowMaxZ = Math.max(26, shell.depth + 14);
    key.autoUpdateExtends = false;
    key.orthoLeft = -reach;
    key.orthoRight = reach;
    key.orthoTop = reach;
    key.orthoBottom = -reach;
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
    const shell = this.chamber.shell;
    const sillY = SHELF_HEIGHT + 0.24;
    const windowHeight = shell.height - SHELF_HEIGHT - 0.52;
    const slope = 0.46 / 0.86;
    const drift = 0.22 / 0.86;
    const nearX = -shell.halfWidth + sillY / slope;
    const farX = -shell.halfWidth + (sillY + windowHeight) / slope;
    const bandLength = Math.abs(farX - nearX);
    const centreX = (nearX + farX) / 2;

    const slatPitch = 0.17;
    // One material per window, not one for the room. 04 warms the single band its
    // echo is standing in, and a shared material would warm the whole chamber.
    for (const window of this.chamber.dressing.salchang) {
      if (!window.castsBands) continue;
      const glow = signalMaterial(
        this.scene,
        `salchang-band-${window.id}`,
        new Color3(1, 0.84, 0.58).scale(0.62),
        0.92,
      );
      this.bandMaterials.set(window.id, glow);

      const landedZ = window.centreZ + (sillY * drift) / slope;
      const stripes = Math.round(window.width / slatPitch);
      for (let index = 0; index < stripes; index += 1) {
        const z = landedZ - window.width / 2 + (index + 0.5) * (window.width / stripes);
        const band = MeshBuilder.CreateBox(`salchang-band-${window.id}-${index}`, {
          width: bandLength,
          height: 0.008,
          depth: slatPitch * 0.46,
        }, this.scene);
        band.position = new Vector3(centreX, 0.014, z);
        band.material = glow;
        band.isPickable = false;
        band.parent = root;

        const wallBand = MeshBuilder.CreateBox(`salchang-band-wall-${window.id}-${index}`, {
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

  /**
   * Warm one window's floor band, for the beat in 04 where the player looks down
   * from the gallery at the self holding the switch that got them up there.
   * Nothing says so out loud; the light in the band he is standing in just
   * changes for a moment.
   */
  warmBand(salchangId: string, warmth: number): void {
    const material = this.bandMaterials.get(salchangId);
    if (!material) return;
    material.emissiveColor = new Color3(1, 0.84, 0.58).scale(0.62 + warmth * 0.5);
  }

  /** Cyan dashed for what the recording should walk, amber solid for the present. */
  private buildRouteLines(root: TransformNode): void {
    const shell = this.chamber.shell;
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
    const shell = this.chamber.shell;
    // Far wall beside the way out, unless the room says otherwise — 03 hangs it
    // on the partition, which is the wall you are looking at from the door.
    const hung = this.chamber.dressing.sign;
    const signX = hung ? hung.x : -shell.doorwayHalfWidth - 1.5;
    const signZ = hung ? hung.z : shell.depth;
    const board = buildSignBoard(
      this.scene,
      "chamber-sign",
      this.chamber.sim.name,
      this.chamber.sim.subtitle,
      this.chamber.number,
    );

    const backing = MeshBuilder.CreateBox("sign-backing", { width: 1.08, height: 1.92, depth: 0.09 }, this.scene);
    backing.position = new Vector3(signX, 2.05, signZ - 0.06);
    backing.material = timber;
    backing.isPickable = false;
    backing.parent = root;
    this.cast(backing);

    // Single-sided and unrotated: this is the orientation whose front faces the
    // room. Double-siding it shows the back face, which is the same texture read
    // right to left.
    const face = MeshBuilder.CreatePlane("chamber-sign-plane", { width: 0.92, height: 1.76 }, this.scene);
    face.position = new Vector3(signX, 2.05, signZ - 0.115);
    face.material = board;
    face.isPickable = false;
    face.parent = root;

    // A small brass lamp over the board, because a sign nobody lit is a sign
    // nobody reads.
    const hood = MeshBuilder.CreateBox("sign-lamp", { width: 0.42, height: 0.07, depth: 0.16 }, this.scene);
    hood.position = new Vector3(signX, 3.02, signZ - 0.24);
    hood.material = brassMaterial(this.scene, "sign-lamp-brass");
    hood.isPickable = false;
    hood.parent = root;
    const lamp = new PointLight("sign-lamp-light", new Vector3(signX, 2.86, signZ - 0.5), this.scene);
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
    const shell = this.chamber.shell;
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

  /**
   * Every plate the room actually has, where the simulation actually has it.
   *
   * Colour says who it answers to: amber is the living player's, cyan is the
   * recording's. 03 puts one of each in the same room and the whole puzzle is
   * knowing which is which, so this is not decoration.
   */
  private buildPlates(root: TransformNode, brass: StandardMaterial, timber: StandardMaterial): PlateVisual[] {
    const visuals: PlateVisual[] = [];
    for (const plate of this.chamber.sim.plates) {
      // Three states, and the third one is the absence of a colour: cyan is his
      // alone, amber is mine alone, and a plate either of us can stand on wears
      // plain brass. 00's plate is pressed by me on the recording pass and by
      // him on the replay, so either colour would have been a lie in the one
      // room whose whole job is teaching the language the other rooms speak.
      const signal = plate.requiredActor !== undefined;
      const accent = plate.requiredActor === "present"
        ? PALETTE.amber
        : plate.requiredActor === "past"
          ? PALETTE.cyan
          : PALETTE.brass;
      const centre = new Vector3(plate.centre.x, 0, plate.centre.z);
      // Brass is lit metal, not an emitter — the signal materials are unlit and
      // go through the glow layer, and putting a no-colour plate through the
      // same path would have made it a fourth signal rather than the absence of
      // one.
      const material = signal
        ? signalMaterial(this.scene, `plate-ring-${plate.id}`, accent)
        : brassMaterial(this.scene, `plate-ring-${plate.id}`);
      // A plate the size of a floor is a field, not a disc: it gets a bordered
      // bay with corner brackets so it still reads as one instrument.
      const field = plate.half.x > 1.1 || plate.half.z > 1.1;

      if (field) {
        const pad = MeshBuilder.CreateBox(`plate-pad-${plate.id}`, {
          width: plate.half.x * 2,
          height: 0.03,
          depth: plate.half.z * 2,
        }, this.scene);
        pad.position = centre.add(new Vector3(0, 0.015, 0));
        pad.material = timber;
        pad.receiveShadows = true;
        pad.isPickable = false;
        pad.parent = root;
        for (const sx of [-1, 1] as const) {
          for (const sz of [-1, 1] as const) {
            const along = MeshBuilder.CreateBox(`plate-bracket-x-${plate.id}-${sx}-${sz}`, {
              width: plate.half.x * 0.5, height: 0.035, depth: 0.09,
            }, this.scene);
            along.position = centre.add(new Vector3(sx * (plate.half.x - plate.half.x * 0.25), 0.032, sz * (plate.half.z - 0.05)));
            along.material = material;
            along.isPickable = false;
            along.parent = root;
            this.glow.addIncludedOnlyMesh(along);
            const across = MeshBuilder.CreateBox(`plate-bracket-z-${plate.id}-${sx}-${sz}`, {
              width: 0.09, height: 0.035, depth: plate.half.z * 0.5,
            }, this.scene);
            across.position = centre.add(new Vector3(sx * (plate.half.x - 0.05), 0.032, sz * (plate.half.z - plate.half.z * 0.25)));
            across.material = material;
            across.isPickable = false;
            across.parent = root;
            this.glow.addIncludedOnlyMesh(across);
          }
        }
      } else {
        const surround = MeshBuilder.CreateCylinder(`plate-surround-${plate.id}`, {
          diameter: plate.half.x * 2 + 0.46, height: 0.05, tessellation: 56,
        }, this.scene);
        surround.position = centre.add(new Vector3(0, 0.025, 0));
        surround.material = timber;
        surround.receiveShadows = true;
        surround.isPickable = false;
        surround.parent = root;

        const face = MeshBuilder.CreateCylinder(`plate-face-${plate.id}`, {
          diameter: plate.half.x * 2, height: 0.055, tessellation: 56,
        }, this.scene);
        face.position = centre.add(new Vector3(0, 0.052, 0));
        face.material = brass;
        face.receiveShadows = true;
        face.isPickable = false;
        face.parent = root;

        for (const [index, scale] of [0.5, 0.9, 1.4].entries()) {
          const groove = MeshBuilder.CreateTorus(`plate-groove-${plate.id}-${index}`, {
            diameter: plate.half.x * scale, thickness: 0.016, tessellation: 44,
          }, this.scene);
          groove.position = centre.add(new Vector3(0, 0.079, 0));
          groove.material = brassMaterial(this.scene, `plate-groove-material-${plate.id}-${index}`, 0.7);
          groove.isPickable = false;
          groove.parent = root;
        }
      }

      const ring = field
        ? MeshBuilder.CreateTorus(`plate-ring-mesh-${plate.id}`, {
          diameter: Math.min(plate.half.x, plate.half.z) * 1.1, thickness: 0.045, tessellation: 56,
        }, this.scene)
        : MeshBuilder.CreateTorus(`plate-ring-mesh-${plate.id}`, {
          diameter: plate.half.x * 2 - 0.08, thickness: 0.05, tessellation: 56,
        }, this.scene);
      ring.position = centre.add(new Vector3(0, field ? 0.038 : 0.082, 0));
      ring.material = material;
      ring.isPickable = false;
      ring.parent = root;
      if (signal) this.glow.addIncludedOnlyMesh(ring);

      // A field is the floor of a whole alcove, and its light is the only light
      // in there — the rig outside cannot reach past the partition.
      const light = new PointLight(`plate-light-${plate.id}`, centre.add(new Vector3(0, field ? 1.1 : 0.6, 0)), this.scene);
      light.diffuse = signal ? accent : new Color3(1, 0.87, 0.66);
      light.intensity = field ? 1.15 : 0.55;
      light.range = field ? 7 : 5.5;

      visuals.push({ id: plate.id, ring, light, material, accent, signal });
    }
    return visuals;
  }

  /**
   * The grips. 02 is a room about holding one and the finale is the same room
   * again, and until now the thing you hold was not drawn at all — you walked up
   * to an empty patch of floor and pressed a key.
   */
  private buildGrips(root: TransformNode, brass: StandardMaterial, timber: StandardMaterial): Mesh[] {
    const pillars: Mesh[] = [];
    for (const hold of this.chamber.sim.holds) {
      const base = new Vector3(hold.at.x, 0, hold.at.z);
      const plinth = MeshBuilder.CreateCylinder(`grip-plinth-${hold.id}`, { diameter: 1.02, height: 0.14, tessellation: 32 }, this.scene);
      plinth.position = base.add(new Vector3(0, 0.07, 0));
      plinth.material = timber;
      plinth.receiveShadows = true;
      plinth.isPickable = false;
      plinth.parent = root;
      this.cast(plinth);

      const column = MeshBuilder.CreateCylinder(`grip-column-${hold.id}`, { diameter: 0.34, height: hold.at.y, tessellation: 28 }, this.scene);
      column.position = base.add(new Vector3(0, hold.at.y / 2 + 0.1, 0));
      column.material = timber;
      column.receiveShadows = true;
      column.isPickable = false;
      column.parent = root;
      this.cast(column);
      pillars.push(column);

      // The brass the hand actually closes on, at the height the sim says.
      const collar = MeshBuilder.CreateCylinder(`grip-collar-${hold.id}`, { diameter: 0.44, height: 0.1, tessellation: 28 }, this.scene);
      collar.position = base.add(new Vector3(0, hold.at.y - 0.12, 0));
      collar.material = brass;
      collar.isPickable = false;
      collar.parent = root;
      const handle = MeshBuilder.CreateTorus(`grip-handle-${hold.id}`, { diameter: 0.4, thickness: 0.055, tessellation: 28 }, this.scene);
      handle.position = base.add(new Vector3(0, hold.at.y, 0));
      handle.rotation.x = Math.PI / 2;
      handle.material = brass;
      handle.isPickable = false;
      handle.parent = root;
      this.cast(handle);
      const cap = MeshBuilder.CreateCylinder(`grip-cap-${hold.id}`, { diameter: 0.3, height: 0.07, tessellation: 24 }, this.scene);
      cap.position = base.add(new Vector3(0, hold.at.y + 0.1, 0));
      cap.material = brass;
      cap.isPickable = false;
      cap.parent = root;

      const lamp = new PointLight(`grip-lamp-${hold.id}`, base.add(new Vector3(0, hold.at.y + 0.4, 0)), this.scene);
      lamp.diffuse = new Color3(1, 0.86, 0.62);
      lamp.intensity = 0.34;
      lamp.range = 4.2;
    }
    return pillars;
  }

  /**
   * The one memory box left standing open. 02 authors it and the finale inherits
   * the same coordinates: the anchor has to be findable without being a prop
   * with a spotlight on it.
   */
  private buildOpenBox(root: TransformNode, timber: StandardMaterial, brass: StandardMaterial): void {
    const at = this.chamber.dressing.openBox;
    if (!at) return;
    const centre = new Vector3(at.x, at.y, at.z);
    const shellBox = MeshBuilder.CreateBox("open-box-shell", { width: 0.36, height: 0.3, depth: 0.42 }, this.scene);
    shellBox.position = centre;
    shellBox.material = timber;
    shellBox.isPickable = false;
    shellBox.parent = root;
    // The lid, dropped open, and the dark the box is empty of.
    const lid = MeshBuilder.CreateBox("open-box-lid", { width: 0.36, height: 0.03, depth: 0.4 }, this.scene);
    lid.position = centre.add(new Vector3(0.2, 0.12, 0));
    lid.rotation.z = -0.72;
    lid.material = timber;
    lid.isPickable = false;
    lid.parent = root;
    const hollow = MeshBuilder.CreateBox("open-box-hollow", { width: 0.02, height: 0.24, depth: 0.36 }, this.scene);
    hollow.position = centre.add(new Vector3(0.18, 0, 0));
    hollow.material = matteMaterial(this.scene, "open-box-hollow-material", new Color3(0.02, 0.02, 0.025));
    hollow.isPickable = false;
    hollow.parent = root;

    // A dark box among hundreds of dark boxes is not an anchor. The finale asks
    // the player to recognise this one seven rooms later, so the mouth is
    // trimmed in brass and given its own small warm light — the difference the
    // eye catches is the lit rim and the shadow it throws inside, not a prop
    // with a spotlight on it.
    for (const [part, offset, size] of [
      ["top", new Vector3(0.18, 0.14, 0), new Vector3(0.03, 0.03, 0.42)],
      ["bottom", new Vector3(0.18, -0.14, 0), new Vector3(0.03, 0.03, 0.42)],
      ["near", new Vector3(0.18, 0, 0.2), new Vector3(0.03, 0.31, 0.03)],
      ["far", new Vector3(0.18, 0, -0.2), new Vector3(0.03, 0.31, 0.03)],
    ] as const) {
      const trim = MeshBuilder.CreateBox(`open-box-lip-${part}`, {
        width: size.x, height: size.y, depth: size.z,
      }, this.scene);
      trim.position = centre.add(offset);
      trim.material = brass;
      trim.isPickable = false;
      trim.parent = root;
    }
    const lamp = new PointLight("open-box-lamp", centre.add(new Vector3(0.7, 0.34, 0)), this.scene);
    lamp.diffuse = new Color3(1, 0.87, 0.66);
    lamp.intensity = 0.42;
    lamp.range = 2.4;
  }

  /**
   * For a room that leaves through its own wall: a corner of the floor is the
   * way out, with no corridor to announce it.
   *
   * The first version laid a dim amber slab over the whole exit volume and lit
   * it from above. Standing three metres away you could not tell it from floor —
   * a room whose puzzle you have just solved has to say where to go, so this
   * builds the thing a doorway actually is: two posts, a head across them, a
   * bright band on the line you cross, and light coming from inside it.
   */
  private buildThreshold(root: TransformNode, timber: StandardMaterial): void {
    const exit = this.chamber.sim.exit;
    const centre = new Vector3((exit.min.x + exit.max.x) / 2, 0, (exit.min.z + exit.max.z) / 2);
    const width = exit.max.x - exit.min.x;
    const depth = exit.max.z - exit.min.z;
    const height = 2.6;

    for (const side of [-1, 1] as const) {
      const post = MeshBuilder.CreateBox(`threshold-post-${side}`, { width: 0.24, height, depth: 0.34 }, this.scene);
      post.position = new Vector3(centre.x + side * (width / 2 - 0.12), height / 2, exit.min.z);
      post.material = timber;
      post.receiveShadows = true;
      post.isPickable = false;
      post.parent = root;
      this.cast(post);
    }

    const head = MeshBuilder.CreateBox("threshold-head", { width: width + 0.3, height: 0.28, depth: 0.36 }, this.scene);
    head.position = new Vector3(centre.x, height + 0.14, exit.min.z);
    head.material = timber;
    head.isPickable = false;
    head.parent = root;
    this.cast(head);

    // The line you cross, bright enough to read across the room, and narrow
    // enough that it stays a threshold rather than a lit floor.
    const band = MeshBuilder.CreateBox("threshold-sill", { width, height: 0.02, depth: 0.34 }, this.scene);
    band.position = new Vector3(centre.x, 0.012, exit.min.z);
    band.material = signalMaterial(this.scene, "threshold-glow", PALETTE.amber.scale(0.66), 0.95);
    band.isPickable = false;
    band.parent = root;
    this.glow.addIncludedOnlyMesh(band);

    // Warm light from inside the opening, so the posts are rimmed from within
    // and the corner is somewhere the room continues rather than ends.
    const lamp = new PointLight("threshold-lamp", new Vector3(centre.x, 1.9, exit.min.z + depth * 0.6), this.scene);
    lamp.diffuse = PALETTE.amber;
    lamp.intensity = 2.1;
    lamp.range = 7;
  }

  /**
   * Janjimun: a timber lattice door papered in hanji, lit from the corridor
   * behind it. It slides sideways into the wall rather than lifting — a paper
   * door that rose into a lintel would read as a shutter.
   */
  private buildDoor(root: TransformNode, timber: StandardMaterial): Mesh {
    // The leaf is measured from the door's own brush rather than from the shell.
    // 03's door is in a partition halfway down the hall, and reading the shell
    // put the only door in the room fifteen metres from the hole it fills.
    const brush = this.chamber.sim.doors[0]?.brush;
    const leafWidth = brush ? brush.max.x - brush.min.x - 0.04 : this.chamber.shell.doorwayHalfWidth * 2 - 0.04;
    const leafHeight = brush ? brush.max.y - brush.min.y - 0.03 : this.chamber.shell.doorwayHeight - 0.03;
    const leafX = brush ? (brush.min.x + brush.max.x) / 2 : 0;
    const leafZ = brush
      ? (brush.min.z + brush.max.z) / 2
      : this.chamber.shell.depth + this.chamber.shell.wallThickness / 2;
    this.doorHome = leafX;
    this.doorTravel = leafWidth + 0.04;

    // A door that is not in the far wall needs its own frame; the far-wall one
    // already has posts and a head from the doorway reveal.
    if (brush && !this.chamber.dressing.corridor) {
      for (const side of [-1, 1] as const) {
        const post = MeshBuilder.CreateBox(`partition-post-${side}`, { width: 0.22, height: leafHeight + 0.3, depth: 0.34 }, this.scene);
        post.position = new Vector3(leafX + side * (leafWidth / 2 + 0.11), (leafHeight + 0.3) / 2, leafZ);
        post.material = timber;
        post.isPickable = false;
        post.parent = root;
        this.cast(post);
      }
      const head = MeshBuilder.CreateBox("partition-head", { width: leafWidth + 0.5, height: 0.24, depth: 0.36 }, this.scene);
      head.position = new Vector3(leafX, leafHeight + 0.12, leafZ);
      head.material = timber;
      head.isPickable = false;
      head.parent = root;
      this.cast(head);

      // The paper's own light, thrown back down the hall. A partition faces the
      // way the player came from, which is the one direction nothing in the
      // lighting rig points, so without this the wall the room is about is a
      // black rectangle with a lit door floating in it.
      const spill = new PointLight("partition-spill", new Vector3(leafX, leafHeight * 0.62, leafZ - 0.9), this.scene);
      spill.diffuse = new Color3(1, 0.9, 0.72);
      spill.specular = new Color3(0.18, 0.15, 0.11);
      spill.intensity = 1.35;
      spill.range = 7.5;
    }

    const slab = MeshBuilder.CreateBox("door-slab", { width: leafWidth, height: leafHeight, depth: 0.1 }, this.scene);
    slab.position = new Vector3(leafX, leafHeight / 2, leafZ);
    slab.material = timber;
    slab.receiveShadows = true;
    slab.isPickable = false;
    slab.parent = root;
    this.cast(slab);
    // Same glow-layer occlusion the partition needs. Every door, not just the
    // partition ones: a far-wall door has a corridor behind it whose lit cases
    // were showing through the shut paper exactly as the alcove floor did.
    this.glow.addIncludedOnlyMesh(slab);

    // Paper panels between the muntins.
    //
    // A partition door has a dead-end alcove behind it, not a lit corridor, and
    // 03 is the room that asks you to walk face-first into this door and hold
    // the key down. At corridor brightness that filled the screen with flat
    // white at the exact moment the room is teaching you something.
    //
    // Zero here is not unlit paper: the fibre texture carries the sheet on its
    // own and the emissive colour only lays a flat pedestal over it, which is
    // what was crushing the fibre out. Measured at the contact pose, sampling
    // the centre panel — 0.12, 0.22 and 0.34 all land on 222 with a three-point
    // spread, clipped and indistinguishable from each other, while 0 reads 200
    // with a twelve-point spread and the mulberry strands come back. From
    // across the room it is still the brightest thing in the wall.
    const paper = hanjiMaterial(this.scene, "door-hanji", 5501, this.chamber.dressing.corridor ? 0.34 : 0);
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
    pocket.position = new Vector3(leafX + this.doorTravel + leafWidth / 2 - 0.1, leafHeight / 2, leafZ + 0.1);
    pocket.material = timber;
    pocket.isPickable = false;
    pocket.parent = root;
    return slab;
  }

  private buildExit(root: TransformNode, timber: StandardMaterial): void {
    const shell = this.chamber.shell;
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
      if (code === "Enter") this.beginFold();
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
    // The view is locked while the seal lands. Your hand is not yours for a moment.
    if (this.sealingTicks > 0) return;
    this.yaw += deltaX * this.sensitivity;
    this.pitch += deltaY * this.sensitivity;
    if (this.pitch > PITCH_LIMIT) this.pitch = PITCH_LIMIT;
    if (this.pitch < -PITCH_LIMIT) this.pitch = -PITCH_LIMIT;
  }

  press(code: string): void {
    if (this.sealingTicks > 0) return;
    this.pressed.add(code);
    if (code === "Enter") this.beginFold();
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

  /**
   * Begin the fold. In the finale this takes eight tenths of a second, during
   * which nothing responds.
   *
   * The wait is here rather than in the simulation on purpose. The tick keeps
   * receiving the same frame it was already receiving, so the tape is identical
   * to one folded instantly — the tail is the last sampled frame either way. A
   * delay inside the simulation would have to record something during the wait,
   * and recording neutral frames would leave the echo holding nothing, which is
   * the one thing this room cannot survive.
   */
  beginFold(): boolean {
    if (this.sealingTicks > 0) return false;
    if (!this.simulation.canFold) return false;
    const hold = this.chamber.sealHoldSeconds ?? 0;
    if (hold <= 0) return this.completeFold();
    this.sealingTicks = Math.round(hold * simConstants.tickRate);
    this.events?.onSealing(hold);
    return true;
  }

  /** True while the seal is landing: no input is read and the view is locked. */
  get isSealing(): boolean {
    return this.sealingTicks > 0;
  }

  /**
   * Private on purpose. Every way of folding has to go through beginFold, or a
   * caller that is not the keyboard silently skips the finale's held seal —
   * which is exactly what the exposed test API did until the browser journey
   * caught it.
   */
  private completeFold(): boolean {
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
    this.yaw = radiansFromYawUnits(this.chamber.sim.spawn.yawUnits);
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
      this.yaw = radiansFromYawUnits(this.chamber.sim.spawn.yawUnits);
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
        this.yaw = radiansFromYawUnits(this.chamber.sim.spawn.yawUnits) + Math.sin(this.clock * 0.16) * 0.09;
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
    if (this.sealingTicks > 0) {
      // Keep feeding the tick exactly what it was already getting, so the
      // recording does not change while the room takes the moment.
      this.sealingTicks -= 1;
      this.simulation.step(this.lastFrame);
      this.captureSnapshots();
      if (this.sealingTicks === 0) this.completeFold();
      return;
    }
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
    this.lastFrame = frame;
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
      if (this.echoes.live) this.echoes.live.alpha = 0.34 * (0.35 + arrival * 0.65);
    }

    const door = state.doors[0];
    // Sideways, into the pocket: a papered leaf that rose into the lintel would
    // read as a shutter rather than a door.
    const target = door?.open ? this.doorTravel : 0;
    // Ease rather than snap: a leaf that teleports open reads as a bug.
    this.doorOffset += (target - this.doorOffset) * Math.min(1, deltaSeconds * 6.5);
    this.doorSlab.position.x = this.doorHome + this.doorOffset;

    this.driveWarmBand(state, deltaSeconds);

    for (const visual of this.plates) {
      const active = state.plates.find((plate) => plate.id === visual.id)?.active ?? false;
      const pulse = active ? 1.35 + Math.sin(this.clock * 5.2) * 0.18 : 0.62 + Math.sin(this.clock * 1.5) * 0.06;
      // Brass still answers when you stand on it — a plate that gave no feedback
      // would be worse than one wearing the wrong colour — but at a quarter of
      // the signal's throw, so it reads as metal catching the room rather than
      // as a fourth thing in the colour language.
      visual.material.emissiveColor = visual.accent.scale(visual.signal ? pulse : pulse * 0.26);
      visual.light.intensity = active ? 1.5 : 0.55;
      visual.ring.scaling.y = active ? 0.7 : 1;
    }
  }

  /**
   * The one moment the building answers you.
   *
   * You reach the gallery because he is holding a grip on the floor below, and
   * for a second and a half the slatted light he is standing in goes warmer than
   * the rest of the room. It fires once, the first time you are up there while
   * he is down there holding on, and never again — a second time would read as a
   * mechanic with a rule to learn rather than as something the room did.
   */
  private driveWarmBand(state: SimState, deltaSeconds: number): void {
    const beat = this.chamber.dressing.warmBand;
    if (!beat) return;
    const material = this.bandMaterials.get(beat.windowId);
    if (!material) return;

    if (!this.warmBandSpent) {
      const above = (this.interpolated("present", 1)?.y ?? 0) > beat.aboveY;
      // His hand, not just an active grip — the beat is thanks for what he is doing.
      const holding = state.holds.some((hold) => hold.heldBy.includes("past"));
      if (above && holding && state.phase === "replay") {
        this.warmBandLeft = 1.5;
        this.warmBandSpent = true;
      }
    }
    if (this.warmBandLeft <= 0) return;

    this.warmBandLeft = Math.max(0, this.warmBandLeft - deltaSeconds);
    // Up fast, down slow, so it lands like a breath rather than a blink.
    const life = this.warmBandLeft / 1.5;
    const swell = life > 0.78 ? (1 - life) / 0.22 : life / 0.78;
    material.emissiveColor = Color3.Lerp(this.bandRest, this.bandWarm, swell * 0.85);
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
      tapeDuration: this.chamber.sim.tapeDurationTicks,
      replaySpan: this.chamber.sim.tapeDurationTicks + this.chamber.sim.replayGraceTicks,
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
      recordingEnabled: this.simulation.recordingEnabled,
      sealColour: this.chamber.dressing.sealColour,
      sealing: this.sealingTicks > 0,
      rerecordNotice: this.chamber.rerecordNotice ?? null,
      chamberNumber: this.chamber.number,
      chamberName: this.chamber.sim.name,
      entryLine: this.chamber.subtitleOnEntry,
      hasNextChamber: ROSTER.after(this.chamber.sim.id) !== null,
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
