import * as THREE from 'three'

// Polished bronze "whiskey". It is opaque on purpose: real see-through liquid
// inside see-through glass is the hardest thing to draw in a browser, and
// this look reads as rich and intentional instead.
//
// The material also does the fill trick. Anything above a flat plane gets
// thrown away, and the inside faces that show through the cut are shaded as
// a flat surface so the top of the liquid looks solid. The plane stays level
// with the world, so when the bottle tips the liquid stays put.
export function makeLiquidMaterial() {
  const material = new THREE.MeshPhysicalMaterial({
    color: '#6b2f08',
    metalness: 0.92,
    roughness: 0.17,
    clearcoat: 1,
    clearcoatRoughness: 0.06,
    envMapIntensity: 1.5,
    side: THREE.DoubleSide,
  })

  const uniforms = {
    uPlaneNormal: { value: new THREE.Vector3(0, 1, 0) },
    uPlaneLevel: { value: 1e6 },
    uSurfaceColor: { value: new THREE.Color('#b8641a') },
    uRimColor: { value: new THREE.Color('#ff7a14') },
  }
  material.userData.uniforms = uniforms

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLiquidWorld;')
      .replace(
        '#include <project_vertex>',
        '#include <project_vertex>\nvLiquidWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;'
      )

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vLiquidWorld;
        uniform vec3 uPlaneNormal;
        uniform float uPlaneLevel;
        uniform vec3 uSurfaceColor;
        uniform vec3 uRimColor;`
      )
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
        if (dot(vLiquidWorld, uPlaneNormal) > uPlaneLevel) discard;`
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        if (!gl_FrontFacing) diffuseColor.rgb = uSurfaceColor;`
      )
      .replace(
        '#include <clearcoat_normal_fragment_maps>',
        `#include <clearcoat_normal_fragment_maps>
        if (!gl_FrontFacing) {
          normal = normalize((viewMatrix * vec4(uPlaneNormal, 0.0)).xyz);
          #ifdef USE_CLEARCOAT
            clearcoatNormal = normal;
          #endif
        }`
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        float liquidRim = pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), 3.0);
        totalEmissiveRadiance += uRimColor * liquidRim * 0.55;`
      )
  }
  return material
}

// The pour uses the same bronze without the fill plane.
export function makeStreamMaterial() {
  return new THREE.MeshPhysicalMaterial({
    color: '#7a3609',
    metalness: 0.92,
    roughness: 0.14,
    clearcoat: 1,
    clearcoatRoughness: 0.06,
    envMapIntensity: 1.6,
    emissive: '#4a1c02',
    emissiveIntensity: 0.5,
  })
}

// Lightweight glass. Mostly clear, and it turns solid wherever it catches a
// bright reflection or is seen edge on. Much cheaper than real refraction
// and it lets the liquid show through cleanly.
export function makeGlassMaterial({ tint = '#fff4e6', opacity = 0.04, roughness = 0.03, shine = 0.55, edge = 0.22 } = {}) {
  const material = new THREE.MeshPhysicalMaterial({
    // Black base so the surface adds no flat color of its own. Everything
    // you see is reflection.
    color: '#000000',
    metalness: 0,
    roughness,
    clearcoat: 1,
    clearcoatRoughness: 0.02,
    envMapIntensity: 1,
    transparent: true,
    opacity,
    depthWrite: false,
    side: THREE.DoubleSide,
  })
  const uniforms = { uGlassTint: { value: new THREE.Color(tint) } }
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uGlassTint;')
      .replace(
        '#include <opaque_fragment>',
        `float glassEdge = pow(1.0 - saturate(abs(dot(normalize(normal), normalize(vViewPosition)))), 3.0);
        outgoingLight += uGlassTint * glassEdge * ${edge.toFixed(3)};
        float glassShine = dot(outgoingLight, vec3(0.299, 0.587, 0.114));
        diffuseColor.a = clamp(diffuseColor.a + smoothstep(0.0, 1.6, glassShine) * ${shine.toFixed(3)} + glassEdge * ${edge.toFixed(3)}, 0.0, 1.0);
        outgoingLight /= max(diffuseColor.a, 0.08) * 2.2;
        #include <opaque_fragment>`
      )
  }
  return material
}

export function makeCorkMaterial() {
  return new THREE.MeshStandardMaterial({ color: '#a9825a', roughness: 0.9, metalness: 0 })
}
