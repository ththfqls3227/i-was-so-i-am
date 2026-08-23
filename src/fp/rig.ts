import type { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";

/**
 * A body, not a capsule. The whole promise of the game is that you watch
 * yourself walk past — so the echo needs hips that swing and a head that rides
 * the stride, or it reads as a floating marker instead of a person.
 */
export interface Humanoid {
  root: TransformNode;
  body: TransformNode;
  parts: Mesh[];
  hips: [TransformNode, TransformNode];
  knees: [TransformNode, TransformNode];
  shoulders: [TransformNode, TransformNode];
  elbows: [TransformNode, TransformNode];
  head: TransformNode;
  torso: TransformNode;
}

const HIP_HEIGHT = 0.92;
const SHOULDER_HEIGHT = 1.46;

function joint(scene: Scene, name: string, parent: TransformNode, position: Vector3): TransformNode {
  const node = new TransformNode(name, scene);
  node.parent = parent;
  node.position = position;
  return node;
}

function limb(
  scene: Scene,
  name: string,
  parent: TransformNode,
  length: number,
  radius: number,
  material: StandardMaterial,
  parts: Mesh[],
): Mesh {
  const mesh = MeshBuilder.CreateCapsule(name, { height: length, radius, tessellation: 12, subdivisions: 1 }, scene);
  mesh.parent = parent;
  // Hangs from the joint it is parented to, so rotating the joint swings it.
  mesh.position = new Vector3(0, -length / 2, 0);
  mesh.material = material;
  mesh.isPickable = false;
  parts.push(mesh);
  return mesh;
}

export function createHumanoid(scene: Scene, name: string, material: StandardMaterial): Humanoid {
  const root = new TransformNode(`${name}-root`, scene);
  const body = new TransformNode(`${name}-body`, scene);
  body.parent = root;
  const parts: Mesh[] = [];

  const pelvis = MeshBuilder.CreateBox(`${name}-pelvis`, { width: 0.3, height: 0.19, depth: 0.21 }, scene);
  pelvis.parent = body;
  pelvis.position = new Vector3(0, HIP_HEIGHT + 0.05, 0);
  pelvis.material = material;
  pelvis.isPickable = false;
  parts.push(pelvis);

  const torso = joint(scene, `${name}-torso`, body, new Vector3(0, HIP_HEIGHT + 0.12, 0));
  const chest = MeshBuilder.CreateBox(`${name}-chest`, { width: 0.41, height: 0.5, depth: 0.23 }, scene);
  chest.parent = torso;
  chest.position = new Vector3(0, 0.25, 0);
  chest.material = material;
  chest.isPickable = false;
  parts.push(chest);

  const head = joint(scene, `${name}-neck`, torso, new Vector3(0, 0.52, 0));
  const skull = MeshBuilder.CreateSphere(`${name}-head`, { diameter: 0.235, segments: 10 }, scene);
  skull.parent = head;
  skull.position = new Vector3(0, 0.12, 0.01);
  skull.scaling = new Vector3(0.92, 1.14, 1);
  skull.material = material;
  skull.isPickable = false;
  parts.push(skull);

  const hips: TransformNode[] = [];
  const knees: TransformNode[] = [];
  const shoulders: TransformNode[] = [];
  const elbows: TransformNode[] = [];

  for (const side of [-1, 1] as const) {
    const label = side < 0 ? "left" : "right";
    const hip = joint(scene, `${name}-hip-${label}`, body, new Vector3(side * 0.104, HIP_HEIGHT, 0));
    limb(scene, `${name}-thigh-${label}`, hip, 0.44, 0.086, material, parts);
    const knee = joint(scene, `${name}-knee-${label}`, hip, new Vector3(0, -0.44, 0));
    limb(scene, `${name}-shin-${label}`, knee, 0.44, 0.07, material, parts);
    const foot = MeshBuilder.CreateBox(`${name}-foot-${label}`, { width: 0.12, height: 0.075, depth: 0.26 }, scene);
    foot.parent = knee;
    foot.position = new Vector3(0, -0.43, 0.06);
    foot.material = material;
    foot.isPickable = false;
    parts.push(foot);
    hips.push(hip);
    knees.push(knee);

    const shoulder = joint(scene, `${name}-shoulder-${label}`, torso, new Vector3(side * 0.235, SHOULDER_HEIGHT - HIP_HEIGHT - 0.12, 0));
    limb(scene, `${name}-upper-arm-${label}`, shoulder, 0.3, 0.056, material, parts);
    const elbow = joint(scene, `${name}-elbow-${label}`, shoulder, new Vector3(0, -0.3, 0));
    limb(scene, `${name}-forearm-${label}`, elbow, 0.29, 0.05, material, parts);
    shoulders.push(shoulder);
    elbows.push(elbow);
  }

  return {
    root,
    body,
    parts,
    hips: [hips[0] ?? torso, hips[1] ?? torso],
    knees: [knees[0] ?? torso, knees[1] ?? torso],
    shoulders: [shoulders[0] ?? torso, shoulders[1] ?? torso],
    elbows: [elbows[0] ?? torso, elbows[1] ?? torso],
    head,
    torso,
  };
}

export interface Pose {
  /** Horizontal speed in m/s; drives how much of the walk cycle is applied. */
  speed: number;
  /** Stride phase in radians, advanced by distance travelled rather than time. */
  phase: number;
  grounded: boolean;
  /** Seconds, for the idle breath. Render-only, never fed back to the tick. */
  clock: number;
  /**
   * Something the right hand is holding: yaw is the target's bearing relative
   * to the body's facing, pitch is up toward it from the shoulder. While set,
   * that arm leaves the stride and stays on the grip — a figure whose tape is
   * holding a door open used to swing both arms as if carrying nothing, and
   * the owner asked, fairly, what the hand was supposed to be doing.
   */
  reach?: { yaw: number; pitch: number } | null;
}

/**
 * Apply a stride. Phase comes from distance covered, so the feet never skate:
 * standing still freezes the cycle, and walking at half speed halves the
 * cadence rather than the stride length.
 */
export function poseHumanoid(rig: Humanoid, pose: Pose): void {
  const gait = Math.min(1, pose.speed / 3.6);
  const swing = Math.sin(pose.phase);
  const lift = Math.sin(pose.phase + 0.85);
  const breath = Math.sin(pose.clock * 1.6) * 0.012;

  if (pose.grounded) {
    rig.hips[0].rotation.x = swing * 0.62 * gait;
    rig.hips[1].rotation.x = -swing * 0.62 * gait;
    rig.knees[0].rotation.x = Math.max(0, -lift) * 0.95 * gait;
    rig.knees[1].rotation.x = Math.max(0, lift) * 0.95 * gait;
    rig.shoulders[0].rotation.x = -swing * 0.5 * gait;
    rig.shoulders[1].rotation.x = swing * 0.5 * gait;
    rig.elbows[0].rotation.x = -0.18 - Math.max(0, -swing) * 0.5 * gait;
    rig.elbows[1].rotation.x = -0.18 - Math.max(0, swing) * 0.5 * gait;
    rig.body.position.y = -Math.abs(swing) * 0.032 * gait + breath;
    rig.torso.rotation.y = -swing * 0.09 * gait;
    rig.torso.rotation.x = 0.04 + gait * 0.05;
  } else {
    // Airborne: legs tuck and arms come up. Reads as a jump from any angle.
    rig.hips[0].rotation.x = -0.5;
    rig.hips[1].rotation.x = -0.24;
    rig.knees[0].rotation.x = 0.85;
    rig.knees[1].rotation.x = 0.45;
    rig.shoulders[0].rotation.x = -0.6;
    rig.shoulders[1].rotation.x = -0.6;
    rig.elbows[0].rotation.x = -0.7;
    rig.elbows[1].rotation.x = -0.7;
    rig.body.position.y = breath;
    rig.torso.rotation.y = 0;
    rig.torso.rotation.x = 0.1;
  }
  // Both cases write the shoulder's yaw, so a finished reach never leaves a
  // stale twist behind on the next stride.
  rig.shoulders[1].rotation.y = 0;
  if (pose.reach) {
    rig.shoulders[1].rotation.x = -(Math.PI / 2) - pose.reach.pitch;
    rig.shoulders[1].rotation.y = pose.reach.yaw;
    rig.elbows[1].rotation.x = -0.08;
    rig.torso.rotation.y += pose.reach.yaw * 0.2;
  }
  rig.head.rotation.x = -rig.torso.rotation.x * 0.7;
}
