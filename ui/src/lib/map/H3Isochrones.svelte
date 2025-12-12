<script lang="ts">
	// import { onMount } from 'svelte';
	import * as h3 from 'h3-js';
	import type { GeoJSONSource, Map } from 'maplibre-gl';
	import type { IsochronesOptions } from '$lib/map/IsochronesShared';
	import type { GeoJSON } from 'geojson';

	let {
		map,
		data,
		active,
		// opacity
		options
	}: {
		map: Map | undefined;
		data: h3.H3Index[];
		active: boolean;
		// opacity: number;
		options: IsochronesOptions;
	} = $props();

	let isochrones = $state<GeoJSONSource | undefined>(undefined);
	const layerName = 'isochrones-h3';
	// const emptyGeometry: GeoJSON = { type: 'LineString', coordinates: [] };

	// onMount(() => {});
	$effect(() => {
		// console.log('Testing ...');
		if (!map || !options) {
			// if (!map || !active) {
			return;
		}
		// console.log('Defined!');
		const coordinates: h3.CoordPair[][][] = h3.cellsToMultiPolygon(data, true);
		// console.log(coordinates);
		const polygon: GeoJSON = { type: 'MultiPolygon', coordinates: coordinates };
		// console.log(polygon);

		if (isochrones === undefined) {
			// console.log('Adding layer...');
			// const name = 'h3isochrones';
			map.addSource(layerName, {
				type: 'geojson',
				data: polygon
			});
			map.addLayer({
				id: layerName,
				type: 'fill',
				source: layerName,
				paint: {
					'fill-color': options.color,
					'fill-opacity': options.opacity / 1000
				}
			});
			isochrones = map.getSource(layerName) as GeoJSONSource;
		} else {
			// console.log('OK');

			isochrones.setData(polygon);
		}
	});

	$effect(() => {
		if (!map || !isochrones) {
			return;
		}
		map.setPaintProperty(layerName, 'fill-opacity', options.opacity / 1000);
	});

	$effect(() => {
		if (!map || !isochrones) {
			return;
		}
		map.setPaintProperty(layerName, 'fill-color', options.color);
	});
</script>
