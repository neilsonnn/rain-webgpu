import { BufferGeometry, Float32BufferAttribute, Vector3 } from 'three'

export function foldedLeaf(halfWidth: number, shoulder: number, tipDepth: number, cup: number) {
  // Share a single vertex at each end. The center column follows the midrib.
  const rows = 15, columns = 5
  const positions = [0, 0, 0], uv = [.5, 0], indices: number[] = []
  for (let row = 1; row <= rows; row++) {
    const t = row / (rows + 1), arch = Math.sin(Math.PI * t)
    const phase = t < shoulder ? t / shoulder : 1 + (t - shoulder) / (1 - shoulder)
    const width = halfWidth * Math.sin(phase * Math.PI / 2) ** .8
    for (let column = 0; column < columns; column++) {
      const u = column / (columns - 1), side = u * 2 - 1
      const fold = .055 * (1 - Math.abs(side)) - cup * side * side
      positions.push(side * width, t, fold * arch - tipDepth * t ** 3)
      uv.push(u, t)
      if (column === columns - 1) continue
      const a = 1 + (row - 1) * columns + column
      if (row === 1) indices.push(0, a + 1, a)
      if (row < rows) indices.push(a, a + 1, a + columns, a + 1, a + columns + 1, a + columns)
      else indices.push(a, a + 1, 1 + rows * columns)
    }
  }
  positions.push(0, 1, -tipDepth)
  uv.push(.5, 1)
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new Float32BufferAttribute(uv, 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

// Keep the authored bend in leaf stalks and the attachment nodes on longer shoots.
export function stemTube(points: Vector3[], radius: number, tipScale: number) {
  const sides = points.length > 3 ? 6 : 4
  const positions: number[] = [], normals: number[] = [], indices: number[] = []
  const tangent = new Vector3(), across = new Vector3(), up = new Vector3(), radial = new Vector3()
  const last = points.length - 1
  for (let ring = 0; ring <= last; ring++) {
    tangent.subVectors(points[Math.min(last, ring + 1)], points[Math.max(0, ring - 1)]).normalize()
    // Project the previous ring's frame onto this ring to keep the sides continuous.
    if (ring === 0 || Math.abs(across.dot(tangent)) > .99) {
      if (Math.abs(tangent.x) < .8) across.set(1, 0, 0)
      else across.set(0, 0, 1)
    }
    across.addScaledVector(tangent, -across.dot(tangent)).normalize()
    up.crossVectors(tangent, across)
    const r = radius * (tipScale + (1 - tipScale) * (1 - ring / last) ** .6)
    for (let side = 0; side < sides; side++) {
      const angle = side * (2 * Math.PI / sides)
      radial.copy(across).multiplyScalar(Math.cos(angle)).addScaledVector(up, Math.sin(angle))
      normals.push(radial.x, radial.y, radial.z)
      positions.push(points[ring].x + radial.x * r, points[ring].y + radial.y * r, points[ring].z + radial.z * r)
      if (ring < last) {
        const a = ring * sides + side, b = ring * sides + (side + 1) % sides
        indices.push(a, b, a + sides, b, b + sides, a + sides)
      }
    }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3))
  geometry.setIndex(indices)
  return geometry
}
