import type { Feature, GeoJsonProperties, MultiPolygon, Polygon } from 'geojson';

const DisplayLevels = ['NONE', 'OVERLAY_RECTS', 'OVERLAY_CIRCLES', 'GEOMETRY_CIRCLES'] as const;
const StatusLevels = ['WORKING', 'DONE', 'EMPTY', 'FAILED'] as const;

export type DisplayLevel = (typeof DisplayLevels)[number];
export type StatusLevel = (typeof StatusLevels)[number];
export type Geometry = Feature<Polygon | MultiPolygon, GeoJsonProperties>;

export interface IsochronesOptions {
	displayLevel: DisplayLevel;
	color: string;
	opacity: number;
	status: StatusLevel;
}
export interface IsochronesPos {
	lat: number;
	lng: number;
	seconds: number;
}

export const isLess = (a: DisplayLevel, b: DisplayLevel) =>
	DisplayLevels.indexOf(a) < DisplayLevels.indexOf(b);
export const minDisplayLevel = (a: DisplayLevel, b: DisplayLevel) => (isLess(a, b) ? a : b);

export const isCanvasLevel = (a: DisplayLevel) => a == 'OVERLAY_RECTS' || a == 'OVERLAY_CIRCLES';
