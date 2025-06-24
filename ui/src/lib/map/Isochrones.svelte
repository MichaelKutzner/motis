<script lang="ts">
	import union from '@turf/union';
	import maplibregl from 'maplibre-gl';
	import type { CanvasSource, GeoJSONSource, LngLatBoundsLike, Map } from 'maplibre-gl';
	import type { PrePostDirectMode } from '$lib/Modes';
	import WebWorker from '$lib/map/IsochronesWorker.ts?worker';

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
		renderMode,
		maxRenderMode,
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
		renderMode: number;
		maxRenderMode: number;
		color: string;
		opacity: number;
	} = $props();

	const name = 'isochrones-data';
	const canvasName = `${name}-canvas`;
	const geoJSONName = `${name}-geojson`;
	const emptyGeometry: GeoJSON.GeoJSON = {"type":"Point","coordinates": [0,0]};
	let canvas: HTMLCanvasElement | undefined = undefined;
	let canvasSource = $state<CanvasSource | undefined>(undefined);
	let polygons = $state<UnionType | undefined>(undefined);
	let currentRenderLevel = $state(-1);
	let availableRenderLevel = $state(-1);

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

	let lastData: IsochronesPos[] = [];
	let lastAllTime: number = maxAllTime;
	// svelte-ignore state_referenced_locally
	let lastSpeed: number | undefined = $state.snapshot(kilometersPerSecond);
	let dataIndex = 0;

	$effect(() => {
		if (!active) {
			return;
		}

		const worker = setupWorker();

		if (((lastData.length != 0 || isochronesData.length != 0) && lastData != isochronesData ) || lastAllTime != maxAllTime || lastSpeed != kilometersPerSecond) {
			worker.postMessage({
				method: 'update-data',
				data: $state.snapshot(isochronesData),
				maxDuration: $state.snapshot(maxAllTime),
				kilometersPerSecond: $state.snapshot(kilometersPerSecond),
				// maxRenderLevel: maxRenderMode,
				index: ++dataIndex,
			});

			lastData = isochronesData;
			lastAllTime = maxAllTime;
			lastSpeed = kilometersPerSecond;

			polygons = undefined;
			availableRenderLevel = -1;
		}

		worker.postMessage({
			method: 'set-render-depth',
			maxRenderLevel: maxRenderMode,
		});
	});

	$effect(() => {
		if (!map || !canvasSource) {
			return;
		}
		map.setLayoutProperty(canvasName, 'visibility', active && currentRenderLevel >= 0 && currentRenderLevel < 2 ? 'visible' : 'none');
		map.setLayoutProperty(geoJSONName, 'visibility', active && currentRenderLevel >= 2 ? 'visible' : 'none');
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
		(map.getSource(geoJSONName) as GeoJSONSource).setData(polygons ?? emptyGeometry);
	});

	$effect(() => requestCanvasUpdate());

	function requestCanvasUpdate() {
		if (!map || !active) {
			return;
		}

		const nextLevel = Math.min(renderMode, availableRenderLevel);

		if (nextLevel < 0) {
			currentRenderLevel = nextLevel;
		} else if (nextLevel < 2) {
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

			currentRenderLevel = nextLevel;

			worker.postMessage({
				method: 'render-canvas',
				level: currentRenderLevel,
				boundingBox: $state.snapshot(boundingBox),
				dimensions: viewport,
				color: color,
			});
		} else {
			currentRenderLevel = nextLevel;
		}
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
			data: emptyGeometry,
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
				method: 'set-canvas',
				canvas: renderCanvas,
			}, [renderCanvas]);

			worker.onmessage = (event) => {
				const method = event.data.method;
				if (method == 'update-render-level') {
					const index = event.data.index;
					if (index < dataIndex) {
						console.log('Got stale index from worker:', index, dataIndex);
						return;
					}
					const level = event.data.level;
					if (level == 2) {
						polygons = event.data.geometry;
					}
					if (level > availableRenderLevel) {
						availableRenderLevel = level;
						if (availableRenderLevel <= renderMode) {
							requestCanvasUpdate();
						}
					}
				} else {
					console.log(`Unknown method '${method}'`);
				}
			};
		}
		return worker;
	}

</script>
