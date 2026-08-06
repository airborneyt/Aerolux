<!-- src/components/modals/HelpModal.svelte -->
<!--
    help modal for velocity that gives quick info on the available features
    full list of features must be made and added to aerolux's website when that launches
    todo: rename to VelocityHelpModal
-->
<script>
let { open = $bindable(false) } = $props();
</script>

{#if open}
  <div class="al-modal-overlay " onclick={() => open = false}>
    <div class="al-modal" onclick={e => e.stopPropagation()}>
      <button class="al-modal-close" onclick={() => open = false}>×</button>
      <h2 style="margin-bottom:4px">Velocity</h2>
        <p class="al-dim" style="margin-bottom:20px;font-size:12px">A supercharged gradient builder for every Launchpad palette.</p>
        <div class="al-help-grid">
          <div>
          <p class="al-label">Gradient editor</p>
          <p class="al-help-p">Click the gradient bar to add a stop. Drag markers to reposition. Click a marker to select it (glows white), then click any palette swatch to assign that colour. Position input accepts 0–100%. Minimum 2 stops.</p>

          <p class="al-label">Algorithms</p>
          <p class="al-help-p"><strong>RGB nearest</strong> uses the closest entry in RGB space.<br><strong>Perceptual</strong> uses CIELAB interpolation for visually smooth transitions.<br><strong>HSL path</strong> travels the colour wheel. Shortest ≤180°, Longest >180°.<br><strong>Stepped</strong> utilises hard block cuts at segment midpoints.<br><strong>Vivid</strong> is like Perceptual but prefers the most saturated match.</p>

          <p class="al-label">Tint</p>
          <p class="al-help-p">Click Pick then click a palette swatch. Blends each result toward the tint colour before a second palette lookup. A white tint at moderate strength pushes deep colours into their pastel equivalents, and <vice-versa>a black tint at moderate strength pushes pastel colours into their deep equivalents.</vice-versa></p>

          <p class="al-label">Automation</p>
          <p class="al-help-p">Choose between Python automation or Airbot-assisted automation. Python automation gives you a python code that you run on your own device (to prevent security vulnerabilities). It will generate gradients based on the parameters you have input into Aerolux before generating the code.</p>
          <p class="al-help-p">Airbot automation allows Airbot to control the editor directly rather than generating palettes entirely from scratch. This allows you to generate multiple gradients that are similar in form but vary ever so slightly (e.g. in length) in a much quicker fashion, ymmv depending on your hardware.</p>
        </div>
        <div>
          <p class="al-label">Launchpad Preview</p>
          <p class="al-help-p">Select your output device. Gradient auto-sends on every change. Steps 1–8 fill row 5 on the Launchpad, steps 9–16 fill row 4.</p>
          <p class="al-help-p">You can inject an Aerolux gradient into an existing .mid file from Ableton to preview how the gradient will look like before exporting it.</p>

          <p class="al-label">Airbot (Generative)</p>
          <p class="al-help-p">Uses Gemma 4 E4B running entirely on-device via llama.cpp (privacy!). ~5 GB, cached after first download. Describe a colour theme and the model generates stop colours, algorithm, and easing. Override stops/length or leave blank for Airbot to decide. Be as detailed as possible for better results. You can upload images to generate a gradient from the colours in the image. Please do not ask it to generate you a recipe for pancakes.</p>

          <p class="al-label">Keyboard shortcuts</p>
          <p class="al-help-p">
            Use the Command <code class="al-code">Cmd</code> key if you are on a Mac.<br>
            <code class="al-code">Ctrl+Z</code> Undo &nbsp;
            <code class="al-code">Ctrl+Y</code> Redo<br>
            <code class="al-code">Ctrl+C</code> Copy output<br>
            <code class="al-code">Enter</code> in prompt → Generate<br>
            <code class="al-code">Esc</code> Deselect / close modal<br>
            <code class="al-code">R</code> Randomise stops<br>
            <code class="al-code">Delete</code> Delete selected stop
          </p>

          <p class="al-label">Export</p>
          <p class="al-help-p">Filename: Uses the gradient velocities and is formatted in a way that can be directly imported into Eyedrop, or any other software.</p>
        </div>
      </div>
      <p class="al-help-p">*Airbot is an experimental feature that is not meant to be relied upon. It is suggested you run the <strong>hardware compatibility check</strong> to determine if your hardware is capable enough to run Airbot without any diminishing returns. You will need to enable hardware acceleration for Airbot to function.</p>
    </div>
  </div>
{/if}

<style>
  .al-modal {
    height: 80vh;
    width: 80vw;
  }
</style>