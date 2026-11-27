// Decides how much visual work to ask of the device. Three tiers:
//
//   high    real glass refraction with color fringing, bloom, grain, vignette
//   medium  real glass refraction and bloom at a lower resolution
//   low     the lightweight glass, no post effects
//
// Add ?quality=low, ?quality=medium or ?quality=high to the URL to force one.
// A forced tier never changes. Otherwise the scene steps down a tier only if
// the frame rate is genuinely bad for a sustained stretch.

export const TIERS = ['low', 'medium', 'high']

// dpr is the range of screen sharpness to render at. Even the low tier goes
// above 1 so the scene is not blurry on high resolution screens.
export const SETTINGS = {
  low: { dpr: [1, 1.5], refraction: false, effects: false, dispersion: 0, samples: 0 },
  medium: { dpr: [1, 1.75], refraction: true, effects: true, dispersion: 0, samples: 0 },
  high: { dpr: [1, 2], refraction: true, effects: true, dispersion: 0.35, samples: 4 },
}

const forcedTier = () => {
  const value = new URLSearchParams(window.location.search).get('quality')
  return TIERS.includes(value) ? value : null
}

export const isForced = () => forcedTier() !== null

export function detectQuality() {
  const forced = forcedTier()
  if (forced) return forced

  let renderer = ''
  try {
    const gl = document.createElement('canvas').getContext('webgl2')
    if (!gl) return 'low'
    const info = gl.getExtension('WEBGL_debug_renderer_info')
    renderer = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : '').toLowerCase()
  } catch {
    return 'low'
  }
  // No graphics card at all, just the processor pretending to be one.
  if (/swiftshader|llvmpipe|software|basic render/.test(renderer)) return 'low'

  const cores = navigator.hardwareConcurrency || 4
  const memory = navigator.deviceMemory || 4
  const phone = window.matchMedia('(pointer: coarse)').matches && Math.min(window.screen.width, window.screen.height) < 820

  if (phone) return cores >= 6 && memory >= 4 ? 'medium' : 'low'
  if (/mali-4|adreno \(tm\) [3-5]\d\d|intel.*hd graphics/.test(renderer)) return 'medium'
  if (cores <= 4 && memory <= 4) return 'medium'
  return 'high'
}

export const stepDown = (tier) => TIERS[Math.max(0, TIERS.indexOf(tier) - 1)]

// How bad the frame rate has to be, and for how long, before stepping down.
// The bar is deliberately low. Many screens and browsers hold a page to 30
// frames a second on purpose (battery saver modes, some external displays),
// and that is a limit, not a struggling graphics card. Dropping quality there
// makes everything look worse and gains nothing.
export const GOVERNOR = {
  warmUp: 4, // seconds to ignore after load, while things are still settling
  window: 3, // seconds per measurement
  minimumFps: 20,
  strikes: 2, // bad measurements in a row before acting
}
