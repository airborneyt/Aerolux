<script>
let { state = '', text = '' } = $props();
</script>

<div class="al-status-pill">
    <span class="al-status-dot {state}"></span>
    <span>{text}</span>
</div>