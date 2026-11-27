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
      .replace(
        '#include <opaque_fragment>',
        `// The flat top of the liquid faces straight up at the brightest lights.
        // Left alone it mirrors them and goes white, so it is pulled back
        // toward its own color.
        if (!gl_FrontFacing) outgoingLight = mix(min(outgoingLight, vec3(1.0)), uSurfaceColor * 0.85, 0.6);
        #include <opaque_fragment>`
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
    // An inner wall faces the middle of the object. The inner floor and the
    // underside are the flat faces near the base. Both go: lit from above, the
    // underside otherwise shows through as a pale disc.
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vGlassInner;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vGlassInner = ${hollow ? '(dot(normal.xz, position.xz) < -0.0001 || (abs(normal.y) > 0.7 && position.y < 0.35)) ? 1.0 : 0.0' : '0.0'};`
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

// Real glass, for devices that can afford it. Light bends through it, so the
// whiskey, the cork and the headline behind the bottle all warp as it moves.
// The inner wall is skipped entirely: the renderer treats glass as one thick
// surface, and drawing both walls would bend everything twice.
export function makeRefractiveGlassMaterial({ dispersion = 0 } = {}) {
  const material = new THREE.MeshPhysicalMaterial({
    color: '#ffffff',
    metalness: 0,
    roughness: 0.02,
    transmission: 1,
    thickness: 0.32,
    ior: 1.45,
    dispersion,
    attenuationColor: '#efe2cf',
    attenuationDistance: 5,
    specularIntensity: 1,
    envMapIntensity: 1.15,
    depthWrite: false,
  })
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vGlassInner;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vGlassInner = (dot(normal.xz, position.xz) < -0.0001 || (abs(normal.y) > 0.7 && position.y < 0.35)) ? 1.0 : 0.0;`
      )
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vGlassInner;')
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
        if (vGlassInner > 0.5) discard;`
      )
  }
  return material
}

// Faint glowing rings where the pour lands.
export function makeRippleMaterial() {
  return new THREE.MeshBasicMaterial({
    color: '#ffb469',
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  })
}

// The backdrop: near black with a soft green glow behind the scene. It lives
// in the 3D scene, not the page, so the glass has something to refract.
export function makeBackdropMaterial() {
  return new THREE.ShaderMaterial({
    depthWrite: false,
    uniforms: {
      uResolution: { value: new THREE.Vector2(1, 1) },
      uEdge: { value: new THREE.Color('#0a0705') },
      uGlow: { value: new THREE.Color('#1b1e17') },
    },
    vertexShader: `void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform vec2 uResolution;
      uniform vec3 uEdge;
      uniform vec3 uGlow;
      void main() {
        vec2 uv = gl_FragCoord.xy / uResolution;
        float d = length((uv - vec2(0.5, 0.55)) / vec2(0.62, 0.62));
        float grain = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
        vec3 color = mix(uGlow, uEdge, smoothstep(0.0, 1.0, d)) + grain * 0.004;
        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  })
}

// The raised lettering on the bottle. Matte and pale, with a faint glow of its
// own so it stays readable when the bottle turns away from the lights.
export function makeLabelMaterial() {
  return new THREE.MeshStandardMaterial({
    color: '#dbd8d7',
    roughness: 0.5,
    metalness: 0,
    emissive: '#dbd8d7',
    emissiveIntensity: 0.12,
    side: THREE.DoubleSide,
    // Fully opaque, but flagged this way so it is drawn after the glass. If it
    // were drawn before, the glass would refract a second, smeared copy of
    // the letters around their edges.
    transparent: true,
  })
}
