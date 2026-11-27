import { getProject, types } from '@theatre/core'
import state from './state.json'

// The timeline is measured in "screens of scroll": position 1 is one full
// viewport height down the page, which is where the Monday section sits.
export const SEQUENCE_LENGTH = 10.5

const project = getProject('Whiskey', { state })
export const sheet = project.sheet('Scroll')

const num = (value, min, max, step = 0.01) =>
  types.number(value, { range: [min, max], nudgeMultiplier: step })

export const bottle = sheet.object('Bottle', {
  x: num(0, -8, 8),
  y: num(-1.9, -8, 8),
  scale: num(1.25, 0.1, 4),
  spin: num(0, -10, 10), // full turns around the vertical axis
  lean: num(20, -180, 180, 0.5), // degrees of tilt. Past 90 it pours.
})

export const cork = sheet.object('Cork', {
  lift: num(0, 0, 1), // 0 is in the bottle, 1 is popped and gone
})

export const glass = sheet.object('Glass', {
  x: num(2.75, -8, 8),
  y: num(-2.75, -14, 8),
  scale: num(1.3, 0.1, 4),
})

export const liquid = sheet.object('Liquid', {
  bottleFill: num(0.5, 0, 1),
  glassFill: num(0, 0, 1),
  streamHead: num(0, 0, 1), // how far the pour has travelled toward the glass
  streamTail: num(0, 0, 1), // how far the end of the pour has travelled
})

export const camera = sheet.object('Camera', {
  z: num(14, 4, 30),
  y: num(0, -5, 5),
})

// The editor only loads in local development, and only when the URL ends
// with ?studio so the plain site is what you see by default.
export async function initStudio() {
  if (!import.meta.env.DEV) return false
  if (!new URLSearchParams(window.location.search).has('studio')) return false
  const { default: studio } = await import('@theatre/studio')
  studio.initialize()
  return true
}
