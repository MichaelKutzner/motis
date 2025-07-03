<script lang="ts">
	import LoaderCircle from "lucide-svelte/icons/loader-circle";
	import ErrorMessage from "$lib/ErrorMessage.svelte";
	import type { IsochronesOptions } from "$lib/map/IsochronesShared";


	let {
		options
	}: {
		options: IsochronesOptions;
	} = $props();
</script>

<div>
	{#if options.status == 'WORKING'}
		<div class="flex items-center justify-center w-full">
			<LoaderCircle class="animate-spin w-12 h-12 m-2" />
		</div>
	{/if}
	{#if options.status == 'FAILED'}
		<ErrorMessage e="t.noItinerariesFound" />
	{/if}
</div>