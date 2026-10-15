/**
 * The ground layer the match stands on. One implementation today: the
 * Sunnyside World tileset drawn at a fixed 3x integer scale. Everything above
 * the ground (sprites, telegraphs, lighting) only talks to this interface.
 */
import type { View } from '../render/view';

export type Biome = 'meadow' | 'forest' | 'shore' | 'water';
export const BIOMES: readonly Biome[] = ['meadow', 'forest', 'shore', 'water'];

export interface DecorItem {
  kind: 'tree' | 'rock' | 'bush' | 'flower' | 'mushroom' | 'building' | 'prop';
  /** Base point in tiles (the item's ground contact, used for depth sorting). */
  x: number;
  y: number;
  /** Source image: a baked canvas or a strip; `frames` > 1 animates left to right. */
  image: CanvasImageSource;
  frameW: number;
  frameH: number;
  frames: number;
  fps: number;
  /** Anchor inside a frame, in source pixels. */
  anchorX: number;
  anchorY: number;
  /** Blocking radius in tiles (0 = decorative only). */
  blockRadius: number;
  /** Depth used for sorting when it differs from the anchor's y (tall objects, windmill sails). */
  sortY?: number;
  /** Drawn mirrored left to right. */
  flip?: boolean;
  /** Frame offset so neighbouring animated items do not move in lockstep. */
  phase?: number;
  /** How far (in tiles) the picture reaches from its anchor, for view culling. */
  extent?: number;
}

export interface GroundRenderer {
  readonly cols: number;
  readonly rows: number;
  /** Source pixels per tile (16 for Sunnyside). */
  readonly tileSize: number;
  /** Shown in the HUD footer. */
  readonly label: string;
  readonly decor: DecorItem[];
  /** Points of interest the generator laid trails between. */
  readonly outposts: Array<{ x: number; y: number }>;
  readonly spawns: Array<{ x: number; y: number }>;
  biomeAt(tx: number, ty: number): Biome;
  /** True when a character may stand on the tile (terrain only; decor is checked separately). */
  walkable(tx: number, ty: number): boolean;
  /** Sea, lake or river at this tile (Dive Ball targets). */
  inWater(tx: number, ty: number): boolean;
  /** Reachable from the map centre on foot (spawn points use this). */
  reachable(tx: number, ty: number): boolean;
  /** On a ladder (characters climb it facing the cliff). */
  onLadder?(tx: number, ty: number): boolean;
  /** Under the forest canopy (characters there are drawn faded). */
  underCanopy(x: number, y: number): boolean;
  minimapColor(tx: number, ty: number): string;
  /** Advances tile and decor animations. */
  update(dt: number): void;
  drawGround(view: View): void;
  /** The canopy layer, drawn after characters. */
  drawCanopy(view: View): void;
}
