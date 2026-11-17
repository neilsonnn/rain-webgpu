import { InstancedBufferGeometry, MeshStandardMaterial, PlaneGeometry, Vector2, Vector4 } from 'three'
import type { Color, DataTexture } from 'three'
import type { CityData } from './data'
import { CHESS_MATERIALS } from '../chess/render/appearance'
import { tileFragment } from './material'

export function unusedTiles(data: Pick<CityData, 'gridBounds'>, morph: { value: number }, dark: { value: Color }, occupied: DataTexture) {
  // One instanced quad per grid square, with no per-instance CPU matrices.
  // Assigned squares are degenerate; unassigned squares contract in place.
  const plane = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2), geometry = new InstancedBufferGeometry()
  geometry.setIndex(plane.index)
  for (const [name, attribute] of Object.entries(plane.attributes)) geometry.setAttribute(name, attribute)
  // Set from the current mapping each frame; the survey's baked grid size is
  // only used by the legacy forced assignment, not this adjustable board.
  geometry.instanceCount = 0
  plane.dispose()
  const uniforms = {
    uMorph: morph, uDarkTile: dark, uOccupied: { value: occupied }, uOccupiedSize: { value: new Vector2(1, 1) },
    uTileBounds: { value: new Vector4(...data.gridBounds) }, uTileSide: { value: 1 },
  }
  const material = new MeshStandardMaterial({ ...CHESS_MATERIALS[0], flatShading: true })
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = /* glsl */ `
uniform float uMorph, uTileSide;
uniform sampler2D uOccupied;
uniform vec2 uOccupiedSize;
uniform vec4 uTileBounds;
varying float cityParity;
vec3 unusedTilePosition(vec3 vertex) {
  int id = gl_InstanceID;
  int side = int(uTileSide);
  vec2 cell = vec2(id % side, id / side);
  float tileStep = (uTileBounds.y - uTileBounds.x) / uTileSide;
  vec2 center = uTileBounds.xz + (cell + .5) * tileStep;
  float occupied = texelFetch(uOccupied, ivec2(id % int(uOccupiedSize.x), id / int(uOccupiedSize.x)), 0).r;
  float extent = tileStep * (1. - occupied) * (1. - clamp(uMorph, 0., 1.));
  cityParity = float((id % side + id / side) % 2);
  return vec3(center.x + vertex.x * extent, 0., center.y + vertex.z * extent);
}
` + shader.vertexShader.replace('#include <begin_vertex>', 'vec3 transformed = unusedTilePosition(position);')
    shader.fragmentShader = tileFragment(shader.fragmentShader)
  }
  material.customProgramCacheKey = () => 'city-unused-local-v1'
  return { geometry, material, uniforms }
}
