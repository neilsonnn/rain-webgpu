export const stormBudget = {
  rain: 65536, spray: 65536, beads: 16384, rings: 65536, trails: 65536,
  hits: 4096, feedback: 256, commands: 832, brushCommands: 768, hash: 16384, atlasWidth: 1024,
} as const
export const stormOffsets = {
  spray: stormBudget.rain,
  beads: stormBudget.rain + stormBudget.spray,
  rings: stormBudget.rain + stormBudget.spray + stormBudget.beads,
  trails: stormBudget.rain + stormBudget.spray + stormBudget.beads + stormBudget.rings,
}
export const stormCount = stormOffsets.trails + stormBudget.trails
export const filmSide = 256
// Independent, bounded neighbor lists for bead caps and wet track segments.
export const paneGridSide = 128
export const paneGridCells = paneGridSide * paneGridSide
export const panePoolCount = stormBudget.beads + stormBudget.trails
export const paneArena = {
  links: paneGridCells * 2,
  claims: paneGridCells * 2 + panePoolCount,
  free: paneGridCells * 2 + panePoolCount + stormBudget.trails,
  incoming: paneGridCells * 2 + panePoolCount * 2 + stormBudget.trails * 2,
}
export const paneArenaWords = paneArena.incoming + stormBudget.beads * 4
export const depositOffset = stormCount * 10
// Keep data out of canvas alpha: browser premultiplication must never modify it.
export const stormAtlasHeight = Math.ceil((depositOffset + filmSide * filmSide) / stormBudget.atlasWidth)
