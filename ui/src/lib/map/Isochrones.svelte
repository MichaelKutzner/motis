<script lang="ts">
	import maplibregl, { CanvasSource, GeoJSONSource, type LngLatBoundsLike, type Map } from 'maplibre-gl';
	import union from '@turf/union';
	import type { PrePostDirectMode } from '$lib/Modes';
	import WebWorker from '$lib/map/isochrones.ts?worker';

	export interface IsochronesPos {
		lat: number;
		lng: number;
		seconds: number;
	}

	type BoxCoordsType = [[number, number], [number, number], [number, number], [number, number]];
	type UnionType = ReturnType<typeof union>;

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
	const canvasName = `${name}-canvas`;
	const geoJSONName = `${name}-geojson`;
	let canvas: HTMLCanvasElement | undefined = undefined;
	let canvasSource = $state<CanvasSource | undefined>(undefined);
	let polygons = $state<UnionType | undefined>(undefined);

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

	let worker: Worker | undefined = undefined;

	$effect(() => {
		if (
			!active ||
			(lastData == isochronesData && lastAllTime == maxAllTime && lastSpeed == kilometersPerSecond)
		) {
			return;
		}

		const worker = setupWorker();
		worker.postMessage({
			method: 'update',
			data: $state.snapshot(isochronesData),
			maxDuration: $state.snapshot(maxAllTime),
			kilometersPerSecond: $state.snapshot(kilometersPerSecond),
			idx: 1,
		});

		lastData = isochronesData;
		lastAllTime = maxAllTime;
		lastSpeed = kilometersPerSecond;

		polygons = undefined;
	});

	$effect(() => {
		if (!map || !canvasSource) {
			return;
		}
		map.setLayoutProperty(canvasName, 'visibility', active && !polygons ? 'visible' : 'none');
		map.setLayoutProperty(geoJSONName, 'visibility', active && polygons ? 'visible' : 'none');
	});

	$effect(() => {
		if (!map || !canvasSource) {
			return;
		}
		map.setPaintProperty(canvasName, 'raster-opacity', opacity / 1000);
		map.setPaintProperty(geoJSONName, 'fill-opacity', opacity / 1000);
	});

	$effect(() => {
		if (!map || !canvasSource) {
			return;
		}
		map.setPaintProperty(geoJSONName, 'fill-color', color);
	});

	$effect(() => {
		if (!map || !canvasSource) {
			return;
		}
		console.log('Polygons updating …', polygons !== undefined);
		(map.getSource(geoJSONName) as GeoJSONSource).setData(polygons ?? '[]');
	});

	$effect(() => requestCanvasUpdate());

	function requestCanvasUpdate() {
		if (!map || !active || polygons) {
		console.log('No render update');
			return;
		}
		if (!canvasSource) {
			canvasSource = setupLayers(map);
			if (!canvasSource) {
				return;
			}
		} else {
			canvasSource.setCoordinates(boxCoords);
		}
		const worker = setupWorker();

		const viewport = map._containerDimensions();

		worker.postMessage({
			method: 'render',
			boundingBox: $state.snapshot(boundingBox),
			dimensions: viewport,
			color: color,
		});
	}

	function setupLayers(map: Map) {
		map.addSource(canvasName, {
			type: 'canvas',
			canvas: canvas,
			coordinates: boxCoords,
		});
		map.addLayer({
			id: canvasName,
			type: 'raster',
			source: canvasName,
			paint: {
				'raster-opacity': opacity / 1000
			}
		});

		map.addSource(geoJSONName, {
			type: 'geojson',
			data: '[]',
		});
		map.addLayer({
			id: geoJSONName,
			type: 'fill',
			source: geoJSONName,
			paint: {
				'fill-color': color,
				'fill-opacity': opacity / 1000
			}
		});

		return map.getSource(canvasName) as CanvasSource;
	}

	function setupWorker() {
		if (worker === undefined) {
			worker = new WebWorker();
			canvas = document.createElement('canvas');
			let renderCanvas = canvas.transferControlToOffscreen();

			worker.postMessage({
				method: 'init',
				canvas: renderCanvas,
			}, [renderCanvas]);

			worker.onmessage = (event) => {
				const method = event.data.method;
				if (method == 'dataUpdated') {
					requestCanvasUpdate();
				} else if (method == 'polygonsComputed') {
					polygons = event.data.polygons;
				} else {
					console.log(`Unknown method '${method}'`);
				}
			};
		}
		return worker;
	}

</script>
