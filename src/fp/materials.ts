import { FresnelParameters } from "@babylonjs/core/Materials/fresnelParameters";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Scene } from "@babylonjs/core/scene";

/** Deterministic noise so a rebuild produces the same wall, not a new one. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/**
 * A real 2D context. Babylon's own `ICanvasRenderingContext` omits half the
 * text API, so anything that draws type composes here and is blitted in.
 */
export function scratchContext(width: number, height: number): CanvasRenderingContext2D {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("2D canvas context unavailable");
  return context;
}

/**
 * Sobel a greyscale heightmap into a tangent-space normal map. The panels are
 * procedural, so their relief has to be derived rather than authored — this is
 * what gives a seam a lit edge instead of a painted-on line, and at first-person
 * range that difference is the whole reason the wall reads as a surface.
 */
function normalFromHeight(
  scene: Scene,
  name: string,
  height: Uint8ClampedArray,
  size: number,
  strength: number,
): DynamicTexture {
  const scratch = scratchContext(size, size);
  const image = scratch.createImageData(size, size);
  const at = (x: number, y: number): number => {
    const wrappedX = (x + size) % size;
    const wrappedY = (y + size) % size;
    return height[(wrappedY * size + wrappedX) * 4] ?? 0;
  };
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx =
        at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1) -
        (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1));
      const dy =
        at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1) -
        (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1));
      let nx = (dx / 1020) * strength;
      let ny = (dy / 1020) * strength;
      const length = Math.sqrt(nx * nx + ny * ny + 1);
      nx /= length;
      ny /= length;
      const offset = (y * size + x) * 4;
      image.data[offset] = (nx * 0.5 + 0.5) * 255;
      image.data[offset + 1] = (ny * 0.5 + 0.5) * 255;
      image.data[offset + 2] = ((1 / length) * 0.5 + 0.5) * 255;
      image.data[offset + 3] = 255;
    }
  }
  scratch.putImageData(image, 0, 0);
  const texture = new DynamicTexture(name, { width: size, height: size }, scene, false);
  texture.getContext().drawImage(scratch.canvas, 0, 0);
  texture.update(false);
  texture.wrapU = Texture.WRAP_ADDRESSMODE;
  texture.wrapV = Texture.WRAP_ADDRESSMODE;
  return texture;
}

export interface PanelOptions {
  /** Panel modules across one texture tile. Tiling is baked into mesh UVs, not here. */
  columns: number;
  rows: number;
  base: string;
  seam: string;
  bevel: number;
  seed: number;
  tint?: Color3;
}

/**
 * Machined wall panelling: flat modules separated by a recessed seam, with a
 * chamfer catching the light on the top and left edge of each one.
 *
 * The seam is the whole design. An earlier pass shaded each panel from its
 * corners inward, which at first-person range turned a test chamber into quilted
 * upholstery — the blobs read louder than the geometry. Panels are flat now, and
 * everything that says "surface" happens in the few pixels either side of a
 * join.
 */
export function panelMaterial(scene: Scene, name: string, options: PanelOptions): StandardMaterial {
  const size = 1024;
  const { columns, rows, base, seam, bevel, seed } = options;
  const panelWidth = size / columns;
  const panelHeight = size / rows;
  const gap = Math.max(6, bevel * 1.6);
  const random = seededRandom(seed);
  const albedo = new DynamicTexture(`${name}-albedo`, { width: size, height: size }, scene, false);
  const context = albedo.getContext();
  const height = scratchContext(size, size);

  context.fillStyle = seam;
  context.fillRect(0, 0, size, size);
  height.fillStyle = "rgb(60, 60, 60)";
  height.fillRect(0, 0, size, size);

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const x = column * panelWidth + gap / 2;
      const y = row * panelHeight + gap / 2;
      const width = panelWidth - gap;
      const depth = panelHeight - gap;

      context.fillStyle = base;
      context.fillRect(x, y, width, depth);
      // Manufactured, not machined: neighbouring panels differ by a percent or
      // two, which is enough to break the tile without drawing attention.
      context.fillStyle = `rgba(22, 24, 28, ${0.012 + random() * 0.03})`;
      context.fillRect(x, y, width, depth);
      // A single soft vertical falloff, far weaker than a light gradient, so the
      // panel has a direction without having a shape.
      const wash = context.createLinearGradient(0, y, 0, y + depth);
      wash.addColorStop(0, "rgba(255, 255, 255, 0.035)");
      wash.addColorStop(1, "rgba(20, 22, 26, 0.05)");
      context.fillStyle = wash;
      context.fillRect(x, y, width, depth);

      // Chamfer, in ink: lit on the top and left, shaded on the bottom and right.
      context.fillStyle = "rgba(255, 255, 255, 0.30)";
      context.fillRect(x, y, width, 1.5);
      context.fillRect(x, y, 1.5, depth);
      context.fillStyle = "rgba(18, 20, 24, 0.26)";
      context.fillRect(x, y + depth - 1.5, width, 1.5);
      context.fillRect(x + width - 1.5, y, 1.5, depth);

      height.fillStyle = "rgb(205, 205, 205)";
      height.fillRect(x, y, width, depth);
      const lip = Math.max(2, Math.round(bevel * 0.6));
      height.fillStyle = "rgb(160, 160, 160)";
      height.fillRect(x, y + depth - lip, width, lip);
      height.fillRect(x + width - lip, y, lip, depth);
      height.fillStyle = "rgb(240, 240, 240)";
      height.fillRect(x, y, width, lip);
      height.fillRect(x, y, lip, depth);

      // Two fasteners on the diagonal read as assembly without adding noise.
      for (const [fx, fy] of [
        [x + 22, y + 22],
        [x + width - 22, y + depth - 22],
      ] as const) {
        context.fillStyle = "rgba(96, 99, 104, 0.34)";
        context.beginPath();
        context.arc(fx, fy, 3.4, 0, Math.PI * 2);
        context.fill();
        height.fillStyle = "rgb(178, 178, 178)";
        height.beginPath();
        height.arc(fx, fy, 3.4, 0, Math.PI * 2);
        height.fill();
      }
    }
  }

  // Faint grain keeps it from looking like untextured plastic up close.
  for (let index = 0; index < 2200; index += 1) {
    const grain = random() > 0.5 ? 255 : 90;
    context.fillStyle = `rgba(${grain}, ${grain}, ${grain}, ${0.008 + random() * 0.016})`;
    context.fillRect(random() * size, random() * size, 1 + random() * 2, 1 + random() * 2);
  }

  albedo.wrapU = Texture.WRAP_ADDRESSMODE;
  albedo.wrapV = Texture.WRAP_ADDRESSMODE;
  albedo.update(false);

  const surface = new StandardMaterial(name, scene);
  surface.diffuseColor = options.tint ?? new Color3(0.8, 0.8, 0.82);
  surface.ambientColor = Color3.White();
  surface.emissiveColor = Color3.Black();
  surface.specularColor = new Color3(0.09, 0.09, 0.1);
  surface.specularPower = 96;
  surface.diffuseTexture = albedo;
  surface.bumpTexture = normalFromHeight(
    scene,
    `${name}-normal`,
    height.getImageData(0, 0, size, size).data,
    size,
    1.6,
  );
  surface.bumpTexture.wrapU = Texture.WRAP_ADDRESSMODE;
  surface.bumpTexture.wrapV = Texture.WRAP_ADDRESSMODE;
  return surface;
}

/** Flat matte for the dark mechanism zones — the only value break in a white room. */
export function matteMaterial(scene: Scene, name: string, colour: Color3): StandardMaterial {
  const surface = new StandardMaterial(name, scene);
  surface.diffuseColor = colour;
  surface.ambientColor = Color3.White();
  surface.specularColor = new Color3(0.04, 0.04, 0.05);
  surface.specularPower = 32;
  return surface;
}

/** Self-lit signal surfaces: light strips, the plate ring, the exit. */
export function signalMaterial(scene: Scene, name: string, colour: Color3, alpha = 1): StandardMaterial {
  const surface = new StandardMaterial(name, scene);
  surface.diffuseColor = Color3.Black();
  surface.emissiveColor = colour;
  surface.specularColor = Color3.Black();
  surface.ambientColor = Color3.Black();
  surface.disableLighting = true;
  surface.alpha = alpha;
  if (alpha < 1) surface.backFaceCulling = false;
  return surface;
}

export const ECHO_ALPHA = 0.46;

/**
 * The echo.
 *
 * Additive was the right answer against a dark vault and the wrong one in a
 * white room — adding light to white returns white and the ghost disappears. It
 * is alpha-blended, and a Fresnel rim does the work additive used to: the
 * silhouette stays bright while the body reads as translucent volume, which
 * holds against both the panels and the dark mechanism zones.
 *
 * The depth pre-pass is off deliberately. Turning it on for a translucent mesh
 * is the usual fix for self-overlap, and here it renders the whole ghost as a
 * black silhouette.
 */
export function echoMaterial(scene: Scene, name: string, alpha = ECHO_ALPHA, rim = 1): StandardMaterial {
  const ramp = new DynamicTexture(`${name}-ramp`, { width: 8, height: 256 }, scene, false);
  const context = ramp.getContext();
  const gradient = context.createLinearGradient(0, 0, 0, 256);
  gradient.addColorStop(0, "#b6f0ff");
  gradient.addColorStop(0.24, "#59c6f0");
  gradient.addColorStop(0.6, "#248fc4");
  gradient.addColorStop(1, "#0d4f72");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 8, 256);
  const random = seededRandom(20260821);
  for (let index = 0; index < 26; index += 1) {
    const y = random() * 256;
    context.fillStyle = `rgba(198, 244, 255, ${0.05 + random() * 0.11})`;
    context.fillRect(0, y, 8, 1 + random() * 2);
  }
  ramp.update(false);
  ramp.wrapV = Texture.WRAP_ADDRESSMODE;

  const surface = new StandardMaterial(name, scene);
  surface.diffuseColor = new Color3(0.03, 0.28, 0.4);
  // Tinted rather than white. A white multiplier over the ramp washed the body
  // out to a pale blob against pale panels; keeping the multiplier cyan means
  // the ghost holds its colour and the rim alone carries the brightness.
  surface.emissiveColor = new Color3(0.42, 0.86, 1);
  surface.emissiveTexture = ramp;
  surface.specularColor = Color3.Black();
  surface.ambientColor = Color3.Black();
  surface.disableLighting = true;
  surface.alpha = alpha;
  surface.needDepthPrePass = false;
  surface.backFaceCulling = true;

  const edge = new FresnelParameters();
  edge.bias = 0.14;
  edge.power = 2.1;
  edge.leftColor = new Color3(rim * 1.25, rim * 1.25, rim * 1.25);
  edge.rightColor = new Color3(rim * 0.26, rim * 0.3, rim * 0.34);
  surface.emissiveFresnelParameters = edge;
  return surface;
}
