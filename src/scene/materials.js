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
//
// Pass hollow: true for anything modeled with wall thickness, like the bottle
// and the tumbler. Without real refraction the inner wall would show up as a
// second, smaller container sitting inside the first, so it is faded almost
// all the way out and only the outer surface carries the highlights.
export function makeGlassMaterial({ tint = '#fff4e6', opacity = 0.04, roughness = 0.03, shine = 0.7, edge = 0.2, hollow = false } = {}) {
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
    // An inner wall faces the middle of the object. The inner floor faces up
    // from just above the base.
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vGlassInner;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vGlassInner = ${hollow ? '(dot(normal.xz, position.xz) < -0.0001 || (normal.y > 0.7 && position.y < 0.35)) ? 1.0 : 0.0' : '0.0'};`
      )
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uGlassTint;\nvarying float vGlassInner;')
      .replace(
        '#include <opaque_fragment>',
        `float glassOuter = 1.0 - vGlassInner * 0.9;
        float glassEdge = glassOuter * pow(1.0 - saturate(abs(dot(normalize(normal), normalize(vViewPosition)))), 4.5);
        outgoingLight *= glassOuter;
        outgoingLight += uGlassTint * glassEdge * ${edge.toFixed(3)};
        float glassShine = dot(outgoingLight, vec3(0.299, 0.587, 0.114));
        diffuseColor.a = clamp(diffuseColor.a * glassOuter + smoothstep(0.35, 1.8, glassShine) * ${shine.toFixed(3)} + glassEdge * ${edge.toFixed(3)}, 0.0, 1.0);
        // Dividing by a floor instead of the true alpha lets bright highlights
        // through at full strength while dim, broad reflections mostly drop out.
        // Those dim panels are what made the bottle look like it had a box in it.
        outgoingLight /= max(diffuseColor.a, 0.4) * 1.6;
        #include <opaque_fragment>`
      )
  }
  return material
}

// The cork's color and surface bumps are baked out of the Blender material
// into two images. Textures that pair with a glTF model are not flipped.
export function makeCorkMaterial(colorMap, normalMap) {
  for (const texture of [colorMap, normalMap]) {
    texture.flipY = false
    texture.anisotropy = 8
    texture.needsUpdate = true
  }
  colorMap.colorSpace = THREE.SRGBColorSpace
  return new THREE.MeshStandardMaterial({
    map: colorMap,
    normalMap,
    normalScale: new THREE.Vector2(1.5, 1.5),
    roughness: 0.75,
    metalness: 0,
  })
}
