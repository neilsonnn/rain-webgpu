// Shared by the chess scene and the city experiment.
export const CHESS_MATERIALS = [
  { color: '#ffffff', roughness: 0.35, metalness: 0.04 },
  { color: '#282a2b', roughness: 0.35, metalness: 0.06 },
] as const
export const CHESS_LIGHTING = {
  ambient: 0.12,
  sky: '#ffffff', ground: '#939087', hemisphere: 0.4,
  position: [-12, 22, -9] as [number, number, number], directional: 3.1,
  shadowMap: [4096, 4096] as [number, number], bias: -0.00001, normalBias: 0.001,
}
