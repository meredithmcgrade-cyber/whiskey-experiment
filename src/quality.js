// Decides how much visual work to ask of the device. Three tiers:
//
//   high    real glass refraction with color fringing, bloom, grain, vignette
//   medium  real glass refraction and bloom at a lower resolution
//   low     the lightweight glass, no post effects
//
// Add ?quality=low, ?quality=medium or ?quality=high to the URL to force one.
// The scene also steps down a tier by itself if the frame rate stays poor.

export const TIERS = ['low', 'medium', 'high']

export const SETTINGS = {
  low: { dpr: [1, 1], refraction: false, effects: false, dispersion: 0, samples: 0 },
  medium: { dpr: [1, 1.5], refraction: true, effects: true, dispersion: 0, samples: 0 },
  high: { dpr: [1, 2], refraction: true, effects: true, dispersion: 0.35, samples: 4 },
}

export function detectQuality() {
  const forced = new URLSearchParams(window.location.search).get('quality')
  if (TIERS.includes(forced)) return forced

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
