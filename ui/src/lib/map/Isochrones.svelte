<script lang="ts">
	import circle from '@turf/circle';
	import maplibregl, { CanvasSource, type LngLatBoundsLike, type Map } from 'maplibre-gl';
	import type { PrePostDirectMode } from '$lib/Modes';
	import WebWorker from '$lib/map/isochrones.ts?worker';
	import { untrack } from 'svelte';

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
	let canvas: HTMLCanvasElement | undefined = undefined;
	let canvasLoaded = false;
	// let viewport = $state<number[] | undefined>(undefined);

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

		if (worker === undefined) {
			console.log('Starting worker');
			worker = new WebWorker();
			canvas = document.createElement('canvas');
			let renderCanvas = canvas.transferControlToOffscreen();

console.log('canvas init');
			worker.postMessage({
				method: 'init',
				canvas: renderCanvas,
			}, [renderCanvas]);

			worker.onmessage = (event) => {
				console.log('Got response');
				const method = event.data.method;
				console.log('Method:', method);
				if (method == 'canvasUpdated') {
					console.log('TODO DELETE');
					// const canvas = event.data.canvas;
					// redrawCanvas(canvas);
				} else if (method == 'dataUpdated') {
					requestCanvasUpdate();
				} else {
					console.log(`Unknown method '${method}'`);
				}
			};
		}
		requestIsochronesCalculation();
	});

	function requestIsochronesCalculation() {
		if (!worker) {
			return;
		}
		worker.postMessage({
			method: 'update',
			data: $state.snapshot(isochronesData),
			maxDuration: $state.snapshot(maxAllTime),
			streetModes: $state.snapshot(streetModes),
			wheelchair: $state.snapshot(wheelchair),
			idx: 1,
		});
	}

	// $effect(() => {
	const viewport = $derived.by(() => {
console.log('TRIGGER 111');
		if (!map || !canvas) {
		console.log('no canvas');
			return undefined;
		}
console.log('TRIGGER 222');
		if (!canvasLoaded) {
			map.addSource(name, {
				type: 'canvas',
				canvas: canvas,
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
console.log('TRIGGER 333');

		if (!active) {
			untrack(() => {
			map.setLayoutProperty(name, 'visibility', 'none');
			});
			return undefined;
		}
console.log('TRIGGER 444');

		const op = opacity / 1000;
		untrack(() => {
		map.setLayoutProperty(name, 'visibility', 'visible');
		map.setPaintProperty(name, 'raster-opacity', op);
		// map.setPaintProperty(name, 'raster-opacity', opacity / 1000);
		});

		// viewport = map._containerDimensions();

		const coords = boxCoords;
		untrack(() => {
			const source = map.getSource(name) as CanvasSource;
			source.setCoordinates(coords);
		});

		// requestCanvasUpdate();

		return map._containerDimensions();
	});

	$effect(() => {
		requestCanvasUpdate();
	})

	function requestCanvasUpdate() {
		if (!worker || !viewport) {
		console.log('missing viewport');
			return;
		}

		untrack(() => {
		worker!.postMessage({
			method: 'render',
			boundingBox: $state.snapshot(boundingBox),
			dimensions: $state.snapshot(viewport),
		});
		});
	}

</script>
