const DisplayLevels = ['None', 'OverlayRects', 'OverlayCircles', 'ApproximationCircles'] as const;

export type DisplayLevel = typeof DisplayLevels[number];

export interface IsochronesPos {
	lat: number;
	lng: number;
	seconds: number;
}


export const nextDisplayLevel = (a: DisplayLevel) => DisplayLevels[Math.min(DisplayLevels.indexOf(a) + 1, DisplayLevels.length - 1)];
export const isLess = (a: DisplayLevel, b: DisplayLevel) => DisplayLevels.indexOf(a) < DisplayLevels.indexOf(b);
export const minDisplayLevel = (a: DisplayLevel, b: DisplayLevel) => isLess(a, b) ? a : b;

export const isCanvasLevel = (a: DisplayLevel) => a == 'OverlayRects' || a == 'OverlayCircles';
export const isGeoJSONLevel = (a: DisplayLevel) => a == 'ApproximationCircles';
