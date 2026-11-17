import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { dielectricFresnel } from '../earlier/optics'
import { exampleDefaults } from './examples'
import type { ExampleKind, ExampleValues } from './examples'
import type { createGuideRenderer } from './renderer'
import './style.css'

function Example({ kind, description, label, hint, value, min, max, step = .01, display, onChange, children, caption }: {
  kind: ExampleKind; description: string; label: string; hint: string; value: number; min: number; max: number; step?: number
  display: string; onChange: (kind: ExampleKind, value: number) => void; children?: ReactNode; caption: ReactNode
}) {
  return <figure className="glass-guide-example">
    <div className={`glass-guide-view glass-guide-view-${kind}`} data-glass-example={kind} role="img" aria-label={description}>
      {kind === 'roughness' && <div className="glass-guide-view-labels" aria-hidden="true"><span>Polished</span><span>Your surface</span></div>}
      {kind === 'diffusion' && <div className="glass-guide-view-labels" aria-hidden="true"><span>3 cm from glass</span><span>{Math.round(value * 100)} cm from glass</span></div>}
      {kind === 'fresnel' && <div className="glass-guide-ray-labels" aria-hidden="true"><span>Air</span><span>Glass · IOR 1.52</span></div>}
    </div>
    <div className="glass-guide-controls">
      <label htmlFor={`glass-study-${kind}`} title={hint}><span>{label}</span><output htmlFor={`glass-study-${kind}`}>{display}</output></label>
      <input id={`glass-study-${kind}`} title={hint} type="range" min={min} max={max} step={step} value={value}
        aria-valuetext={display} aria-describedby={`glass-study-${kind}-caption`} onChange={event => onChange(kind, Number(event.target.value))} />
      {children}
    </div>
    <figcaption id={`glass-study-${kind}-caption`}>{caption}</figcaption>
  </figure>
}

export default function GlassGuide({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null), scroll = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const engine = useRef<ReturnType<typeof createGuideRenderer> | null>(null)
  const [values, setValues] = useState<ExampleValues>({ ...exampleDefaults })
  const current = useRef(values), [unavailable, setUnavailable] = useState(false)
  current.current = values
  const change = (kind: ExampleKind, value: number) => {
    current.current = { ...current.current, [kind]: value }
    setValues(current.current); engine.current?.invalidate()
  }
  useLayoutEffect(() => {
    const element = dialog.current!, previousFocus = document.activeElement as HTMLElement | null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    element.showModal()
    if (scroll.current) scroll.current.scrollTop = 0
    closeButton.current?.focus({ preventScroll: true })
    return () => {
      element.close(); document.body.style.overflow = previousOverflow
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true })
    }
  }, [])
  useEffect(() => {
    let cancelled = false
    void import('./renderer').then(({ createGuideRenderer }) => {
      if (cancelled || !canvas.current || !scroll.current) return
      engine.current = createGuideRenderer(canvas.current, scroll.current, () => current.current, () => { if (!cancelled) setUnavailable(true) })
    }).catch(error => {
      if (cancelled) return
      console.warn('Glass guide examples unavailable.', error); setUnavailable(true)
    })
    return () => { cancelled = true; engine.current?.dispose(); engine.current = null }
  }, [])
  const fresnel = dielectricFresnel(Math.cos(values.fresnel * Math.PI / 180), 1, 1.52) * 100
  const refracted = Math.asin(Math.sin(values.fresnel * Math.PI / 180) / 1.52) * 180 / Math.PI
  return <dialog ref={dialog} id="glass-guide" className={`glass-guide ${unavailable ? 'glass-guide-static' : ''}`} aria-labelledby="glass-guide-title" aria-describedby="glass-guide-intro"
    onCancel={event => { event.preventDefault(); onClose() }}>
    <div ref={scroll} className="glass-guide-scroll">
      <canvas ref={canvas} className="glass-guide-canvas" aria-hidden="true" />
      <article className="glass-guide-essay">
        <header className="glass-guide-header">
          <span>A small field guide</span>
          <button type="button" title="Resume the greenhouse" onClick={onClose} aria-label="Close glass guide and return to the scene">Back to the rain <span aria-hidden="true">↗</span></button>
        </header>
        <div className="glass-guide-introduction">
          <h1 id="glass-guide-title">Through the glass.</h1>
          <p id="glass-guide-intro">A sheet of glass bends, reflects and scatters light. A shader describes how those effects become the image you see. These small studies take the greenhouse apart, one idea at a time.</p>
          <p className="glass-guide-aside">Move a slider. Watch what changes. The greenhouse rests while you read.</p>
          {unavailable && <p className="glass-guide-unavailable" role="status">The interactive illustrations could not start on this device. You can still read the guide and use the numerical examples.</p>}
        </div>

        <section aria-labelledby="glass-guide-wire-title">
          <h2 id="glass-guide-wire-title"><span>01</span> Glass around metal</h2>
          <p>The grid is a steel mesh embedded inside the pane. Each strand has a curved surface that catches light. The glass around it refracts the view of the metal; the rolled, pebbled glass surface adds its own texture.</p>
          <p>In graphics, glass is a <dfn>dielectric</dfn>: it reflects some light and can transmit the rest. Steel is a <dfn>conductor</dfn>: at this thickness it reflects and absorbs light, rather than letting us see through it.</p>
          <Example kind="wire" hint="Thicken the embedded strands" description="An enlarged glass slab with cylindrical metal strands embedded inside it. The slider changes their diameter."
            label="Wire diameter" min={.3} max={2} step={.05} value={values.wire} display={`${values.wire.toFixed(2)} mm`} onChange={change}
            caption="An enlarged study. Thicker strands have broader silhouettes and highlights." />
        </section>

        <section aria-labelledby="glass-guide-ior-title">
          <h2 id="glass-guide-ior-title"><span>02</span> Index of refraction</h2>
          <p><dfn>IOR</dfn> measures how slowly light travels through a material compared with a vacuum. When light crosses between materials with different IORs at an angle, it bends. That bend is <dfn>refraction</dfn>.</p>
          <p>Air is close to 1.00, water to 1.33, and ordinary glass to 1.5–1.6. Shape and thickness matter too: a curved bead acts like a lens, while a flat, parallel pane mainly shifts the view sideways.</p>
          <Example kind="ior" hint="Bend the background stripes" description="A clear sphere in front of a striped background. Increasing the index of refraction changes the lens distortion."
            label="Index of refraction" min={1} max={2.2} value={values.ior} display={values.ior.toFixed(2)} onChange={change}
            caption={<>At this IOR, a smooth air–material boundary reflects about {(((values.ior - 1) / (values.ior + 1)) ** 2 * 100).toFixed(1)}% of light straight on.</>}>
            <div className="glass-guide-presets" role="group" aria-label="Example indices of refraction">
              {([['Air', 1], ['Water', 1.33], ['Glass', 1.52]] as const).map(([name, value]) => <button key={name} type="button" title={`Use the IOR of ${name.toLowerCase()}`} aria-pressed={Math.abs(values.ior - value) < .005} onClick={() => change('ior', value)}>{name} <span>{value.toFixed(2)}</span></button>)}
            </div>
          </Example>
        </section>

        <section aria-labelledby="glass-guide-fresnel-title">
          <h2 id="glass-guide-fresnel-title"><span>03</span> Fresnel: the angle matters</h2>
          <p>Look straight through a clean window and you mostly see what is behind it. Look along its surface and the reflection becomes stronger. The <dfn>Fresnel effect</dfn> describes this change with angle.</p>
          <p>For glass with an IOR of 1.52, one smooth air–glass boundary reflects roughly 4% of light straight on, rising toward 100% at a grazing angle. In the diagram, the dotted line is the surface normal: angles are measured from that line.</p>
          <Example kind="fresnel" hint="Tilt the incoming ray" description="A ray reaches a horizontal air–glass boundary. A white ray reflects upward; a green ray bends into the glass. The slider changes the incident angle."
            label="Incoming angle" min={0} max={89} step={1} value={values.fresnel} display={`${values.fresnel}°`} onChange={change}
            caption={<><span className="glass-guide-reading">Reflected {fresnel.toFixed(1)}% · Refracted angle {refracted.toFixed(1)}°</span>One smooth boundary, with unpolarized light. Beam brightness is illustrative.</>} />
        </section>

        <section aria-labelledby="glass-guide-roughness-title">
          <h2 id="glass-guide-roughness-title"><span>04</span> Specular &amp; roughness</h2>
          <p>A <dfn>specular reflection</dfn> is the directional reflection that produces a highlight or a recognizable reflection of the surroundings. The highlight is a light source appearing on the surface.</p>
          <p><dfn>Roughness</dfn> describes variation in surface direction at a microscopic scale. A polished surface gives a tight reflection. A rougher surface spreads it over more directions, making the highlight wider and softer. Here the light stays fixed.</p>
          <Example kind="roughness" hint="Broaden the reflected highlight" description="Two green spheres share the same lighting. The left stays polished; the slider changes the right sphere's roughness."
            label="Surface roughness" min={.02} max={.85} value={values.roughness} display={values.roughness.toFixed(2)} onChange={change}
            caption="Compare the shape of the reflection, not just its brightness. Roughness also softens light transmitted through glass." />
        </section>

        <section aria-labelledby="glass-guide-normal-title">
          <h2 id="glass-guide-normal-title"><span>05</span> Normals &amp; the pebbled surface</h2>
          <p>A <dfn>normal</dfn> is the direction a small patch of surface faces. Change that direction and both the reflection and refraction change.</p>
          <p>A <dfn>normal map</dfn> stores these small tilts in a texture. It gives a simple mesh the lighting of a bumpy surface without adding thousands of polygons. Notice how the view warps while the pane’s outline stays the same. Roughness describes finer detail; normals describe the larger, visible ripples.</p>
          <Example kind="normals" hint="Deepen the surface texture" description="A glass pane over a striped background. Increasing surface relief distorts the view and breaks up reflections while leaving the pane outline fixed."
            label="Surface relief" min={0} max={1.2} value={values.normals} display={values.normals === 0 ? 'Flat' : `${values.normals.toFixed(2)}×`} onChange={change}
            caption="The greenhouse combines surface relief with separate shading for the embedded wire." />
        </section>

        <section aria-labelledby="glass-guide-diffusion-title">
          <h2 id="glass-guide-diffusion-title"><span>06</span> Transmission, diffusion &amp; depth</h2>
          <p><dfn>Transmission</dfn> is light passing through a material. Textured glass scatters that light across a range of directions. In this scene, we call the resulting softness <dfn>diffusion</dfn>.</p>
          <p>Distance magnifies the effect: the same spread of angles covers a small patch on a leaf near the pane and a much wider patch farther away. This is why the close leaves can stay readable while the deep garden dissolves into color. It is different from a camera focusing on one distance.</p>
          <Example kind="diffusion" hint="Move foliage behind glass" description="The same leaf pattern appears close to glass on the left and farther behind glass on the right. Increasing distance makes the right pattern softer."
            label="Distance behind glass" min={.03} max={2} value={values.diffusion} display={`${Math.round(values.diffusion * 100)} cm`} onChange={change}
            caption="A simplified depth-blur study: both patterns keep the same apparent size so you can isolate the softness." />
        </section>

        <section aria-labelledby="glass-guide-light-title">
          <h2 id="glass-guide-light-title"><span>07</span> The light, then the image</h2>
          <p>An <dfn>environment map</dfn> surrounds the scene with an image of incoming light. Its bright openings appear in the glass and metal. <dfn>HDR</dfn> means the image can carry values brighter than the white a screen can display.</p>
          <p><dfn>Exposure</dfn> scales that light; one stop doubles it. <dfn>Tone mapping</dfn> fits the bright-to-dark range onto a display. The color grade then shapes the contrast, saturation and black level that give this greenhouse its mood.</p>
          <Example kind="lighting" hint="Adjust exposure in stops" description="A lit green sphere changes brightness with exposure, showing how a fixed material responds to image brightness adjustments."
            label="Exposure" min={-2} max={2} step={.1} value={values.lighting} display={`${values.lighting > 0 ? '+' : ''}${values.lighting.toFixed(1)} stops`} onChange={change}
            caption={<>The light is multiplied by {(2 ** values.lighting).toFixed(2)}× before tone mapping. The material stays the same.</>} />
        </section>

        <footer className="glass-guide-footer">
          <p>The greenhouse combines these effects: a lit garden, two glass surfaces, embedded metal and, in rain, a layer of water. These studies isolate the pieces so you can see what each one does.</p>
          <p className="glass-guide-sources">Read further: <a href="https://www.pbr-book.org/4ed/Reflection_Models/Specular_Reflection_and_Transmission" target="_blank" rel="noreferrer">Refraction &amp; Fresnel</a> · <a href="https://www.pbr-book.org/4ed/Reflection_Models/Rough_Dielectric_BSDF" target="_blank" rel="noreferrer">Rough glass</a> · <a href="https://threejs.org/docs/pages/MeshStandardMaterial.html" target="_blank" rel="noreferrer">Surface textures</a> · <a href="https://threejs.org/docs/pages/MeshPhysicalMaterial.html" target="_blank" rel="noreferrer">Three.js materials</a></p>
          <button type="button" className="glass-guide-return" title="Resume the greenhouse" onClick={onClose}>Back to the rain <span aria-hidden="true">↗</span></button>
        </footer>
      </article>
      <button ref={closeButton} type="button" className="glass-guide-close" onClick={onClose} aria-label="Close glass guide" title="Close (Escape)"><span aria-hidden="true">×</span></button>
    </div>
  </dialog>
}
