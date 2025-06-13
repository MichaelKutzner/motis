<script lang="ts">
	import circle from '@turf/circle';
	import maplibregl, { CanvasSource, type LngLatBoundsLike, type Map } from 'maplibre-gl';
	import type { PrePostDirectMode } from '$lib/Modes';
	import WebWorker from '$lib/map/isochrones.ts?worker';
	import RenderWorker from '$lib/map/isochronesRenderer.ts?worker';
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
	/*
	$effect(() => {
		console.log('BOX:', boxCoords);
	})
	*/

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
	let renderWorker = $state<Worker | undefined>(undefined);

	// setInterval(() => {
	// 	console.log('Interval request');
	// 	if (worker) {
	// 		worker.postMessage({method: 'render'});
	// 	}
	// }, 1000);

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

	/*
	function unsetAll() {
				boxes = undefined;
				circles = undefined;
				// polygons = undefined;
	}

	let boxes = $state<maplibregl.LngLatBounds[] | undefined>(undefined);
	let circles = $state<CircleType[] | undefined>(undefined);
	*/

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
				// canvas: 'isochronesCanvas',
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

		// console.log('Starting worker 2');
		if (!active) {
			untrack(() => {
			map.setLayoutProperty(name, 'visibility', 'none');
			});
			return undefined;
		}
console.log('TRIGGER 444');
		/*
		if (!active || !(boxes || circles || renderWorker)) {
			map.setLayoutProperty(name, 'visibility', 'none');
			return;
		}
		*/

		// track bounds
		// let _ = bounds;

		const op = opacity / 1000;
		untrack(() => {
		map.setLayoutProperty(name, 'visibility', 'visible');
		map.setPaintProperty(name, 'raster-opacity', op);
		// map.setPaintProperty(name, 'raster-opacity', opacity / 1000);
		});

		// viewport = map._containerDimensions();
		// console.log('Viewport:', viewport);

		const coords = boxCoords;
		untrack(() => {
			const source = map.getSource(name) as CanvasSource;
			source.setCoordinates(coords);
		});

		// requestCanvasUpdate();

		return map._containerDimensions();
		/*
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

		if (circles) {
			drawCircles(ctx, circles, dimensions);
		} else if (renderWorker) {
			runRenderer(ctx, renderWorker, dimensions);
		} else if (boxes) {
			ctx.fillStyle = color;
			ctx.clearRect(0, 0, dimensions[0], dimensions[1]);

			drawBoxes(ctx, boxes, dimensions);
		}
		*/
	});

	$effect(() => {
		requestCanvasUpdate();
	})

	function requestCanvasUpdate() {
		if (!worker || !viewport) {
		console.log('missing viewport');
			return;
		}
		/*
		// const canvas = document.getElementById('isochronesCanvasRenderer') as HTMLCanvasElement;
		const canvas = document.createElement('canvas');
		canvas.width = viewport[0];
		canvas.height = viewport[1];
		let renderCanvas = canvas.transferControlToOffscreen();
		*/

		untrack(() => {
		worker!.postMessage({
			method: 'render',
			boundingBox: $state.snapshot(boundingBox),
			// canvas: renderCanvas,
			dimensions: $state.snapshot(viewport),
		});
		// }, [renderCanvas]);
		});
	}

	function redrawCanvas(renderCanvas: OffscreenCanvas) {
		if (!map || !viewport) {
			return;
		}
		const source = map.getSource(name) as CanvasSource;
		source.setCoordinates(boxCoords);
		const canvas = source.canvas;
		// const renderCanvas = document.getElementById('isochronesCanvasRenderer') as HTMLCanvasElement;
		canvas.width = viewport[0];
		canvas.height = viewport[1];

		const ctx = canvas.getContext('2d');
		if (!ctx) {
			return;
		}
		ctx.drawImage(renderCanvas, 0, 0);
	}

	/*
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
	*/

	// function drawCircles(ctx: CanvasRenderingContext2D, circles: CircleType[], dimensions: number[]) {
		/*
		let newCanvas = document.createElement('canvas');
		newCanvas.width = dimensions[0];
		newCanvas.height = dimensions[1];
		let canvas = newCanvas.transferControlToOffscreen();

		if (renderWorker !== undefined) {
			renderWorker.terminate();
		}
		// return;
		renderWorker = new RenderWorker();
		// renderWorker.items = $state.snapshot(circles);
		renderWorker.onmessage = (event) => {
		console.log('GOT UPDATE');
			const done = event.data;
			ctx.drawImage(newCanvas, 0, 0);
			if (done) {
				renderWorker?.terminate();
				renderWorker = undefined;
			}
		};
		renderWorker.postMessage({
			boundingBox: $state.snapshot(boundingBox),
			// canvas: ctx,
			canvas: canvas,
			dimensions: dimensions,
			items: $state.snapshot(circles),
		}, [canvas]);
		*/
	// }

	/*
	function runRenderer(ctx: CanvasRenderingContext2D, worker: Worker, dimensions: number[]) {
		let newCanvas = document.createElement('canvas');
		newCanvas.width = dimensions[0];
		newCanvas.height = dimensions[1];
		let canvas = newCanvas.transferControlToOffscreen();

		worker.onmessage = (event) => {
		console.log('GOT UPDATE');
			const done = event.data;
			ctx.drawImage(newCanvas, 0, 0);
			if (done) {
				renderWorker?.terminate();
				renderWorker = undefined;
			}
		};
		worker.postMessage({
			boundingBox: $state.snapshot(boundingBox),
			canvas: canvas,
			dimensions: dimensions,
		}, [canvas]);
	}
	*/
</script>

<canvas id="isochronesCanvas">Canvas not supported</canvas>
<canvas id="isochronesCanvasRenderer" hidden>Canvas not supported</canvas>
