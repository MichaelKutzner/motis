import circle from '@turf/circle';
import { LngLatBounds } from 'maplibre-gl';
import type { DisplayLevel,Geometry } from '$lib/map/IsochronesShared';
import ShapeWorker from '$lib/map/IsochronesShapeWorker.ts?worker';
import type { ShapeMessage, UpdateMessage } from './IsochronesShapeWorker';

export type WorkerMessage = {method: 'update-render-level', level: DisplayLevel, geometry?: Geometry | undefined, index: number};

let canvas: OffscreenCanvas | undefined = undefined;

let dataIndex = 0;
let boxes: LngLatBounds[] | undefined = undefined;
let circles: CircleType[] | undefined = undefined;
let shapeWorker: Worker | undefined = undefined;

type CircleType = ReturnType<typeof circle>;

self.onmessage = async function(event) {
	const method = event.data.method;
	if (method == 'set-canvas') {
		canvas = event.data.canvas;
	} else if (method == 'update-data') {
		const isochronesData = event.data.data;
		const maxDuration = event.data.maxDuration;
		const kilometersPerSecond = event.data.kilometersPerSecond;
		const index = event.data.index;
		dataIndex = index;
		boxes = undefined;
		circles = undefined;
		let worker = setupWorker(true);
		worker.postMessage({
			method: 'set-data',
			data: isochronesData,
			speed:kilometersPerSecond,
			maxDuration:maxDuration,
			index: dataIndex,
		});
	} else if (method == 'set-render-depth') {
		const depth: DisplayLevel = event.data.maxRenderLevel;
		if (dataIndex > 0) {
			let worker = setupWorker(false);
			worker.postMessage({method: 'update-depth', depth});
		}
	} else if (method == 'render-canvas') {
		if (!canvas) {
			return;
		}
		const boundingBox = event.data.boundingBox;
		const color = event.data.color;
		const dimensions = event.data.dimensions;
		const level: DisplayLevel = event.data.level;
		canvas.width = dimensions[0];
		canvas.height = dimensions[1];
		let ctx = canvas.getContext("2d");
		if (!ctx) {
			return;
		}

		const transform = getTransformer(boundingBox, dimensions);

		ctx.fillStyle = color;
		ctx.clearRect(0, 0, dimensions[0], dimensions[1]);

		if (level == 'OVERLAY_CIRCLES' && circles) {
			const isVisible = getIsVisible(boundingBox);
			drawCircles(ctx, circles, transform, isVisible, dimensions);
		} else if (level == 'OVERLAY_RECTS' && boxes) {
			drawRects(ctx, boxes, transform);
		} else {
			console.log(`Cannot render level ${level}`);
		}
	}
}

function getTransformer(boundingBox: LngLatBounds, dimensions: number[]) {
	return (pos: number[]) => {
		const x = Math.round(
			((pos[0] - boundingBox._sw.lng) / (boundingBox._ne.lng - boundingBox._sw.lng)) * dimensions[0]
		);
		const y = Math.round(
			((boundingBox._ne.lat - pos[1]) / (boundingBox._ne.lat - boundingBox._sw.lat)) * dimensions[1]
		);
		return [x, y];
	};
}

function getIsVisible(boundingBox: LngLatBounds) {
	return (circle: CircleType) => {
		if (!circle.bbox) {
			return false;
		}
		const b = circle.bbox; // [minX, minY, maxX, maxY]
		return (
			boundingBox._sw.lat <= b[3] &&
			b[1] <= boundingBox._ne.lat &&
			boundingBox._sw.lng <= b[2] &&
			b[0] <= boundingBox._ne.lat
		);
	}
}

async function drawCircles(ctx: OffscreenCanvasRenderingContext2D, circles: CircleType[], transform: (p: number[]) => number[], is_visible: (c: CircleType) => boolean, dimensions: number[]) {
	circles.filter(is_visible).forEach((c) => {
		ctx.save(); // Store canvas state

		const b = c.bbox!; // Existence checked in filter()
		const min = transform([b[0], b[1]]);
		const max = transform([b[2], b[3]]);
		const diff_x = max[0] - min[0];
		const diff_y = max[1] - min[1];

		if (diff_x < 2 && diff_y < 2) {
			// Draw small rect
			ctx.fillRect(min[0], min[1], diff_x + 1, diff_y + 1);
		} else {
			// Clip circle
			ctx.beginPath();
			const coords = c.geometry.coordinates[0];
			const start = transform(coords[0]);
			ctx.moveTo(start[0], start[1]);
			for (let i = 0; i < coords.length; ++i) {
				const pos = transform(coords[i]);
				ctx.lineTo(pos[0], pos[1]);
			}
			ctx.clip();

			// Fill map, clipped to circle
			ctx.fillRect(0, 0, dimensions[0], dimensions[1]);
		}

		// Restore previous state on top
		ctx.restore();
	});
}

function drawRects(ctx: OffscreenCanvasRenderingContext2D, rects: LngLatBounds[], transform: (p: number[]) => number[]) {
	rects.forEach((b) => {
		ctx.save(); // Store canvas state

		const min = transform([b._sw.lng, b._sw.lat]);
		const max = transform([b._ne.lng, b._ne.lat]);
		const diff_x = max[0] - min[0];
		const diff_y = max[1] - min[1];
		ctx.fillRect(min[0], min[1], diff_x + 1, diff_y + 1);
		// Restore previous state on top
		ctx.restore();
	});
}

function setupWorker(stopOld: boolean) {
	if (stopOld) {
		shapeWorker?.terminate();
		shapeWorker = undefined;
	}

	if (shapeWorker === undefined) {
		shapeWorker = new ShapeWorker();

		shapeWorker.onmessage = (event: {data: ShapeMessage}) => {
			const method = event.data.method;
			switch (method) {
				case 'update-shape':
					const index = event.data.index;
					if (index < dataIndex) {
						console.log('Got stale index from shape worker:', index, dataIndex);
						return;
					}
					const msg: UpdateMessage = event.data;
					switch (msg.level) {
						case 'OVERLAY_RECTS':
							boxes = msg.data;
							self.postMessage({method: 'update-render-level', index: dataIndex, level: msg.level} as WorkerMessage);
							break;
						case 'OVERLAY_CIRCLES':
							circles = msg.data;
							self.postMessage({method: 'update-render-level', index: dataIndex, level: msg.level} as WorkerMessage);
							break;
						case 'GEOMETRY_CIRCLES':
							const geometry = msg.data;
							self.postMessage({method: 'update-render-level', index: dataIndex, level: msg.level, geometry: geometry} as WorkerMessage);
							break;
						default:
							console.log(`Unknown message '${msg}`);
					}
					break;
				default:
					console.log(`Unknown method '${method}'`);
			}
		};
	}
	return shapeWorker;
}