# rain-webgpu

A standalone React and Three.js greenhouse with wired patterned glass, procedural foliage, interactive WebGPU rain and ambient recordings.

## Run locally

Use Node.js 22 or newer. Run from this repository root:

```sh
npm ci
npm run dev
```

Open http://127.0.0.1:5173/. The previous http://127.0.0.1:5173/glass/ address also works. WebGPU is required for the rain simulation. The greenhouse is drawn with Three.js/WebGL.

Left-click or touch to add water. Hold or drag to continue. Right-drag or swipe with two fingers to orbit. Scroll or pinch to zoom. The cloud in the lower left toggles ambient rain.

## Settings and scene versions

Local development also shows the debug controls and frame timings.

**Save page defaults** writes to `src/glass/default-presets.json` during local development. **Export JSON** makes a recovery copy. Existing browser storage keys are retained so the extraction does not discard saved settings. Earlier compositions and the Current study remain available through the archived scenes controls in development.

## Build

```sh
npm run build
npm run preview
```

Publish `dist/` to a static host. The build includes both `/` and `/glass/` entry pages. This repository has a build-only GitHub Actions workflow; it has no deployment configuration tied to the original portfolio. `npm run check` runs TypeScript and the glass tests.

## Source

- `src/glass/`: scenes, shaders, procedural plants and controls.
- `src/glass/rain/`: rain and water simulation; [implementation notes](src/glass/rain/README.md).
- `public/audio/`: the two attributed ambient recordings.
- `public/images/glass/`: the original visual reference.

The saved composition, audio attribution, simulation behavior and archived glass versions are retained from the original project. Source recording links and licenses are also available in the Rain shower controls:

- [digifishmusic — rain on tin roof](https://freesound.org/people/digifishmusic/sounds/66472/) — CC BY 4.0.
- [willpio — rain on glass](https://freesound.org/people/willpio/sounds/317677/) — CC BY-NC 3.0.

The original site draft PR is https://github.com/neilsonnn/site/pull/2, checkpoint `6a3b956`. The complete pre-extraction website snapshot remains in this repository's first commit, `2e09ab8`.
