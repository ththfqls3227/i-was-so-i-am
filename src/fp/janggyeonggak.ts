import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
// Thin instancing is registered by side effect. Without this import the
// prototype methods are absent under tree-shaking, thinInstanceSetBuffer does
// nothing at all, and every wall of boxes silently renders as one unit box at
// the origin — which is exactly what the first two passes did.
// Side-effect import: this is what installs thinInstanceSetBuffer onto Mesh.
// Without it every shelf wall silently renders as a single box at the origin —
// no error, no warning, just an archive with nothing in it. If a module shuffle
// ever makes this look unused, it is not. Keep it.
import "@babylonjs/core/Meshes/thinInstanceMesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";

import { normalFromHeight, scratchContext, seededRandom } from "./materials";

/**
 * Memory Janggyeonggak palette.
 *
 * Read from the reference the way the building actually reads: the shelves are
 * near-black, but the plaster and the floor are bright, and the light through
 * the lattice is brighter still. It is a high-contrast room, not a dark one —
 * getting that backwards produces a brown cave.
 */
export const PALETTE = {
  timber: new Color3(0.226, 0.166, 0.122),
  timberDark: new Color3(0.11, 0.084, 0.066),
  plaster: new Color3(0.845, 0.796, 0.706),
  floorBrick: new Color3(0.4, 0.365, 0.322),
  box: new Color3(0.082, 0.068, 0.06),
  brass: new Color3(0.541, 0.416, 0.208),
  seal: new Color3(0.722, 0.231, 0.18),
  hanji: new Color3(1, 0.882, 0.694),
  cyan: new Color3(0.24, 0.78, 0.95),
  amber: new Color3(1, 0.62, 0.24),
} as const;


/**
 * Draw on a real 2D canvas, then blit into a texture. Babylon's own context is
 * missing half the path API — `ellipse` among it — and these surfaces are all
 * pattern rather than type, so a straight blit needs no Y flip.
 */
function bakeTexture(
  scene: Scene,
  name: string,
  size: number,
  draw: (context: CanvasRenderingContext2D) => void,
  scale: number,
): DynamicTexture {
  const scratch = scratchContext(size, size);
  draw(scratch);
  const texture = new DynamicTexture(name, { width: size, height: size }, scene, false);
  texture.getContext().drawImage(scratch.canvas, 0, 0);
  texture.wrapU = Texture.WRAP_ADDRESSMODE;
  texture.wrapV = Texture.WRAP_ADDRESSMODE;
  texture.uScale = scale;
  texture.vScale = scale;
  texture.update(false);
  return texture;
}

/** Timber: straight grain, a few darker rings, the odd knot. */
export function timberMaterial(
  scene: Scene,
  name: string,
  tint: Color3,
  seed: number,
  options: { grainAlong?: "u" | "v"; scale?: number } = {},
): StandardMaterial {
  const size = 512;
  const random = seededRandom(seed);
  const context = scratchContext(size, size);
  const height = scratchContext(size, size);
  const along = options.grainAlong ?? "v";

  context.fillStyle = "#2f231b";
  context.fillRect(0, 0, size, size);
  height.fillStyle = "rgb(150, 150, 150)";
  height.fillRect(0, 0, size, size);

  // Grain lines run the length of the board; density varies so the plank does
  // not read as corduroy.
  let cursor = 0;
  while (cursor < size) {
    const band = 2 + random() * 9;
    const shade = 22 + Math.floor(random() * 26);
    const alpha = 0.18 + random() * 0.5;
    context.fillStyle = `rgba(${shade}, ${Math.floor(shade * 0.74)}, ${Math.floor(shade * 0.56)}, ${alpha})`;
    const depth = 150 - Math.floor(alpha * 46);
    height.fillStyle = `rgb(${depth}, ${depth}, ${depth})`;
    if (along === "v") {
      context.fillRect(cursor, 0, band, size);
      height.fillRect(cursor, 0, band, size);
    } else {
      context.fillRect(0, cursor, size, band);
      height.fillRect(0, cursor, size, band);
    }
    cursor += band + random() * 5;
  }

  // Knots: two or three per board, with the grain pulled around them.
  for (let index = 0; index < 3; index += 1) {
    if (random() > 0.7) continue;
    const kx = random() * size;
    const ky = random() * size;
    const radius = 6 + random() * 12;
    for (let ring = 5; ring >= 1; ring -= 1) {
      context.beginPath();
      context.ellipse(kx, ky, radius * ring * 0.34, radius * ring * 0.2, random() * 0.4, 0, Math.PI * 2);
      context.strokeStyle = `rgba(18, 13, 9, ${0.4 - ring * 0.05})`;
      context.lineWidth = 1.6;
      context.stroke();
    }
    height.beginPath();
    height.ellipse(kx, ky, radius * 0.6, radius * 0.4, 0, 0, Math.PI * 2);
    height.fillStyle = "rgb(120, 120, 120)";
    height.fill();
  }

  for (let index = 0; index < 1400; index += 1) {
    const grain = random() > 0.5 ? 210 : 30;
    context.fillStyle = `rgba(${grain}, ${grain}, ${grain}, ${0.01 + random() * 0.02})`;
    context.fillRect(random() * size, random() * size, 1, 1 + random() * 2);
  }

  const albedo = bakeTexture(scene, `${name}-albedo`, size, (target) => {
    target.drawImage(context.canvas, 0, 0);
  }, options.scale ?? 1);

  const surface = new StandardMaterial(name, scene);
  surface.diffuseColor = tint;
  surface.ambientColor = Color3.White();
  surface.specularColor = new Color3(0.06, 0.05, 0.04);
  surface.specularPower = 24;
  surface.diffuseTexture = albedo;
  const relief = normalFromHeight(scene, `${name}-normal`, height.getImageData(0, 0, size, size).data, size, 1.3);
  relief.uScale = options.scale ?? 1;
  relief.vScale = options.scale ?? 1;
  surface.bumpTexture = relief;
  return surface;
}

/** Lime plaster: warm, coarse, trowelled. The room's bright value. */
export function plasterMaterial(scene: Scene, name: string, seed: number, scale = 1): StandardMaterial {
  const size = 512;
  const random = seededRandom(seed);
  const context = scratchContext(size, size);
  const height = scratchContext(size, size);
  context.fillStyle = "#ddd2bd";
  context.fillRect(0, 0, size, size);
  height.fillStyle = "rgb(150, 150, 150)";
  height.fillRect(0, 0, size, size);

  // Trowel sweeps: long shallow arcs, barely visible until light rakes them.
  for (let index = 0; index < 26; index += 1) {
    const y = random() * size;
    context.beginPath();
    context.moveTo(-20, y);
    context.quadraticCurveTo(size / 2, y + (random() - 0.5) * 60, size + 20, y + (random() - 0.5) * 30);
    context.strokeStyle = `rgba(${random() > 0.5 ? 255 : 150}, ${random() > 0.5 ? 250 : 142}, 226, ${0.03 + random() * 0.05})`;
    context.lineWidth = 6 + random() * 22;
    context.stroke();
    height.beginPath();
    height.moveTo(-20, y);
    height.quadraticCurveTo(size / 2, y + (random() - 0.5) * 60, size + 20, y + (random() - 0.5) * 30);
    height.strokeStyle = `rgba(190, 190, 190, ${0.25 + random() * 0.3})`;
    height.lineWidth = 6 + random() * 20;
    height.stroke();
  }
  // Aggregate: the grit that makes lime read as lime.
  for (let index = 0; index < 5200; index += 1) {
    const light = random() > 0.45;
    context.fillStyle = `rgba(${light ? 255 : 96}, ${light ? 248 : 88}, ${light ? 228 : 74}, ${0.03 + random() * 0.07})`;
    const size1 = 1 + random() * 2.2;
    context.fillRect(random() * size, random() * size, size1, size1);
    const bump = light ? 178 : 126;
    height.fillStyle = `rgb(${bump}, ${bump}, ${bump})`;
    height.fillRect(random() * size, random() * size, size1, size1);
  }

  const albedo = bakeTexture(scene, `${name}-albedo`, size, (target) => {
    target.drawImage(context.canvas, 0, 0);
  }, scale);

  const surface = new StandardMaterial(name, scene);
  surface.diffuseColor = PALETTE.plaster;
  surface.ambientColor = Color3.White();
  surface.specularColor = new Color3(0.03, 0.03, 0.028);
  surface.specularPower = 12;
  surface.diffuseTexture = albedo;
  const relief = normalFromHeight(scene, `${name}-normal`, height.getImageData(0, 0, size, size).data, size, 0.9);
  relief.uScale = scale;
  relief.vScale = scale;
  surface.bumpTexture = relief;
  return surface;
}

/** Fired brick floor with timber boards run through it. */
export function brickFloorMaterial(scene: Scene, name: string, seed: number, scale = 1): StandardMaterial {
  const size = 512;
  const random = seededRandom(seed);
  const context = scratchContext(size, size);
  const height = scratchContext(size, size);
  const rows = 6;
  const columns = 3;
  const brickHeight = size / rows;
  const brickWidth = size / columns;

  context.fillStyle = "#4a443c";
  context.fillRect(0, 0, size, size);
  height.fillStyle = "rgb(96, 96, 96)";
  height.fillRect(0, 0, size, size);

  for (let row = 0; row < rows; row += 1) {
    const offset = (row % 2) * brickWidth * 0.5;
    for (let column = -1; column <= columns; column += 1) {
      const x = column * brickWidth + offset + 3;
      const y = row * brickHeight + 3;
      const width = brickWidth - 6;
      const depth = brickHeight - 6;
      const shade = 92 + Math.floor(random() * 26);
      context.fillStyle = `rgb(${shade}, ${Math.floor(shade * 0.93)}, ${Math.floor(shade * 0.83)})`;
      context.fillRect(x, y, width, depth);
      height.fillStyle = "rgb(178, 178, 178)";
      height.fillRect(x, y, width, depth);
      // Wear pulls the centre of each brick lighter than its edges.
      const wear = context.createRadialGradient(x + width / 2, y + depth / 2, 2, x + width / 2, y + depth / 2, width * 0.6);
      wear.addColorStop(0, `rgba(210, 200, 182, ${0.05 + random() * 0.07})`);
      wear.addColorStop(1, "rgba(210, 200, 182, 0)");
      context.fillStyle = wear;
      context.fillRect(x, y, width, depth);
    }
  }
  for (let index = 0; index < 2600; index += 1) {
    const light = random() > 0.5;
    context.fillStyle = `rgba(${light ? 230 : 40}, ${light ? 222 : 36}, ${light ? 202 : 30}, ${0.015 + random() * 0.03})`;
    context.fillRect(random() * size, random() * size, 1 + random() * 2, 1 + random() * 2);
  }

  const albedo = bakeTexture(scene, `${name}-albedo`, size, (target) => {
    target.drawImage(context.canvas, 0, 0);
  }, scale);

  const surface = new StandardMaterial(name, scene);
  surface.diffuseColor = PALETTE.floorBrick;
  surface.ambientColor = Color3.White();
  surface.specularColor = new Color3(0.04, 0.038, 0.034);
  surface.specularPower = 20;
  surface.diffuseTexture = albedo;
  const relief = normalFromHeight(scene, `${name}-normal`, height.getImageData(0, 0, size, size).data, size, 1.1);
  relief.uScale = scale;
  relief.vScale = scale;
  surface.bumpTexture = relief;
  return surface;
}

/**
 * Brass: hardware, rings, the seal press. Warm metal with a real highlight, so
 * the few brass points in a timber room carry light the way metal should.
 */
export function brassMaterial(scene: Scene, name: string, shade = 1): StandardMaterial {
  const surface = new StandardMaterial(name, scene);
  surface.diffuseColor = PALETTE.brass.scale(shade);
  surface.ambientColor = Color3.White();
  surface.specularColor = new Color3(0.62, 0.5, 0.28);
  surface.specularPower = 68;
  surface.emissiveColor = PALETTE.brass.scale(0.05);
  return surface;
}

/**
 * Hanji: paper over a timber lattice, lit from behind. Translucent, so its own
 * light is the point — and deliberately not depth-pre-passed, which is the trap
 * that turned two earlier translucent surfaces into black plates.
 */
export function hanjiMaterial(scene: Scene, name: string, seed: number, glow = 1): StandardMaterial {
  const size = 256;
  const random = seededRandom(seed);
  const context = scratchContext(size, size);
  context.fillStyle = "#fff0d4";
  context.fillRect(0, 0, size, size);
  // Mulberry fibre: short pale strands suspended in the sheet.
  for (let index = 0; index < 520; index += 1) {
    const x = random() * size;
    const y = random() * size;
    const length = 4 + random() * 22;
    const angle = random() * Math.PI;
    context.strokeStyle = `rgba(${210 + random() * 40}, ${190 + random() * 40}, ${150 + random() * 40}, ${0.1 + random() * 0.24})`;
    context.lineWidth = 0.6 + random() * 1.4;
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(x + Math.cos(angle) * length, y + Math.sin(angle) * length);
    context.stroke();
  }
  const texture = bakeTexture(scene, `${name}-fibre`, size, (target) => {
    target.drawImage(context.canvas, 0, 0);
  }, 1);

  const surface = new StandardMaterial(name, scene);
  surface.diffuseColor = Color3.Black();
  // Clamped deliberately. Paper lit past 1.0 clips to flat white, and then the
  // glow layer and bloom finish the job — at which point the muntins vanish and
  // a papered door reads as a rectangle of nothing. The sense of brightness is
  // bloom's to supply; the material's job is to keep its fibre.
  surface.emissiveColor = PALETTE.hanji.scale(Math.min(glow, 0.78));
  surface.emissiveTexture = texture;
  surface.specularColor = Color3.Black();
  surface.ambientColor = Color3.Black();
  surface.disableLighting = true;
  surface.needDepthPrePass = false;
  return surface;
}

export interface ShelfWallOptions {
  id?: string;
  /** Wall plane in x, and which way the boxes face. */
  x: number;
  facing: 1 | -1;
  fromZ: number;
  toZ: number;
  height: number;
  seed: number;
  /** How far the shelving stands off the wall. Corridors get a shallower run. */
  depth?: number;
  /**
   * Floor the run stands on. A gallery is a floor too, and a two-storey room
   * dressed only at ground level is four metres of blank plaster above the
   * shelving — which is what 04 was.
   */
  baseY?: number;
  /**
   * Fraction of cases missing from the shelves, 0 to 1. 07 is the room nobody
   * maintains, and an archive says that by what is not on the shelf.
   */
  decay?: number;
}

export interface ShelfWall {
  /**
   * The run's own node, at the centre of the run. Rotate this to lean the whole
   * wall — every part of it, boxes included, is placed relative to this point.
   */
  root: TransformNode;
  /** Every box on this wall, in one draw call. */
  boxes: Mesh;
  /** The ~5% that still hold a readable memory. */
  lit: Mesh;
  frame: Mesh[];
}

/**
 * A wall of memory boxes.
 *
 * Hundreds of near-black cases on open timber shelving, which is the single
 * image the whole identity rests on. They are thin instances: one draw call for
 * the wall, built once at construction, because a per-transition allocation of
 * this size is exactly the stall this project has paid for six times.
 */
/**
 * The small board under a corridor window. Number, then the room's name.
 *
 * Not a hyeonpan: those hang in the rooms and are read at eye level. This is a
 * museum label — the archive's own hand, small and level with the sill, saying
 * which record you are looking at.
 */
export function buildDioramaBoard(
  scene: Scene,
  name: string,
  title: string,
  number: string,
): StandardMaterial {
  const width = 512;
  const height = 180;
  const context = scratchContext(width, height);
  context.fillStyle = "#1a1512";
  context.fillRect(0, 0, width, height);
  context.fillStyle = "#d8cbb0";
  context.fillRect(10, 10, width - 20, height - 20);
  context.fillStyle = "#241c14";
  context.textBaseline = "middle";
  context.textAlign = "left";
  context.font = '600 76px "Helvetica Neue", Helvetica, Arial, sans-serif';
  context.fillText(number, 34, height / 2);
  context.font = '500 60px "Apple SD Gothic Neo", "Noto Sans KR", sans-serif';
  context.fillText(title, 150, height / 2 + 4);

  const texture = new DynamicTexture(name, { width, height }, scene, false);
  const target = texture.getContext();
  // Flipped, because DynamicTexture reads bottom-up and a mirrored label is
  // worse than no label.
  target.translate(0, height);
  target.scale(1, -1);
  target.drawImage(context.canvas, 0, 0);
  texture.update(false);

  const surface = new StandardMaterial(name, scene);
  surface.diffuseColor = Color3.Black();
  // Dim: a museum label is read when you look for it, not the brightest
  // thing on the wall. At full strength it out-shone the set it labels.
  surface.emissiveColor = new Color3(0.4, 0.37, 0.32);
  surface.emissiveTexture = texture;
  surface.specularColor = Color3.Black();
  surface.disableLighting = true;
  surface.needDepthPrePass = false;
  return surface;
}

export function buildShelfWall(
  scene: Scene,
  parent: TransformNode,
  timber: StandardMaterial,
  boxMaterial: StandardMaterial,
  litMaterial: StandardMaterial,
  options: ShelfWallOptions,
): ShelfWall {
  const { x, facing, fromZ, toZ, height, seed } = options;
  const depth = options.depth ?? 0.42;
  const decay = options.decay ?? 0;
  const random = seededRandom(seed);
  const frame: Mesh[] = [];

  // Everything below is placed relative to this node rather than to the world.
  // Thin instance matrices are relative to their mesh, and the mesh inherits the
  // parent — so absolute matrices under a rotated parent swing the whole wall
  // around the world origin instead of leaning it where it stands.
  const centreZ = (fromZ + toZ) / 2;
  const run = new TransformNode(`shelf-run-${options.id ?? x}`, scene);
  run.position = new Vector3(x, options.baseY ?? 0, centreZ);
  run.parent = parent;

  const shelfLevels: number[] = [];
  const firstShelf = 0.34;
  const shelfPitch = 0.46;
  for (let y = firstShelf; y <= height - 0.32; y += shelfPitch) shelfLevels.push(y);

  const span = toZ - fromZ;

  // Shelf boards and the uprights that carry them.
  for (const [index, y] of shelfLevels.entries()) {
    const board = MeshBuilder.CreateBox(`shelf-board-${x}-${index}`, { width: depth, height: 0.05, depth: span }, scene);
    board.position = new Vector3(facing * (depth / 2), y, 0);
    board.material = timber;
    board.isPickable = false;
    board.parent = run;
    board.receiveShadows = true;
    frame.push(board);
  }
  const uprightCount = Math.max(2, Math.round(span / 1.55));
  for (let index = 0; index <= uprightCount; index += 1) {
    const z = fromZ + (index / uprightCount) * span;
    const post = MeshBuilder.CreateBox(`shelf-post-${x}-${index}`, { width: depth + 0.04, height, depth: 0.11 }, scene);
    post.position = new Vector3(facing * (depth / 2), height / 2, z - centreZ);
    post.material = timber;
    post.isPickable = false;
    post.parent = run;
    post.receiveShadows = true;
    frame.push(post);
  }

  // The boxes themselves, stacked on edge like the woodblocks they stand for.
  const pitch = 0.074;
  const perLevel = Math.floor((span - 0.3) / pitch);
  const plain: number[] = [];
  const lit: number[] = [];
  const boxHeight = shelfPitch - 0.12;
  for (const y of shelfLevels) {
    for (let index = 0; index < perLevel; index += 1) {
      const z = fromZ + 0.15 + (index + 0.5) * pitch;
      // Slight per-box jitter: hand-stacked, not machined.
      const jitterX = (random() - 0.5) * 0.02;
      const jitterY = (random() - 0.5) * 0.012;
      const scaleY = 0.9 + random() * 0.2;
      const matrix = Matrix.Scaling(1, scaleY, 0.86 + random() * 0.18).multiply(
        Matrix.Translation(
          facing * (depth / 2 + jitterX),
          y + boxHeight * scaleY * 0.5 + 0.03 + jitterY,
          z - centreZ,
        ),
      );
      // Gaps, where a room is not kept. The slot is simply skipped, so the
      // shelf reads as robbed rather than as sparsely stocked — and a handful
      // of what went missing is lying on the floor below.
      if (decay > 0 && random() < decay) {
        if (random() < 0.16) {
          const fallen = Matrix.RotationYawPitchRoll(random() * 3.14, 0, 1.57 + (random() - 0.5) * 0.5).multiply(
            Matrix.Translation(
              facing * (depth * 0.5 + 0.12 + random() * 0.5),
              0.055,
              z - centreZ + (random() - 0.5) * 0.3,
            ),
          );
          plain.push(...fallen.asArray());
        }
        continue;
      }
      // A memory that can still be replayed leaks light at its edge.
      (random() < 0.052 ? lit : plain).push(...matrix.asArray());
    }
  }

  const boxes = MeshBuilder.CreateBox(`memory-box-${x}`, { width: depth - 0.06, height: boxHeight, depth: pitch - 0.016 }, scene);
  boxes.material = boxMaterial;
  boxes.isPickable = false;
  boxes.parent = run;
  boxes.receiveShadows = true;
  boxes.thinInstanceSetBuffer("matrix", new Float32Array(plain), 16);
  // Without this the mesh keeps the bounding box of a single unit box at the
  // origin, and the entire wall vanishes as soon as that point leaves frame.
  boxes.thinInstanceRefreshBoundingInfo(true);

  const litBoxes = MeshBuilder.CreateBox(`memory-box-lit-${x}`, { width: depth - 0.055, height: boxHeight, depth: pitch - 0.014 }, scene);
  litBoxes.material = litMaterial;
  litBoxes.isPickable = false;
  litBoxes.parent = run;
  litBoxes.thinInstanceSetBuffer("matrix", new Float32Array(lit), 16);
  litBoxes.thinInstanceRefreshBoundingInfo(true);

  return { root: run, boxes, lit: litBoxes, frame };
}

/**
 * Salchang: the slatted window that gives the room its light. The lattice is
 * real geometry so it casts the bands itself rather than faking them with a
 * decal — with one directional light behind it, the stripes land where the
 * geometry says they should and move correctly as you walk.
 */
export function buildSalchang(
  scene: Scene,
  parent: TransformNode,
  timber: StandardMaterial,
  glass: StandardMaterial,
  options: {
    x: number; facing: 1 | -1; centreZ: number; width: number; sillY: number; height: number; seed: number;
    /**
     * No pane. The luminous plane behind the lattice is daylight, and a window
     * with a room behind it must not have daylight in it — the corridor's ten
     * windows are lattices you look through, not windows you look at.
     */
    open?: boolean;
  },
): Mesh[] {
  const { x, facing, centreZ, width, sillY, height } = options;
  const parts: Mesh[] = [];

  if (!options.open) {
  const opening = MeshBuilder.CreatePlane(`salchang-glow-${centreZ}`, { width, height, sideOrientation: Mesh.DOUBLESIDE }, scene);
  opening.position = new Vector3(x + facing * 0.04, sillY + height / 2, centreZ);
  opening.rotation = new Vector3(0, facing > 0 ? -Math.PI / 2 : Math.PI / 2, 0);
  opening.material = glass;
  opening.isPickable = false;
  opening.parent = parent;
  parts.push(opening);
  }

  // Vertical slats. The gap has to be wider than the slat, or the window is
  // mostly wall: at 0.1 wide on a 0.135 pitch it was 74% solid and the room got
  // almost no sun at all, which is why the floor bands never appeared.
  const slatPitch = 0.17;
  const slatCount = Math.max(3, Math.round(width / slatPitch));
  for (let index = 0; index <= slatCount; index += 1) {
    const z = centreZ - width / 2 + (index / slatCount) * width;
    const slat = MeshBuilder.CreateBox(`salchang-slat-${centreZ}-${index}`, { width: 0.09, height, depth: 0.05 }, scene);
    slat.position = new Vector3(x + facing * 0.05, sillY + height / 2, z);
    slat.material = timber;
    slat.isPickable = false;
    slat.parent = parent;
    parts.push(slat);
  }
  for (const [index, y] of [sillY - 0.06, sillY + height + 0.06].entries()) {
    const rail = MeshBuilder.CreateBox(`salchang-rail-${centreZ}-${index}`, { width: 0.16, height: 0.12, depth: width + 0.24 }, scene);
    rail.position = new Vector3(x + facing * 0.05, y, centreZ);
    rail.material = timber;
    rail.isPickable = false;
    rail.parent = parent;
    parts.push(rail);
  }
  return parts;
}

/**
 * The hanji sign board: vertical Korean, roman subtitle, and the chamber number
 * inside a red nakgwan seal. Drawn on a scratch canvas because Babylon's own
 * 2D context has no text API worth the name, then blitted with the Y flip the
 * texture pipeline needs.
 */
export function buildSignBoard(
  scene: Scene,
  name: string,
  title: string,
  roman: string,
  number: string,
): StandardMaterial {
  const width = 512;
  const height = 1024;
  const context = scratchContext(width, height);

  // Paper.
  context.fillStyle = "#e8d9b8";
  context.fillRect(0, 0, width, height);
  const random = seededRandom(4821);
  for (let index = 0; index < 900; index += 1) {
    const x = random() * width;
    const y = random() * height;
    const length = 3 + random() * 16;
    const angle = random() * Math.PI;
    context.strokeStyle = `rgba(${188 + random() * 50}, ${168 + random() * 44}, ${128 + random() * 40}, ${0.08 + random() * 0.2})`;
    context.lineWidth = 0.6 + random() * 1.2;
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(x + Math.cos(angle) * length, y + Math.sin(angle) * length);
    context.stroke();
  }
  // Ink border, brushed rather than ruled.
  context.strokeStyle = "rgba(28, 22, 16, 0.5)";
  context.lineWidth = 6;
  context.strokeRect(26, 26, width - 52, height - 52);

  // Vertical Korean title, centre column, read top to bottom.
  context.fillStyle = "#221a12";
  context.textAlign = "center";
  context.textBaseline = "middle";
  // Spaces are word breaks in the horizontal name, not characters in the
  // column — laid out as glyphs they each ate a full slot, which pushed 「두 번째
  // 나」 into the seal and 「몸이 아니라 손」 clean off the bottom of the board.
  // The pitch then closes up to whatever fits above the seal, so a room can be
  // named without anyone checking the length against a magic number.
  const glyphs = [...title].filter((glyph) => glyph.trim() !== "");
  const startY = 190;
  const columnEnd = height - 304;
  const pitch = Math.min(144, (columnEnd - startY) / Math.max(1, glyphs.length - 1));
  const glyphSize = Math.min(118, pitch - 26);
  for (const [index, glyph] of glyphs.entries()) {
    context.font = `600 ${glyphSize}px "Apple SD Gothic Neo", "Noto Sans KR", sans-serif`;
    context.fillText(glyph, width / 2 + 22, startY + index * pitch);
  }
  // Roman subtitle, small, running up the left edge.
  context.save();
  context.translate(96, height - 210);
  context.rotate(-Math.PI / 2);
  context.font = '400 40px "Helvetica Neue", Helvetica, Arial, sans-serif';
  context.fillStyle = "rgba(52, 42, 32, 0.8)";
  context.textAlign = "left";
  context.fillText(roman.toUpperCase(), 0, 0);
  context.restore();

  // Nakgwan: a carved seal, number inside. The one red in the room.
  const sealSize = 132;
  const sealX = width / 2 + 22;
  const sealY = height - 190;
  context.fillStyle = "#b83b2e";
  context.fillRect(sealX - sealSize / 2, sealY - sealSize / 2, sealSize, sealSize);
  // Ink is never solid: bite the edges so the stamp reads as pressed, not printed.
  for (let index = 0; index < 260; index += 1) {
    const x = sealX - sealSize / 2 + random() * sealSize;
    const y = sealY - sealSize / 2 + random() * sealSize;
    const edge = Math.min(
      x - (sealX - sealSize / 2),
      sealX + sealSize / 2 - x,
      y - (sealY - sealSize / 2),
      sealY + sealSize / 2 - y,
    );
    if (edge > 12 && random() > 0.25) continue;
    context.fillStyle = `rgba(232, 217, 184, ${0.25 + random() * 0.6})`;
    context.fillRect(x, y, 1 + random() * 4, 1 + random() * 4);
  }
  context.fillStyle = "#f0e2c4";
  context.font = '700 74px "Apple SD Gothic Neo", "Noto Sans KR", sans-serif';
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(number, sealX, sealY + 4);

  const texture = new DynamicTexture(name, { width, height }, scene, true);
  const target = texture.getContext();
  target.save();
  target.translate(0, height);
  target.scale(1, -1);
  target.drawImage(context.canvas, 0, 0);
  target.restore();
  texture.update(false);

  const surface = new StandardMaterial(`${name}-material`, scene);
  surface.diffuseColor = new Color3(0.9, 0.86, 0.78);
  surface.ambientColor = Color3.White();
  surface.specularColor = Color3.Black();
  surface.diffuseTexture = texture;
  surface.emissiveTexture = texture;
  surface.emissiveColor = new Color3(0.16, 0.14, 0.11);
  return surface;
}
