import maplibregl, { CanvasSource, LngLatBounds, type LngLatBoundsLike, type Map } from 'maplibre-gl';
import type { PrePostDirectMode } from '$lib/Modes';

interface IsochronesPos {
	lat: number;
	lng: number;
	seconds: number;
}

self.onmessage = function(event) {
	console.log('Worker received data');
	const [isochronesData, maxDuration, streetModes, wheelchair, idx] = event.data;
	//const speed = getSpeed(streetModes, wheelchair);  //calculate_constants(maxAllTime, streetModes, wheelchair);
	const maxDistance = getMaxDistanceFunction(maxDuration, streetModes, wheelchair);
	const rects = calculateRects(isochronesData, maxDistance);
	self.postMessage(['rects', rects, idx]);
	/*
	const allCircles = TODO;
	self.postMessage(['circles', allCircles, idx]);
	const visibleCircles = TODO;
	self.postMessage(['circles', visibleCircles, idx]);
	const polygons = TODO;
	self.postMessage(['polygons', polygons, idx]);
	*/
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