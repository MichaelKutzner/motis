const DisplayLevels = ['None', 'OverlayRects', 'OverlayCircles', 'ApproximationCircles'] as const;
export type DisplayLevel = typeof DisplayLevels[number];
export const nextDisplayLevel = (a: DisplayLevel) => DisplayLevels[Math.min(DisplayLevels.indexOf(a) + 1, DisplayLevels.length - 1)];
export const isLess = (a: DisplayLevel, b: DisplayLevel) => DisplayLevels.indexOf(a) < DisplayLevels.indexOf(b);
