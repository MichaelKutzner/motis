import bbox from '@turf/bbox';
import circle from '@turf/circle';
import { featureCollection } from '@turf/helpers';
import union from '@turf/union';
import maplibregl, { CanvasSource, LngLatBounds, type LngLatBoundsLike, type Map } from 'maplibre-gl';
import ShapeWorker from '$lib/map/IsochronesShapeWorker.ts?worker';

// const frameRate = 1_000 / 15;  // ≈ 15 frames per second

let canvas: OffscreenCanvas | undefined = undefined;

let boxes: LngLatBounds[] | undefined = undefined;
let circles: CircleType[] | undefined = undefined;
let shapeWorker: Worker | undefined = undefined;
let workerWorking = false;

interface IsochronesPos {
	lat: number;
	lng: number;
	seconds: number;
}

type CircleType = ReturnType<typeof circle>;
type UnionType = ReturnType<typeof union>;

self.onmessage = async function(event) {
	console.log('Worker received data');
	const method = event.data.method;
	console.log('Method:', method);
	if (method == 'set-canvas') {
		canvas = event.data.canvas;
	} else if (method == 'update-data') {
		const isochronesData = event.data.data;
		const maxDuration = event.data.maxDuration;
		// const maxRenderLevel = event.data.maxRenderLevel;
		const kilometersPerSecond = event.data.kilometersPerSecond;
		const idx = event.data.idx;
		// Unser previous results
		boxes = undefined;
		circles = undefined;
		let worker = setupWorker();
		worker.postMessage({
			method: 'set-data',
			data: isochronesData,
			speed:kilometersPerSecond,
			maxDuration:maxDuration,
		});
	} else if (method == 'set-render-depth') {
		let worker = setupWorker();
		const depth = event.data.maxRenderLevel;
		worker.postMessage({method: 'update-depth', depth});
	} else if (method == 'render-canvas') {
		console.log('Render requested', boxes == undefined, circles == undefined);
		if (!canvas) {
			return;
		}
		const boundingBox = event.data.boundingBox;
		const color = event.data.color;
		const dimensions = event.data.dimensions;
		const level = event.data.level;
		console.log('Rendering level:', level);
		console.log('Dims:', dimensions);
		canvas.width = dimensions[0];
		canvas.height = dimensions[1];
		let ctx = canvas.getContext("2d");
		if (!ctx) {
			return;
		}

		const transform = getTransformer(boundingBox, dimensions);

		ctx.fillStyle = color;
		ctx.fillStyle = 'magenta';
		ctx.clearRect(0, 0, dimensions[0], dimensions[1]);

		if (level == 1 && circles) {
			const isVisible = getIsVisible(boundingBox);
			drawCircles(ctx, circles, transform, isVisible, dimensions);
		} else if (level == 0 && boxes) {
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
	let i = 0;
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

function setupWorker() {
	if (shapeWorker === undefined || workerWorking) {
		if (workerWorking) {
			shapeWorker?.terminate();
			console.log('Shape worker stopped');
			workerWorking = false;
		}
		shapeWorker = new ShapeWorker();

		shapeWorker.onmessage = (event) => {
			const method = event.data.method;
			if (method == 'update-shape') {
				const shape = event.data.shape;
				if (shape == 'rects') {
					boxes = event.data.data;
					console.log('boxes set');
					self.postMessage({method: 'update-render-level', level: 0});
				} else if (shape == 'circles') {
					circles = event.data.data;
					console.log('circles set');
					self.postMessage({method: 'update-render-level', level: 1});
				} else if (shape == 'geojson') {
					const geometry = event.data.data;
					self.postMessage({method: 'update-render-level', level: 2, geometry: geometry});
				} else {
					console.log(`Unknown shape '${shape}`);
				}
			} else if (method == 'update-working-state') {
				workerWorking = event.data.data;
			} else {
				console.log(`Unknown method '${method}'`);
			}
		};
	}
	return shapeWorker;
}

async function sleep(ms: number) {
	return new Promise(resolve => setTimeout(resolve, ms));
}