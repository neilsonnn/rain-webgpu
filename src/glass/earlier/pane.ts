import { BoxGeometry, Group, Mesh, MeshPhysicalMaterial, PlaneGeometry } from 'three'
import type { GlassSettings } from './settings'

export interface PaneSize { width: number; height: number; centerY: number }
export const standalonePaneSize: PaneSize = { width: 3.6, height: 3.6, centerY: 1.8 }

export function createPane(material: MeshPhysicalMaterial, size?: PaneSize) {
  const group = new Group(), geometry = new PlaneGeometry(size?.width ?? 32, size?.height ?? 32)
  const front = new Mesh(geometry, material)
  front.position.y = size?.centerY ?? 0
  group.add(front)
  const edgeGeometry = size ? new BoxGeometry(size.width, size.height, 1) : undefined
  const edgeMaterial = new MeshPhysicalMaterial({ color: '#a4b9a4', metalness: 0, roughness: .17,
    transparent: true, opacity: .55, depthWrite: false, envMapIntensity: .7, ior: 1.52 })
  if (edgeGeometry) {
    // BoxGeometry orders ±X and ±Y before ±Z. Keep just the four cut edges.
    edgeGeometry.setIndex(Array.from(edgeGeometry.getIndex()!.array.slice(0, edgeGeometry.groups[4].start)))
    edgeGeometry.clearGroups()
  }
  const edges = edgeGeometry ? new Mesh(edgeGeometry, edgeMaterial) : undefined
  if (edges) { edges.position.y = size!.centerY; group.add(edges) }
  return {
    group, front, edges,
    update(settings: GlassSettings) {
      if (edges) { edges.position.z = -settings.thickness * .5; edges.scale.z = settings.thickness }
      edgeMaterial.ior = settings.ior
    },
    dispose() { geometry.dispose(); edgeGeometry?.dispose(); edgeMaterial.dispose() },
  }
}
