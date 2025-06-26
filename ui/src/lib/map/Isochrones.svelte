<script lang="ts">
	import maplibregl from 'maplibre-gl';
	import { CanvasSource, GeoJSONSource, type LngLatBoundsLike, type Map } from 'maplibre-gl';
	import type { PrePostDirectMode } from '$lib/Modes';
	import WebWorker from '$lib/map/IsochronesWorker.ts?worker';
	import { isCanvasLevel, isLess, minDisplayLevel, type DisplayLevel, type Geometry, type IsochronesOptions, type IsochronesPos } from '$lib/map/IsochronesShared';
	import type { WorkerMessage } from './IsochronesWorker';

	type BoxCoordsType = [[number, number], [number, number], [number, number], [number, number]];

	let {
		map,
		bounds,
		isochronesData,
		streetModes,
		wheelchair,
		maxAllTime,
		active,
		options,
	}: {
		map: Map | undefined;
		bounds: LngLatBoundsLike | undefined;
		isochronesData: IsochronesPos[];
		streetModes: PrePostDirectMode[];
		wheelchair: boolean;
		maxAllTime: number;
		active: boolean;
		options: IsochronesOptions;
	} = $props();

	const emptyGeometry: GeoJSON.GeoJSON = {"type":"LineString","coordinates": []};
	let objects = $state<{
		worker: Worker,
		canvasName: 'isochrones-canvas',
		circlesName: 'isochrones-circles',
		canvasSource: CanvasSource,
		circlesSource: GeoJSONSource,
	} | undefined>(undefined);
	let circlesGeometry = $state<Geometry | GeoJSON.GeoJSON>(emptyGeometry);
	let currentRenderLevel = $state<DisplayLevel>('NONE');
	let availableRenderLevel = $state<DisplayLevel>('NONE');

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

	let lastData: IsochronesPos[] = [];
	let lastAllTime: number = maxAllTime;
	// svelte-ignore state_referenced_locally
	let lastSpeed: number | undefined = kilometersPerSecond;
	let dataIndex = 0;

	$effect(() => {
		if (!map || !active || objects !== undefined) {
			return;
		}

		// Create sources, layers and canvases
		const canvasName = 'isochrones-canvas';
		const circlesName = 'isochrones-circles';

		let canvas = document.createElement('canvas');
		if (canvas === undefined) {
			console.log('Canvas not supported');
			return;
		}
		let renderCanvas = canvas.transferControlToOffscreen();

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
				'raster-opacity': options.opacity / 1000
			}
		});
		const canvasSource = map.getSource(canvasName) as CanvasSource;

		map.addSource(circlesName, {
			type: 'geojson',
			data: emptyGeometry,
		});
		map.addLayer({
			id: circlesName,
			type: 'fill',
			source: circlesName,
			paint: {
				'fill-color': options.color,
				'fill-opacity': options.opacity / 1000
			}
		});
		const circlesSource = map.getSource(circlesName) as GeoJSONSource;

		// Setup worker
		const worker = new WebWorker();

		worker.onmessage = (event: {data: WorkerMessage}) => {
			const method = event.data.method;
			switch (method) {
				case 'update-render-level':
					const index = event.data.index;
					if (index < dataIndex) {
						console.log('Got stale index from worker:', index, dataIndex);
						return;
					}
					const level: DisplayLevel = event.data.level;
					if (level == 'GEOMETRY_CIRCLES') {
						circlesGeometry = event.data.geometry ?? emptyGeometry;
					}
					if (isLess(availableRenderLevel, level)) {
						availableRenderLevel = level;
						if (!isLess(options.renderMode, availableRenderLevel)) {
							requestCanvasUpdate();
						}
					}
					break;
				default:
					console.log(`Unknown method '${method}'`);
			}
		};

		worker.postMessage({
			method: 'set-canvas',
			canvas: renderCanvas,
		}, [renderCanvas]);

		// Store references
		objects = {
			worker: worker,
			canvasName: canvasName,
			circlesName: circlesName,
			canvasSource: canvasSource,
			circlesSource: circlesSource,
		};
	});

	$effect(() => {
		if (!active || objects === undefined) {
			return;
		}

		if (((lastData.length != 0 || isochronesData.length != 0) && lastData != isochronesData ) || lastAllTime != maxAllTime || lastSpeed != kilometersPerSecond) {
			objects.worker.postMessage({
				method: 'update-data',
				data: $state.snapshot(isochronesData),
				maxDuration: $state.snapshot(maxAllTime),
				kilometersPerSecond: $state.snapshot(kilometersPerSecond),
				index: ++dataIndex,
			});

			lastData = isochronesData;
			lastAllTime = maxAllTime;
			lastSpeed = kilometersPerSecond;

			circlesGeometry = emptyGeometry;
			availableRenderLevel = 'NONE';
		}

		objects.worker.postMessage({
			method: 'set-render-depth',
			maxRenderLevel: options.maxRenderMode,
		});
	});

	$effect(() => {
		if (!map || objects === undefined) {
			return;
		}
		map.setLayoutProperty(objects.canvasName, 'visibility', active && isCanvasLevel(currentRenderLevel) ? 'visible' : 'none');
		map.setLayoutProperty(objects.circlesName, 'visibility', active && currentRenderLevel == 'GEOMETRY_CIRCLES' ? 'visible' : 'none');
	});

	$effect(() => {
		if (!map || objects === undefined) {
			return;
		}
		map.setPaintProperty(objects.canvasName, 'raster-opacity', options.opacity / 1000);
		map.setPaintProperty(objects.circlesName, 'fill-opacity', options.opacity / 1000);
	});

	$effect(() => {
		if (!map || objects === undefined) {
			return;
		}
		map.setPaintProperty(objects.circlesName, 'fill-color', options.color);
	});

	$effect(() => {
		if (!map || objects === undefined) {
			return;
		}
		objects.circlesSource.setData(circlesGeometry);
	});

	$effect(() => requestCanvasUpdate());

	function requestCanvasUpdate() {
		if (!map || !active || objects === undefined) {
			return;
		}

		const nextLevel = minDisplayLevel(options.renderMode, availableRenderLevel);

		if (nextLevel == 'NONE') {
			currentRenderLevel = nextLevel;
		} else if (isCanvasLevel(nextLevel)) {
			objects.canvasSource.setCoordinates(boxCoords);

			const viewport = map._containerDimensions();

			currentRenderLevel = nextLevel;

			objects.worker.postMessage({
				method: 'render-canvas',
				level: currentRenderLevel,
				boundingBox: $state.snapshot(boundingBox),
				dimensions: viewport,
				color: currentRenderLevel == options.renderMode ? options.color : "magenta",
			});
		} else {
			currentRenderLevel = nextLevel;
		}
	}

</script>
