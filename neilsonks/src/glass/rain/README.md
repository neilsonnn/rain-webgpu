# Rain on the greenhouse

The live scene now uses `storm/`: a deliberately direct, impact-led storm with simple glass beads, contact rims, reactive plants, a suspended tin sculpture and roof runoff chains. The previous reservoir/hydrology implementation remains in `water.ts`, `hydrology.ts` and `fluid/` for reference; it is no longer mounted by the Earlier scene.

## Controls and defaults

**Deluge** selects a high-density storm. The page opens with the saved Original settings. Drizzle, Shower and Downpour are intensity shortcuts. The controls below are included when saving or exporting settings.

- Airborne density goes to 8×. Glass strike rate independently goes to 64×. Deluge selects 4.5× and 32× respectively.
- Gusts and turbulence deepen the contrast between squalls and lulls. Squall speed changes how fast the field travels and evolves. Set it to zero to freeze the pattern while drops continue falling. Squall size sets the size of its patches in metres. Wind direction and strength steer them.
- Rain size, falling speed, direction, wind strength, incidence and turbulence affect the particles that actually collide.
- Camera shake is driven by pane contacts and respects reduced motion. Pane impacts use normal-map contact rims; individual impacts do not emit splash particle bursts.
- Friction, runoff, surface tension, meander and trail persistence tune the simple pane particles.
- The tin-roof recording follows ambient rain. One glass recording fades with the strongest real brush contact and its release patter. Multiple contacts share that player and volume ceiling. Selecting the glass recording uses touch audio alone. Ambience volume controls playback. Roof runoff controls the water on the two chains.
- Left-click or touch for a short patter with a dense center and a soft edge. Held contacts keep adding water independently. A drag pushes existing beads. Right-drag or swipe with two fingers to orbit. Scroll or pinch to zoom.
- Every represented pane hit briefly draws a moving refracting bead and neck, regardless of its chance of leaving a lasting bead. Impact footprint adjusts the initial rim, and Impact smear duration sets its short lifetime. Defaults are 1.4× and 120 ms. The transient and lasting beads share the incoming direction and randomized inheritance.
- Under **Rain brush**, set the radius in screen pixels, the flow multiplier reached on a long hold, the time to reach it, and the duration of the fading patter after release.
- **Debug → Rain shower → Debug rain touches** holds one full-pressure touch at the upper middle and scatters taps of varying durations around the center. It also works with ambient rain off.

## Native WebGPU particles

`storm/compute.ts` advances pools of 65,536 airborne drops, 65,536 spray particles, 16,384 beads, 65,536 contact smears and 65,536 trail segments. A shared 40 × 40 weather map steers airborne arrivals and concentrates direct strikes into moving squalls. A precomputed alias table selects a pane location in constant time per strike. The rendering also samples this map for the finer airborne drops and surface patter.

Deluge targets about 495,000 direct contacts per simulation second on the full Original pane before gust modulation. At maximum glass strike rate and incidence the nominal target is 1,025,280. WebGPU processes the full direct arrival rate. Every hit contributes water at its landing coordinates through a contact bead, an existing cap or the persistent film. Deposited volume scales with the cube of the diameter. Bead formation controls the probability that a contact leaves an individual bead. Inherited bead velocity sets the upper limit of a random fraction of incoming tangential velocity for each new bead. Zero gives new beads zero initial tangential velocity. Gravity, friction, surface tension and wind subsequently govern their motion. Contacts that do not form a bead still feed the persistent water film. The FPS panel reports physical airborne contacts and total direct pane hits per wall-clock second. Airborne density above 1× adds up to 126,000 lightweight visual drops across the front and rear volumes.

Swept rain segments intersect the pane or the nearest moving leaf/sculpture proxy. Pane contacts produce normal-map contact rims and retained water, with the incoming velocity shaping the smear and the bead momentum. A small asynchronous feedback queue returns selected contacts to the existing branch and leaf solver; there is no particle-state readback. Roof and leaf runoff can hit further leaves. Ordinary spray does not recursively generate new sprays.

A 16,384-bucket spatial hash is rebuilt from current leaf and sculpture frames. GPU collision traversal replaces the previous CPU per-particle intersection loop. Plant mechanics retain small fixed substeps and receive angular impulses with the original lever arms, stiffness and retained-water loading. Up to 256 impact events and aggregate pane pressure are read back through three reusable staging buffers. When every readback buffer is busy, the GPU continues drawing hits and the mechanical solver receives the next available batch.

New beads use free slots; a full pool keeps existing runners alive and routes excess arrivals into the film. Rain overlapping an existing bead feeds its mass and tangential momentum directly, independently of the chance of forming a new bead. New births have no hardcoded probability beyond the Bead formation setting and no minimum age gate. Bead lifetime sets the upper limit of a random lifetime, ranging from 20% to 100% of the selected value. Default formation is 25%, maximum inherited velocity is 14%, and maximum lifetime is 24 seconds. The controls are saved and exported with the scene.

## Rendering and compatibility

The existing Three WebGL glass renderer is retained. A native WebGPU pass packs particle state into an unattached canvas; a WebGL vertex texture decodes it for instanced front/back rain and analytic water caps. The data uses two color channels and opaque alpha so canvas premultiplication cannot corrupt positions. Each frame imports that atlas once. This interoperability has a real copy/synchronization cost and has not been benchmarked for this revision.

A 1536-square half-float target stores bead/trail gradients, height and coverage. The existing water/glass refraction and Fresnel treatment consumes it directly. Individual beads use the earlier inertial motion, variable pinning, drag and pooled trails. The uniform-speed cell solver has been reverted. The persistent film uses full-float history so small drying steps remain representable even at a long decay setting.

The simulation requires WebGPU. Unsupported devices see “Please open on a WebGPU compatible device.” There is no CPU simulation fallback. Shader compilation details are logged on startup failures. The Three.js renderer still uses WebGL to draw the greenhouse and consume the WebGPU particle atlas. The FPS counter opens CPU and GPU frame timings.

### Bead and trail parity

`storm/pane-compute.ts` restores the surface behavior of the earlier `SurfaceWater` implementation on the GPU: filtered glass relief and crest slopes, contact pinning, inertial arrival, Coulomb friction, viscous drag, variable mobility, evaporation, swept bead collection, volume-weighted momentum, sideways capillary deflection, and wet-track collection and guidance. Local 128 × 128 bead and track lists replace all-pairs searches. Separate proposal/resolution passes merge disjoint mutual pairs; each track has a single collector per frame to avoid duplicating its water. Neighborhood traversal has fixed per-cell budgets (128 beads, 64 tracks), so extreme overlaps resolve over successive frames instead of causing an unbounded search. This preserves the behaviors, not the CPU iteration order.

Trails follow the full traveled path, including very slow movement. A runner extends its attached segment continuously, closing it and starting the next at the same endpoint after approximately 9 mm of travel. Its size and wetness determine the water left behind. Tracks contain actual water volume, fade with Wet trail persistence and can be collected by another bead; a bead cannot collect its own current water trail. The 65,536-slot track pool uses expired slots first, then recycles unattached segments older than half a second, returning their remaining water to the film. Attached segments are protected. New bead births do not replace live runners. The active-water window includes bead lifetime plus the time needed for its final trails to dry.

## Sculpture and roof chains

`storm/hanging.ts` builds a small asymmetric assemblage from a hollow lathed tin cup, a flat tab, a shallow bowl, thin suspension wires and a crossbar. Independent pendulums and torsion respond to the same contact data that creates sprays. Moving collider frames follow their visible bodies. The tin-roof ambience follows the shower. A single glass loop follows real pointer flow, including holds and the release tail. The virtual debug touches are silent. Individual particle and sculpture hits do not trigger audio. The recordings and licenses are credited in the Rain shower panel.

Two instanced chains sit on the far right behind the plant, with alternating oval metal links and roof outlets. A procedural physical-material shell adds descending runnels, beads, surface normals and broken coverage around the links. Rain fills and drains the roof-flow envelope gradually. Drops shed along the chains enter the storm's existing particle pool. The chain film is an art-directed water shader, not a simulated roof catchment.

## Revision status

The timings below describe an earlier renderer. The FPS panel reports current frame costs and arrival rates directly on the device.

## Historical profile — before the persistent-fluid rewrite

Two approximately six-second captures in the in-app browser, after warm-up, using the local saved Original settings: intensity 1, pane arrival density 4, Rain size 1.88×, and a 1353×1228 drawing buffer. CPU timings instrumented scene phases; asynchronous WebGL timer queries measured GPU time. The temporary profiler was removed afterward. This is a small development-mode sample, not a cross-device benchmark or visual review.

| Measurement | Refractive airborne rain | Faint white airborne rain |
| --- | ---: | ---: |
| Mean frame interval | 67.4 ms | 66.4 ms |
| Mean CPU rain simulation / frame | 66.3 ms | 65.8 ms |
| Mean GPU time / frame | 19.4 ms | 19.8 ms |
| Median GPU time / frame | 19.4 ms | 18.7 ms |
| Renderer texture count | 16 | 15 |

That implementation was CPU-bound at about 15 frames/s. Sampled inner-function estimates attribute about 33 ms/frame to swept leaf intersection searches and 14 ms/frame to pane impact handling. These are approximate subsets of the rain simulation total, not extra costs to add to it. Pane bead stepping averages 4.8 ms/frame, plant dynamics 2.7 ms/frame, and plant collider updates 1.4 ms/frame. Slow frames run up to six 120 Hz simulation steps, multiplying repeated collision and full-pool impact searches.

The shader change removes a full-resolution half-float snapshot (about 12.7 MiB at this resolution), its copies, and one particle attribute buffer. The short sample does not establish a meaningful overall frame-rate improvement. This rewrite addresses collision lookup, pane impact handling, and catch-up scheduling. It has not been profiled; the table is not a measurement of the new solver.

Background references: [WebGPU specification and canvas interoperability](https://www.w3.org/TR/webgpu/), [WGSL](https://www.w3.org/TR/WGSL/), [heuristic simulation of water drops and flows on glass panes](https://www.sciencedirect.com/science/article/pii/S0097849313001295), [contact-angle hysteresis and droplet sliding](https://pubs.rsc.org/en/content/articlehtml/2025/cc/d5cc03046c), and [leaf bending, twisting and flapping after impact](https://pubmed.ncbi.nlm.nih.gov/31910403/).
