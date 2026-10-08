import * as THREE from 'three';

/** Street cross-section, world units (1 unit = one rider voxel). */
export const ROAD_HALF = 44;
export const CELL = 2;
/** lot cells outward from the curb, along the street, and up */
export const LOT_NA = 84;
export const LOT_NB = 64;
export const LOT_NY = 58;
export const LOT_W = LOT_NB * CELL;
export const SIDEWALK_TOP = 2;

export type ColliderKind =
  | 'solid' // can be jumped over, never landed on
  | 'walk' // can be landed on and ridden across (benches, walls, planters)
  | 'ramp'; // walkable, height rises along -z

export interface Collider {
  x0: number; x1: number; z0: number; z1: number;
  top: number;
  kind: ColliderKind;
  /** ramp: height at z1 (near end) and at z0 (far end, forward) */
  rampFrom?: number;
  rampTo?: number;
  tag?: string;
}

export type TargetKind = 'mailbox' | 'door' | 'window' | 'bullseye';

export interface Target {
  kind: TargetKind;
  house?: number;
  box: THREE.Box3;
  hit?: boolean;
  /** window glass world rect for the crack overlay */
  face?: { x: number; side: number; z0: number; z1: number; y0: number; y1: number };
}

export type SpawnType =
  | 'dog' | 'cat' | 'mower' | 'birds' | 'bundle' | 'parkedCar' | 'trash' | 'ducks' | 'cone' | 'mailbox' | 'geese' | 'squirrel';

export interface Spawn {
  type: SpawnType;
  x: number;
  z: number;
  /** behaviour region, world AABB on the ground */
  area?: { x0: number; x1: number; z0: number; z1: number };
  side?: number;
  house?: number;
  variant?: number;
  y?: number;
  heading?: number;
  fenced?: boolean;
  perch?: string;
}

export interface HouseInfo {
  id: number;
  side: number;
  /** mailbox world position */
  mailbox: THREE.Vector3;
  zMid: number;
  style: string;
  color: number;
  district: string;
}

export interface Built {
  group: THREE.Object3D;
  colliders: Collider[];
  targets: Target[];
  spawns: Spawn[];
}

export interface Piece {
  /** near end (larger z) and far end (smaller z) */
  zNear: number;
  zFar: number;
  kind: 'lot' | 'start' | 'cross' | 'park' | 'construction' | 'finish' | 'street';
  district: string;
  build(day: number): Built;
  built?: Built;
  /** whether the road surface here spans every x (cross streets) */
  openRoad?: boolean;
}
