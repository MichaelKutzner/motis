<script lang="ts">
	import circle from '@turf/circle';
	import maplibregl, { CanvasSource, type LngLatBoundsLike, type Map } from 'maplibre-gl';
	import type { PrePostDirectMode } from '$lib/Modes';
	import WebWorker from '$lib/map/isochrones.ts?worker';

	export interface IsochronesPos {
		lat: number;
		lng: number;
		seconds: number;
	}

	type BoxCoordsType = [[number, number], [number, number], [number, number], [number, number]];
	type CircleType = ReturnType<typeof circle>;

	let {
		map,
		bounds,
		isochronesData,
		streetModes,
		wheelchair,
		maxAllTime,
		active,
		color,
		opacity
	}: {
		map: Map | undefined;
		bounds: LngLatBoundsLike | undefined;
		isochronesData: IsochronesPos[];
		streetModes: PrePostDirectMode[];
		wheelchair: boolean;
		maxAllTime: number;
		active: boolean;
		color: string;
		opacity: number;
	} = $props();

	const name = 'isochrones-data';
	let canvasLoaded = false;

	let lastData: IsochronesPos[] | undefined = undefined;
	let lastAllTime: number = maxAllTime;
	let lastSpeed: number | undefined = undefined;

	const kilometersPerSecond = $derived(
		streetModes.includes('BIKE')
			? 0.0038 // 3.8 meters per second
			: wheelchair
				? 0.0008 // 0.8 meters per second
				: 0.0012 // 1.2 meters per second
	);
	const boundingBox = $derived(
		maplibregl.LngLatBounds.convert(
			bounds ?? [
				[0, 0],
				[1, 1]
			]
		)
	);
	const boxCoords: BoxCoordsType = $derived([
		[boundingBox._sw.lng, boundingBox._ne.lat],
		[boundingBox._ne.lng, boundingBox._ne.lat],
		[boundingBox._ne.lng, boundingBox._sw.lat],
		[boundingBox._sw.lng, boundingBox._sw.lat]
	]);

	function transform(pos: number[], dimensions: number[]) {
		const x = Math.round(
			((pos[0] - boundingBox._sw.lng) / (boundingBox._ne.lng - boundingBox._sw.lng)) * dimensions[0]
		);
		const y = Math.round(
			((boundingBox._ne.lat - pos[1]) / (boundingBox._ne.lat - boundingBox._sw.lat)) * dimensions[1]
		);
		return [x, y];
	}

	let worker: Worker | undefined = undefined;

	$effect(() => {
		if (
			!active ||
			(lastData == isochronesData && lastAllTime == maxAllTime && lastSpeed == kilometersPerSecond)
		) {
			return;
		}

		if (worker !== undefined) {
			worker.terminate();
		}
		console.log('Starting worker');
		worker = new WebWorker();
		worker.postMessage([$state.snapshot(isochronesData), $state.snapshot(maxAllTime), $state.snapshot(streetModes), $state.snapshot(wheelchair), 1]);
		worker.onmessage = (event) => {
			console.log('Got response');
			const [resultType, data, idx] = event.data;
			console.log('Type:', resultType);
			if (resultType == 'rects') {
				unsetAll();
				boxes = data;
			} else if (resultType == 'circles') {
				unsetAll();
				circles = data;
			} else if (resultType == 'polygons') {
				unsetAll();
				// polygons = data;
				worker?.terminate();
				worker = undefined;
			} else {
				console.log(`Unknown type '${resultType}'`);
			}
		};
	});

	function unsetAll() {
				boxes = undefined;
				circles = undefined;
				// polygons = undefined;
	}

	let boxes = $state<maplibregl.LngLatBounds[] | undefined>(undefined);
	let circles = $state<CircleType[] | undefined>(undefined);

	function is_visible(circle: CircleType) {
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

	$effect(() => {
		if (!map) {
			return;
		}
		if (!canvasLoaded) {
			map.addSource(name, {
				type: 'canvas',
				canvas: 'isochronesCanvas',
				coordinates: boxCoords
			});
			map.addLayer({
				id: name,
				type: 'raster',
				source: name,
				paint: {
					'raster-opacity': opacity / 1000
				}
			});
			canvasLoaded = true;
		}

		if (!active || !(boxes || circles)) {
			map.setLayoutProperty(name, 'visibility', 'none');
			return;
		}

		map.setLayoutProperty(name, 'visibility', 'visible');
		map.setPaintProperty(name, 'raster-opacity', opacity / 1000);

		const dimensions = map._containerDimensions();
		const source = map.getSource(name) as CanvasSource;
		source.setCoordinates(boxCoords);

		const canvas = source.canvas;
		canvas.width = dimensions[0];
		canvas.height = dimensions[1];

		const ctx = canvas.getContext('2d');
		if (!ctx) {
			return;
		}
		ctx.fillStyle = color;
		ctx.clearRect(0, 0, dimensions[0], dimensions[1]);

		if (circles) {
			drawCircles(ctx, circles, dimensions);
		} else if (boxes) {
			drawBoxes(ctx, boxes, dimensions);
		}
	});

	function drawBoxes(ctx: CanvasRenderingContext2D, boxes: maplibregl.LngLatBounds[], dimensions: number[]) {
		boxes.forEach((b) => {
			ctx.save(); // Store canvas state

			const min = transform([b._sw.lng, b._sw.lat], dimensions);
			const max = transform([b._ne.lng, b._ne.lat], dimensions);
			const diff_x = max[0] - min[0];
			const diff_y = max[1] - min[1];
			ctx.fillRect(min[0], min[1], diff_x + 1, diff_y + 1);
			// Restore previous state on top
			ctx.restore();
		});
	}

	function drawCircles(ctx: CanvasRenderingContext2D, circles: CircleType[], dimensions: number[]) {
		circles.filter(is_visible).forEach((c) => {
			ctx.save(); // Store canvas state

			const b = c.bbox!; // Existence checked in filter()
			const min = transform([b[0], b[1]], dimensions);
			const max = transform([b[2], b[3]], dimensions);
			const diff_x = max[0] - min[0];
			const diff_y = max[1] - min[1];

			if (diff_x < 2 && diff_y < 2) {
				// Draw small rect
				ctx.fillRect(min[0], min[1], diff_x + 1, diff_y + 1);
			} else {
				// Clip circle
				ctx.beginPath();
				const coords = c.geometry.coordinates[0];
				const start = transform(coords[0], dimensions);
				ctx.moveTo(start[0], start[1]);
				for (let i = 0; i < coords.length; ++i) {
					const pos = transform(coords[i], dimensions);
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
</script>

<canvas id="isochronesCanvas">Canvas not supported</canvas>
