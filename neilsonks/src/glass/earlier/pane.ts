import { BoxGeometry, Group, Mesh, MeshBasicMaterial, MeshPhysicalMaterial, PlaneGeometry } from 'three'
import type { GlassSettings } from './settings'

export interface PaneSize { width: number; height: number; centerY: number }

export function createPane(material: MeshPhysicalMaterial, size?: PaneSize) {
  const group = new Group(), geometry = new PlaneGeometry(size?.width ?? 32, size?.height ?? 32)
  const front = new Mesh(geometry, material)
  front.position.y = size?.centerY ?? 0
  group.add(front)
  const rear = size ? new Mesh(geometry, material) : undefined
  const edgeGeometry = size ? new BoxGeometry(size.width, size.height, 1) : undefined
  const edgeMaterial = new MeshPhysicalMaterial({ color: '#a4b9a4', metalness: 0, roughness: .17,
    transparent: true, opacity: .55, depthWrite: false, envMapIntensity: .7, ior: 1.52 })
  const hidden = new MeshBasicMaterial({ visible: false })
  const edges = edgeGeometry ? new Mesh(edgeGeometry, [edgeMaterial, edgeMaterial, edgeMaterial, edgeMaterial, hidden, hidden]) : undefined
  if (rear) { rear.rotation.y = Math.PI; rear.position.y = size!.centerY; group.add(rear) }
  if (edges) { edges.position.y = size!.centerY; group.add(edges) }
  return {
    group, front, rear, edges,
    update(settings: GlassSettings) {
      if (rear) rear.position.z = -settings.thickness
      if (edges) { edges.position.z = -settings.thickness * .5; edges.scale.z = settings.thickness }
      edgeMaterial.ior = settings.ior
    },
    dispose() { geometry.dispose(); edgeGeometry?.dispose(); edgeMaterial.dispose(); hidden.dispose() },
  }
}
