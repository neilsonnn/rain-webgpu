export const exampleDefaults = {
  wire: .8, ior: 1.52, fresnel: 35, roughness: .3, normals: .55, diffusion: .8, lighting: 0,
} as const
export type ExampleKind = keyof typeof exampleDefaults
export type ExampleValues = Record<ExampleKind, number>
