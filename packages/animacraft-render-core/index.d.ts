export const MAKER_V8_BLEND_MODES: readonly ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten',
  'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation',
  'color', 'luminosity', 'linear-dodge'];
export type MakerV8BlendMode = typeof MAKER_V8_BLEND_MODES[number];
export const MAKER_V8_BLEND_CODES: Readonly<Record<MakerV8BlendMode, number>>;
export const MAKER_V8_CANVAS_BLEND_MODES: Readonly<Record<MakerV8BlendMode, GlobalCompositeOperation>>;
export type RenderSwatch = {
  key: string;
  rgba: string;
  stops: Array<{ offset: number; rgba: string }>;
};
export type RenderAssetEvidence = {
  assetId: string;
  blobId?: string;
  sha256: string;
  byteLength: number;
  mediaType: string;
};
export type LoadedRenderAsset = RenderAssetEvidence & { bytesBase64: string };
export type RenderSourceAsset = { sha256: string; mediaType: string; byteLength: number };
export function isMakerV8SourceAsset(value: unknown): value is RenderSourceAsset;
export type ResolvedMakerV8Layer = {
  selectionIndex: number;
  selection: { source: 'BASE' | 'PACK' | 'EXTERNAL'; partKey: string; itemKey: string; styleKey: string;
    [key: string]: unknown };
  asset: RenderAssetEvidence;
  transform: { x: number; y: number; scale: number; rotation: number };
  blendMode: MakerV8BlendMode;
  opacity: number;
  displayOrder: number;
  trackOrder: number;
  swatch: RenderSwatch | null;
  protected: boolean;
  sourceAsset?: RenderSourceAsset | null;
};
export type RenderCanvasFactory = () => HTMLCanvasElement | OffscreenCanvas;
export type RenderImage = { source: CanvasImageSource; close?: () => void };
export type MakerV8PngRender = Readonly<{
  schemaVersion: 'animacraft.maker-v8-player-render.v1';
  mediaType: 'image/png';
  width: number;
  height: number;
  bytesBase64: string;
  byteLength: number;
  sha256: string;
}>;
export type ResolvedMakerV8RenderOptions = {
  document: { canvas: { width: number; height: number; pixelMode: 'smooth' | 'pixelated' } };
  layers: ResolvedMakerV8Layer[];
  exportSizeMode?: 'standard' | 'original' | null;
  loadAsset: (asset: RenderAssetEvidence) => Promise<LoadedRenderAsset>;
  canvasFactory?: RenderCanvasFactory;
  decodeImage?: (bytes: Uint8Array, mediaType: string) => Promise<RenderImage>;
  colorizeImage?: typeof colorizeMakerV8ImageSourceV8;
  decryptProtectedSelection?: null | ((input: { selectionIndex: number; ciphertext: LoadedRenderAsset }) => Promise<{
    selectionIndex: number; bytesBase64: string; byteLength: number;
  }>);
};
export class MakerV8PlayerJourneyError extends Error {
  constructor(code: string, message: string, layer?: string, details?: Record<string, unknown>);
  code: string;
  layer: string;
  details: Readonly<Record<string, unknown>>;
}
export function renderResolvedMakerV8RecipePngV8(options?: ResolvedMakerV8RenderOptions): Promise<MakerV8PngRender>;
export const MAKER_V8_STANDARD_EXPORT_MAX_EDGE: 1024;
export const MAKER_V8_ORIGINAL_EXPORT_MAX_PIXELS: 8388608;
export function makerV8ExportSizes(canvas: { width: number; height: number }): Readonly<{
  original: Readonly<{ width: number; height: number }>;
  standard: Readonly<{ width: number; height: number }>;
  originalSafe: boolean;
}>;
export function exactMakerV8ExportOptions(canvas: { width: number; height: number },
  options: { sizeMode: 'standard' | 'original'; transparent?: boolean }): Readonly<{
    sizeMode: 'standard' | 'original'; transparent: boolean;
  }>;
export function mapMakerV8SmartColorPixelsV8(imageData: { width: number; height: number; data: Uint8ClampedArray },
  swatch: RenderSwatch): { width: number; height: number; data: Uint8ClampedArray };
export function colorizeMakerV8ImageSourceV8(options?: {
  source: CanvasImageSource;
  swatch: RenderSwatch;
  canvasFactory?: RenderCanvasFactory;
}): Promise<RenderImage>;
