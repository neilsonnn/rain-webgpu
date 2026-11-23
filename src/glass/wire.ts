import { createWireGrid as createGrid, wireMaterials as createMaterials } from './earlier/wire'

export const wireMaterials = () => createMaterials('iron')
export const createWireGrid = (span = 8) => createGrid(span, span, 1.8, 'iron')
