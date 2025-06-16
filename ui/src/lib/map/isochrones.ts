import bbox from '@turf/bbox';
import circle from '@turf/circle';
import { featureCollection } from '@turf/helpers';
import union from '@turf/union';
import maplibregl, { CanvasSource, LngLatBounds, type LngLatBoundsLike, type Map } from 'maplibre-gl';

let canvas: OffscreenCanvas | undefined = undefined;

let boxes: any = undefined;
let circles: any = undefined;
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
	if (method == 'init') {
		canvas = event.data.canvas;
	} else if (method == 'update') {
		const isochronesData = event.data.data;
		const maxDuration = event.data.maxDuration;
		const kilometersPerSecond = event.data.kilometersPerSecond;
		const idx = event.data.idx;
		//const speed = getSpeed(streetModes, wheelchair);  //calculate_constants(maxAllTime, streetModes, wheelchair);
		const maxDistance = getMaxDistanceFunction(maxDuration, kilometersPerSecond);
		const rects = calculateRects(isochronesData, maxDistance);
		boxes = rects;
		circles = undefined;
		console.log('Rects set');
		console.log("Total rects:", boxes.length);
		self.postMessage({method: 'dataUpdated'});
		const nonContainedBoxes = removeContainedBoxes(boxes);
		boxes = nonContainedBoxes;
		console.log("non contained rects:", nonContainedBoxes.length);
		// self.postMessage(['rects', rects, idx]);
		const allCircles = calculateCircles(nonContainedBoxes);
		circles = allCircles;
		boxes = undefined;
		console.log('Circles set');
		self.postMessage({method: 'dataUpdated'});

		console.log('Union started');
		const polygons = await createUnion(allCircles);
		console.log('Union computed');
		self.postMessage({method: 'polygonsComputed', polygons: polygons});
		console.log('Message sent');
		// self.postMessage(['renderer', createCircleWorkerURL(allCircles), idx]);
		// self.postMessage(['circles', allCircles, idx]);
		// const visibleCircles = removeContained(allCircles);
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
		const color = event.data.color;
		const dimensions = event.data.dimensions;
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

		if (circles) {
			const isVisible = getIsVisible(boundingBox);
			await drawCircles(ctx, circles, transform, isVisible, dimensions);
		} else if (boxes) {
			drawRects(ctx, boxes, transform);
		}
	}
}

function getMaxDistanceFunction(maxDuration: number, kilometersPerSecond: number) {
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
		return {
			bbox: LngLatBounds.convert([
				[data.lng - d_lng, data.lat - d_lat],
				[data.lng + d_lng, data.lat + d_lat],
			]),
			distance: r,
			data: data,
		};
	});
}

function calculateCircles(isochrones: any[]) {
	return isochrones.map((data) => {
		let c = circle([data.data.lng, data.data.lat], data.distance, {
			// steps: 64,
			units: 'kilometers'
		});
		c.bbox = bbox(c);
		return c;
	});
}

function contains(larger: any, smaller: any) {
	const bb1 = larger.bbox;
	const bb2 = smaller.bbox;
	return bb1._sw.lat <= bb2._sw.lat && bb1._sw.lng <= bb2._sw.lng
	    && bb1._ne.lat >= bb2._ne.lat && bb1._ne.lng >= bb2._ne.lng;
}

function removeContainedBoxes(boxes: any) {
	// Sort by distance, descending
	const t1 = Date.now();
	boxes.sort((a: any, b: any) => b.distance - a.distance);
	const t2 = Date.now();
	// console.log(contains(boxes[0], boxes[1]));
	// return boxes;
	let visibleBoxes: typeof boxes = [];
	for (let i = 0; i < boxes.length; ++i) {
		if (visibleBoxes.every((b: any) => !contains(b, boxes[i]))) {
			visibleBoxes.push(boxes[i]);
		}
	}
	const t3 = Date.now();
	console.log('Sorting took:', t2 - t1);
	console.log('Filtering took:', t3 - t2);
	return visibleBoxes;
}
// function removeContained(circles: CircleType[]) {
// 	// TODO
// 	console.log(circles.length);
// 	return circles;
// }

// Implementation based on https://stackoverflow.com/a/75982694
// Create union for smaller polygons first
// Using a pipe like approach should place larger polygons at the end

function createUnion(d: UnionType[]) {
	const u = d.filter(((p) => p !== undefined));
	while (u.length > 1) {
		const a = u.shift()!;
		const b = u.shift()!;
		const c = union(featureCollection([a, b]));
		if (c) {
			u.push(c);
		}
	}
	return u.length == 1 ? u[0] : null;
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
	circles.filter(is_visible).forEach(async (c) => {
		// if (++i % 1000 == 0) {
			// const f = async () => { console.log('sleeping…'); return new Promise(resolve => setTimeout(resolve, ++i)); };
			// await f();
		// }
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

// function drawRects(ctx: OffscreenCanvasRenderingContext2D, rects: maplibregl.LngLatBounds[], transform: (p: number[]) => number[]) {
function drawRects(ctx: OffscreenCanvasRenderingContext2D, rects: any[], transform: (p: number[]) => number[]) {
	rects.forEach((bx) => {
		const b = bx.bbox;
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