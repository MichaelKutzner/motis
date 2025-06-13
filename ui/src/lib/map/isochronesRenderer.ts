import circle from '@turf/circle';
import { type LngLatBounds } from 'maplibre-gl';

self.onmessage = function(event) {
	return;
	const boundingBox = event.data.boundingBox;
	const canvas = event.data.canvas;
	const dimensions = event.data.dimensions;
	const items = event.data.items;

	let ctx = canvas.getContext("2d");

	const transform = getTransformer(boundingBox, dimensions);
	const isVisible = getIsVisible(boundingBox);

	drawCircles(ctx, items, transform, isVisible, dimensions);
	// drawCircles(canvas, items, transform, isVisible, dimensions);
}

type BoxCoordsType = [[number, number], [number, number], [number, number], [number, number]];
type CircleType = ReturnType<typeof circle>;

function getTransformer(boundingBox: LngLatBounds, dimensions: number[]) {
	return (pos: number[]) => {
		const x = Math.round(
			((pos[0] - boundingBox._sw.lng) / (boundingBox._ne.lng - boundingBox._sw.lng)) * dimensions[0]
		);
		const y = Math.round(
			((boundingBox._ne.lat - pos[1]) / (boundingBox._ne.lat - boundingBox._sw.lat)) * dimensions[1]
		);
		return [x, y];
	};
}

function getIsVisible(boundingBox: LngLatBounds) {
	return (circle: CircleType) => {
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
}

function drawCircles(ctx: CanvasRenderingContext2D, circles: CircleType[], transform: (p: number[]) => number[], is_visible: (c: CircleType) => boolean, dimensions: number[]) {
	ctx.fillStyle = 'magenta';
	ctx.clearRect(0, 0, dimensions[0], dimensions[1]);

	circles.filter(is_visible).forEach((c) => {
		ctx.save(); // Store canvas state

		const b = c.bbox!; // Existence checked in filter()
		const min = transform([b[0], b[1]]);
		const max = transform([b[2], b[3]]);
		const diff_x = max[0] - min[0];
		const diff_y = max[1] - min[1];

		if (diff_x < 2 && diff_y < 2) {
			// Draw small rect
			ctx.fillRect(min[0], min[1], diff_x + 1, diff_y + 1);
		} else {
			// Clip circle
			ctx.beginPath();
			const coords = c.geometry.coordinates[0];
			const start = transform(coords[0]);
			ctx.moveTo(start[0], start[1]);
			for (let i = 0; i < coords.length; ++i) {
				const pos = transform(coords[i]);
				ctx.lineTo(pos[0], pos[1]);
			}
			ctx.clip();

			// Fill map, clipped to circle
			ctx.fillRect(0, 0, dimensions[0], dimensions[1]);
		}

		// Restore previous state on top
		ctx.restore();
	});

	self.postMessage(true);
}
