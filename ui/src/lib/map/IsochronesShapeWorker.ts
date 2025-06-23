import bbox from '@turf/bbox';
import circle from '@turf/circle';
import { featureCollection } from '@turf/helpers';
import union from '@turf/union';
import maplibregl, { CanvasSource, LngLatBounds, type LngLatBoundsLike, type Map } from 'maplibre-gl';

interface IsochronesPos {
	lat: number;
	lng: number;
	seconds: number;
}

type RectType = {bbox: LngLatBounds, distance: number, data: IsochronesPos};
type CircleType = ReturnType<typeof circle>;
type UnionType = ReturnType<typeof union>;

let data: IsochronesPos[] | undefined = undefined;
let rects: RectType[] | undefined = undefined;
let circles: CircleType[] | undefined = undefined;
let circleGeometry: UnionType | undefined = undefined;
let currentDepth = -1;
let maxDepth = -1;
let working = false;
// let queue: number[] = [];
// let iter = 0;
let maxDistance = (_: IsochronesPos) => 0;

self.onmessage = async function(event) {
	console.log('Shape worker received data');
	const method = event.data.method;
	if (method == 'set-data') {
console.log('DATA UPDATE');
		data = event.data.data;
		resetResults();
// 	} else if (method == 'update-maxDistance') {
// console.log('SPEED UPDATE');
// 		resetResults();
		const speed = event.data.speed;
		const maxDuration = event.data.maxDuration;
		maxDistance = getMaxDistanceFunction(speed, maxDuration);
		// createShapes();
	} else if (method == 'update-depth') {
console.log('DEPTH UPDATE');
		// const maxDepth = event.data.depth;
		maxDepth = event.data.depth;
		// queue = [maxDepth];
		// ++iter;
		createShapes();
	}
}

function resetResults() {
	rects = undefined;
	circles = undefined;
	circleGeometry = undefined;
	currentDepth = -1;
	maxDepth = -1;
	// queue = [];
	maxDistance = (_: IsochronesPos) => 0;
}

function getMaxDistanceFunction(kilometersPerSecond: number, maxDuration: number) {
	return (pos: IsochronesPos) => Math.min(pos.seconds, maxDuration) * kilometersPerSecond;
}

async function createShapes() {
	console.log('Create triggered');
	if (working || currentDepth >= maxDepth) {
		return;
	}
	working = true;
	// if (queue.length == 0) {
	// 	return;
	// }
	//
	// const maxDepth = queue.pop();
	// if (maxDepth === undefined || maxDepth <= currentDepth) {
	// 	return;
	// }
	// const thisIter = iter;
	// while (currentDepth < maxDepth) {
	// 	if (thisIter != iter) {
	// 		return;
	// 	}
		if (currentDepth == -1) {
			const bboxes = await createBboxes();
			rects = bboxes;
			self.postMessage({method: 'update-shape', shape: 'rects', data: rects.map((r) => r.bbox)});
console.log("Total rects:", bboxes.length);
			const notContainedBboxes = await filterContained(bboxes);
			rects = notContainedBboxes;
			self.postMessage({method: 'update-shape', shape: 'rects', data: rects.map((r) => r.bbox)});
		} else if (currentDepth == 0) {
			const isochronesCircles = await createCircles();
			circles = isochronesCircles;
			self.postMessage({method: 'update-shape', shape: 'circles', data: circles});
		} else if (currentDepth == 1) {
			const geometry = await createUnion();
			circleGeometry = geometry;
			self.postMessage({method: 'update-shape', shape: 'geojson', data: geometry});
		}
		++currentDepth;
	// }
	// if (queue.length == 0) {
	// 	queue.push(maxDepth);
	// }
	working = false;
	createShapes();
}

async function createBboxes() {
	if (data === undefined) {
		return [];
	}
	const promises = data.map(async (point) => {
		const r = maxDistance(point);
		// Compare geo::includes/geo/box.h
		const d_lat = r / 111.0;
		const min_lat_rad = point.lat * Math.PI / 180;
		const min_km_per_deg = 111.2 * Math.cos(min_lat_rad);
		const d_lng = min_km_per_deg > 0 ? r / min_km_per_deg : 0;
		return {
			bbox: LngLatBounds.convert([
				[point.lng - d_lng, point.lat - d_lat],
				[point.lng + d_lng, point.lat + d_lat],
			]),
			distance: r,
			data: point,
		};
	});
	return await Promise.all(promises);
}

function contains(larger: any, smaller: any): boolean {
	const bb1 = larger.bbox;
	const bb2 = smaller.bbox;
	return bb1._sw.lat <= bb2._sw.lat && bb1._sw.lng <= bb2._sw.lng
	    && bb1._ne.lat >= bb2._ne.lat && bb1._ne.lng >= bb2._ne.lng;
}

async function filterContained(boxes: RectType[]) {
	// Sort by distance, descending
	const t1 = Date.now();
	boxes.sort((a: any, b: any) => b.distance - a.distance);
	const t2 = Date.now();
	console.log('sorted');
	const isCoveredPromises = boxes.map(async (box: any, index: number) =>
		boxes.slice(0, index).some((b: any) => contains(b, box))
	);
	const isCovered = await Promise.all(isCoveredPromises);
	const t22 = Date.now();
	const visibleBoxes = boxes.filter((box: any , index: number) => !isCovered[index]);
	const t3 = Date.now();
	console.log('Sorting took:', t2 - t1);
	console.log('Tests took:', t22 - t2);
	console.log('Filtering took:', t3 - t22);
	return visibleBoxes;
}

async function createCircles() {
	if (rects === undefined) {
		return [];
	}
	const promises = rects.map(async (point) => {
		let c = circle([point.data.lng, point.data.lat], point.distance, {
			// steps: 64,
			units: 'kilometers'
		});
		c.bbox = bbox(c);
		return c;
	});
	return await Promise.all(promises);
}

// Implementation based on https://stackoverflow.com/a/75982694
// Create union for smaller polygons first
// Using a pipe like approach should place larger polygons at the end

async function createUnion() {
	if (circles === undefined) {
		return null;
	}
	console.log("Circles before:", circles.length);
	// const queue = await circles.filter(((p) => p !== undefined));
	const queue: UnionType[] = await circles;
	// await sleep(0);
	while (queue.length > 1) {
		// await sleep(0);

		const a = queue.shift()!;
		const b = queue.shift()!;
		const c = await union(featureCollection([a, b]));
		if (c) {
			queue.push(c);
		}
	}
	console.log("Circles after:", circles.length);
	return queue.length == 1 ? queue[0] : null;
}
