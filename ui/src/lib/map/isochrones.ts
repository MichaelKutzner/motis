import bbox from '@turf/bbox';
import circle from '@turf/circle';
import maplibregl, { CanvasSource, LngLatBounds, type LngLatBoundsLike, type Map } from 'maplibre-gl';
import type { PrePostDirectMode } from '$lib/Modes';

let canvas: OffscreenCanvas | undefined = undefined;

let boxes: any = undefined;
let circles: any = undefined;
interface IsochronesPos {
	lat: number;
	lng: number;
	seconds: number;
}

type CircleType = ReturnType<typeof circle>;

self.onmessage = function(event) {
	console.log('Worker received data');
	const method = event.data.method;
	if (method == 'init') {
		canvas = event.data.canvas;
	} else if (method == 'update') {
		const isochronesData = event.data.data;
		const maxDuration = event.data.maxDuration;
		const streetModes = event.data.streetModes;
		const wheelchair = event.data.wheelchair;
		const idx = event.data.idx;
		//const speed = getSpeed(streetModes, wheelchair);  //calculate_constants(maxAllTime, streetModes, wheelchair);
		const maxDistance = getMaxDistanceFunction(maxDuration, streetModes, wheelchair);
		const rects = calculateRects(isochronesData, maxDistance);
		boxes = rects;
		circles = undefined;
		console.log('Rects set');
		self.postMessage({method: 'dataUpdated'});
		// self.postMessage(['rects', rects, idx]);
		const allCircles = calculateCircles(isochronesData, maxDistance);
		circles = allCircles;
		boxes = undefined;
		console.log('Circles set');
		self.postMessage({method: 'dataUpdated'});
		// self.postMessage(['renderer', createCircleWorkerURL(allCircles), idx]);
		// self.postMessage(['circles', allCircles, idx]);
		/*
		const visibleCircles = TODO;
		self.postMessage(['circles', visibleCircles, idx]);
		const polygons = TODO;
		self.postMessage(['polygons', polygons, idx]);
		*/
	} else if (method == 'render') {
		console.log('Render requested', boxes == undefined, circles == undefined);
		const boundingBox = event.data.boundingBox;
		if (!canvas) {
			return;
		}
		// const canvas = event.data.canvas;
		const dimensions = event.data.dimensions;
		canvas.width = dimensions[0];
		canvas.height = dimensions[1];
		let ctx = canvas.getContext("2d");
		if (!ctx) {
			return;
		}

		const transform = getTransformer(boundingBox, dimensions);

		if (circles) {
			const isVisible = getIsVisible(boundingBox);
			drawCircles(ctx, circles, transform, isVisible, dimensions);
		} else if (boxes) {
			drawRects(ctx, boxes, transform);
		}

		/*
		console.log('BEFORE');
		self.postMessage({
			method: 'canvasUpdated',
			canvas: canvas,
		});
		console.log('AFTER');
		*/
	}
}

function getMaxDistanceFunction(maxDuration: number, streetModes: PrePostDirectMode[], wheelchair: boolean) {
	const kilometersPerSecond =
		streetModes.includes('BIKE')
			? 0.0038 // 3.8 meters per second
			: wheelchair
				? 0.0008 // 0.8 meters per second
				: 0.0012 // 1.2 meters per second
	;
	return (pos: IsochronesPos) => Math.min(pos.seconds, maxDuration) * kilometersPerSecond;
}

function calculateRects(isochrones: IsochronesPos[], maxDistance: (pos: IsochronesPos) => number) {
	return isochrones.map((data) => {
		const r = maxDistance(data);
		// Compare geo::includes/geo/box.h
		const d_lat = r / 111.0;
		const min_lat_rad = data.lat * Math.PI / 180;
		const min_km_per_deg = 111.2 * Math.cos(min_lat_rad);
		const d_lng = min_km_per_deg > 0 ? r / min_km_per_deg : 0;
		return LngLatBounds.convert([
			[data.lng - d_lng, data.lat - d_lat],
			[data.lng + d_lng, data.lat + d_lat],
		]);
	});
}

function calculateCircles(isochrones: IsochronesPos[], maxDistance: (pos: IsochronesPos) => number) {
	return isochrones.map((data) => {
		const r = maxDistance(data);
		let c = circle([data.lng, data.lat], r, {
			// steps: 64,
			units: 'kilometers'
		});
		c.bbox = bbox(c);
		return c;
	});
}

function getTransformer(boundingBox: LngLatBounds, dimensions: number[]) {
		console.log("DEBUG 5555");
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

function drawCircles(ctx: OffscreenCanvasRenderingContext2D, circles: CircleType[], transform: (p: number[]) => number[], is_visible: (c: CircleType) => boolean, dimensions: number[]) {
	ctx.fillStyle = 'magenta';
	ctx.clearRect(0, 0, dimensions[0], dimensions[1]);

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

	// self.postMessage(true);
}

function drawRects(ctx: OffscreenCanvasRenderingContext2D, rects: maplibregl.LngLatBounds[], transform: (p: number[]) => number[]) {
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