<script lang="ts">
	import LoaderCircle from "lucide-svelte/icons/loader-circle";
	import type { IsochronesOptions } from "./map/IsochronesShared";


	let {
		options
	}: {
		options: IsochronesOptions;
	} = $props();
</script>

<div>
	{#if options.status == 'WORKING'}
		<div class="flex items-center justify-center w-full">
			<LoaderCircle class="animate-spin w-12 h-12 m-20" />
		</div>
	{/if}
	{#if options.status == 'FAILED'}
		<div>
			<h3>TODO Failed</h3>
		</div>
	{/if}
</div>