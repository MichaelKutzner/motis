import bbox from '@turf/bbox';
import circle from '@turf/circle';
import union from '@turf/union';
import { featureCollection } from '@turf/helpers';
import { LngLatBounds } from 'maplibre-gl';
import { isLess, nextDisplayLevel, type DisplayLevel, type Geometry, type IsochronesPos } from '$lib/map/IsochronesShared';

type RectType = {bbox: LngLatBounds, distance: number, data: IsochronesPos};
type CircleType = ReturnType<typeof circle>;
export type UpdateMessage = {level: 'OVERLAY_RECTS', data: LngLatBounds[]} | {level: 'OVERLAY_CIRCLES', data: CircleType[]} | {level: 'GEOMETRY_CIRCLES', data: Geometry | undefined};
export type ShapeMessage = {method: 'update-shape', index: number} & UpdateMessage;

let dataIndex = 0;
let data: IsochronesPos[] | undefined = undefined;
let rects: RectType[] | undefined = undefined;
let circles: CircleType[] | undefined = undefined;
let circleGeometry: Geometry | undefined = undefined;
let currentDepth: DisplayLevel = 'NONE';
let maxDepth: DisplayLevel = 'NONE';
let working = false;
let maxDistance = (_: IsochronesPos) => 0;

self.onmessage = async function(event) {
	const method = event.data.method;
	if (method == 'set-data') {
		data = event.data.data;
		resetResults(event.data.index);
		const speed = event.data.speed;
		const maxDuration = event.data.maxDuration;
		maxDistance = getMaxDistanceFunction(speed, maxDuration);

	} else if (method == 'update-depth') {
		maxDepth = event.data.depth;
		createShapes();
	}
}

function resetResults(index: number) {
	dataIndex = index;
	rects = undefined;
	circles = undefined;
	circleGeometry = undefined;
	currentDepth = 'NONE';
	maxDepth = 'NONE';
	maxDistance = (_: IsochronesPos) => 0;
}

function getMaxDistanceFunction(kilometersPerSecond: number, maxDuration: number) {
	return (pos: IsochronesPos) => Math.min(pos.seconds, maxDuration) * kilometersPerSecond;
}

async function createShapes() {
	const index = dataIndex;
	const isStale = () => index != dataIndex;
	if (working || !isLess(currentDepth, maxDepth)) {
		return;
	}
	working = true;
	let success = false;
	switch (currentDepth) {
		case 'NONE':
			success = await createBboxes().then(async (b) => {
				if (isStale()) {
					console.log('Index got stale while computing rects');
					return false;
				}
				rects = b;
				self.postMessage({method: 'update-shape', index: dataIndex, level: 'OVERLAY_RECTS', data: rects.map((r) => r.bbox)} as ShapeMessage);
				return await filterContained(rects).then((b2) => {
					if (isStale()) {
						console.log('Index got stale deleting covered rects');
						return false;
					}
					rects = b2;
					self.postMessage({method: 'update-shape', index: dataIndex, level: 'OVERLAY_RECTS', data: rects.map((r) => r.bbox)} as ShapeMessage);
					return true;
				});
			});
			break;
		case 'OVERLAY_RECTS':
			success = await createCircles().then((c) => {
				if (isStale()) {
					console.log('Index got stale while computing circles');
					return false;
				}
				circles = c;
				self.postMessage({method: 'update-shape', index: dataIndex, level: 'OVERLAY_CIRCLES', data: circles} as ShapeMessage);
				return true;
			});
			break;
		case 'OVERLAY_CIRCLES':
			success = await createUnion().then((u) => {
				if (isStale()) {
					console.log('Index got stale while computing geometry');
					return false;
				}
				circleGeometry = u;
				self.postMessage({method: 'update-shape', index: dataIndex, level: 'GEOMETRY_CIRCLES', data: circleGeometry} as ShapeMessage);
				return true;
			});
			break;
		default:
			console.log(`Unexpected level '${currentDepth}'`)
	}
	if (success) {
		currentDepth = nextDisplayLevel(currentDepth);
	}
	working = false;
	createShapes();
}

async function createBboxes() {
	if (data === undefined) {
		return [];
	}
	const promises = data.map(async (point) => {
		const r = maxDistance(point);
		// Approximation: Compare geo::includes/geo/box.h
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
	boxes.sort((a: any, b: any) => b.distance - a.distance);
	const isCoveredPromises = boxes.map(async (box: any, index: number) =>
		boxes.slice(0, index).some((b: any) => contains(b, box))
	);
	const isCovered = await Promise.all(isCoveredPromises);
	const visibleBoxes = boxes.filter((box: any , index: number) => !isCovered[index]);
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
		return undefined;
	}
	const queue: Geometry[] = await circles.map((c) => c);
	while (queue.length > 1) {
		const a = queue.shift()!;
		const b = queue.shift()!;
		const c = await union(featureCollection([a, b]));
		if (c) {
			queue.push(c);
		}
	}
	return queue.length == 1 ? queue[0] : undefined;
}
