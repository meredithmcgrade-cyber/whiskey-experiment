import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Environment, Lightformer, PerformanceMonitor, useGLTF, useTexture } from '@react-three/drei'
import { Bloom, EffectComposer, Noise, ToneMapping, Vignette } from '@react-three/postprocessing'
import { BlendFunction, ToneMappingMode } from 'postprocessing'
import * as THREE from 'three'
import { rigs, SEQUENCE_LENGTH } from '../theatre/index.js'
import { detectQuality, SETTINGS, stepDown } from '../quality.js'
import { sound } from '../audio.js'
import {
  makeBackdropMaterial,
  makeCorkMaterial,
  makeGlassMaterial,
  makeLabelMaterial,
  makeLiquidMaterial,
  makeRefractiveGlassMaterial,
  makeRippleMaterial,
  makeStreamMaterial,
} from './materials.js'

const MODEL_URL = '/models/whiskey.glb'
const CORK_TEXTURES = ['/textures/cork-color.jpg', '/textures/cork-normal.jpg']

// Measurements taken from the Blender bottle, relative to its base.
const BOTTLE_PIVOT = 1.5 // the height it leans around
const BOTTLE_MOUTH = 2.96
// The inside of the bottle as [radius, height] pairs, a hair smaller than the
// glass. Spun into a solid, this is the full volume the whiskey can occupy,
// so the liquid can run up into the neck when the bottle tips.
const BOTTLE_INTERIOR = [
  [0, 0.135], [0.8, 0.135], [0.855, 0.17], [0.86, 0.27], [0.857, 1.57], [0.85, 1.62],
  [0.765, 1.72], [0.655, 1.82], [0.547, 1.92], [0.44, 2.02], [0.332, 2.12], [0.229, 2.22],
  [0.153, 2.32], [0.141, 2.42], [0.137, 2.9], [0, 2.9],
]
const GLASS_INNER_RADIUS = 0.44
const PORTRAIT_BELOW = 0.8 // narrower than this and the phone timeline takes over

const { clamp, lerp, smoothstep, degToRad } = THREE.MathUtils
const UP = new THREE.Vector3(0, 1, 0)
const easeOut = (t) => 1 - Math.pow(1 - t, 3)

// Keeps the latest keyframed values for a timeline object in a ref so the
// render loop can read them without re-rendering React.
function useTimelineValues(object) {
  const ref = useRef(object.value)
  useEffect(() => {
    ref.current = object.value
    return object.onValuesChange((values) => (ref.current = values))
  }, [object])
  return ref
}

// Splits the exported file into the pieces the scene animates separately.
function useModel(settings) {
  const { scene } = useGLTF(MODEL_URL)
  const [corkColor, corkNormal] = useTexture(CORK_TEXTURES)
  return useMemo(() => {
    const root = scene.clone(true)
    const find = (name) => root.getObjectByName(name) || root.getObjectByName(name.replace(/ /g, '_'))
    const bottle = find('Bottle')
    const cork = find('Cork')
    const label = find('Label') // the raised "Is it Wednesday?" lettering, a child of the bottle
    const glass = find('Glass')
    const glassLiquid = find('Glass Liquid')
    const ice = find('Ice')

    const glassMaterial = settings.refraction
      ? makeRefractiveGlassMaterial({ dispersion: settings.dispersion })
      : makeGlassMaterial({ hollow: true })
    const iceMaterial = makeGlassMaterial({ tint: '#dcecf5', opacity: 0.1, roughness: 0.25, shine: 0.7, edge: 0.4 })
    const corkMaterial = makeCorkMaterial(corkColor, corkNormal)
    const glassLiquidMaterial = makeLiquidMaterial()

    const paint = (object, material, order = 0) =>
      object.traverse((child) => {
        if (child.isMesh) {
          child.material = material
          child.renderOrder = order
        }
      })

    // The bottle and glass sit at the center of their own rigs.
    glassLiquid.position.sub(glass.position)
    ice.position.sub(glass.position)
    glass.position.set(0, 0, 0)
    bottle.position.set(0, 0, 0)
    bottle.remove(cork)

    paint(bottle, glassMaterial, 3)
    if (label) paint(label, makeLabelMaterial())
    paint(glass, glassMaterial, 3)
    paint(ice, iceMaterial, 4)
    paint(cork, corkMaterial)
    paint(glassLiquid, glassLiquidMaterial)

    let glassLiquidMesh = null
    glassLiquid.traverse((child) => child.isMesh && (glassLiquidMesh = child))
    glassLiquidMesh.geometry.computeBoundingBox()

    return {
      bottle,
      cork,
      corkHome: cork.position.clone(),
      corkScale: cork.scale.clone(),
      glass,
      glassLiquid,
      glassLiquidMesh,
      glassLiquidMaterial,
      ice,
      iceHome: ice.position.clone(),
      iceRotation: ice.rotation.clone(),
    }
  }, [scene, corkColor, corkNormal, settings])
}

const corner = new THREE.Vector3()
// How far a mesh reaches along a direction in world space, as [low, high].
function extentAlong(mesh, direction, out) {
  const { min, max } = mesh.geometry.boundingBox
  let low = Infinity
  let high = -Infinity
  for (let i = 0; i < 8; i++) {
    corner.set(i & 1 ? max.x : min.x, i & 2 ? max.y : min.y, i & 4 ? max.z : min.z).applyMatrix4(mesh.matrixWorld)
    const d = corner.dot(direction)
    if (d < low) low = d
    if (d > high) high = d
  }
  out[0] = low
  out[1] = high
  return out
}

// ---------- The pour ----------

const STREAM_RINGS = 44
const STREAM_SIDES = 10

function makeStreamGeometry() {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array((STREAM_RINGS + 1) * STREAM_SIDES * 3), 3))
  const index = []
  for (let i = 0; i < STREAM_RINGS; i++) {
    for (let j = 0; j < STREAM_SIDES; j++) {
      const a = i * STREAM_SIDES + j
      const b = i * STREAM_SIDES + ((j + 1) % STREAM_SIDES)
      const c = a + STREAM_SIDES
      const d = b + STREAM_SIDES
      index.push(a, c, b, b, c, d)
    }
  }
  geometry.setIndex(index)
  return geometry
}

const streamPoint = new THREE.Vector3()
const streamTangent = new THREE.Vector3()
const streamSide = new THREE.Vector3()
const streamOther = new THREE.Vector3()

// Rebuilds the pour between its tail and its head. It thins as it falls,
// carries a travelling ripple, sways a little, and breaks into beads when the
// bottle stops giving.
function updateStream(geometry, curve, tail, head, radius, time) {
  const positions = geometry.attributes.position.array
  const ending = smoothstep(tail, 0, 0.25)
  for (let i = 0; i <= STREAM_RINGS; i++) {
    const f = i / STREAM_RINGS
    const t = lerp(tail, head, f)
    curve.getPoint(t, streamPoint)
    curve.getTangent(t, streamTangent)
    streamSide.set(-streamTangent.y, streamTangent.x, 0)
    if (streamSide.lengthSq() < 1e-6) streamSide.set(1, 0, 0)
    streamSide.normalize()
    streamOther.crossVectors(streamTangent, streamSide).normalize()

    const sway = Math.sin(t * 8 - time * 6) * radius * 0.35 * t
    streamPoint.addScaledVector(streamSide, sway).addScaledVector(streamOther, Math.cos(t * 6.5 - time * 5) * radius * 0.25 * t)

    let r = radius * lerp(1, 0.6, t) * (1 + 0.16 * Math.sin(t * 24 - time * 12))
    r *= lerp(1, 0.35 + 0.65 * Math.abs(Math.sin(t * 26 - time * 10)), ending)
    // Close the travelling end while it is still in the air, and the top once
    // the bottle has let go.
    if (head < 0.999) r *= 1 - smoothstep(f, 0.82, 1)
    if (tail > 0.001) r *= smoothstep(f, 0, 0.18)

    for (let j = 0; j < STREAM_SIDES; j++) {
      const angle = (j / STREAM_SIDES) * Math.PI * 2
      const k = (i * STREAM_SIDES + j) * 3
      positions[k] = streamPoint.x + (streamSide.x * Math.cos(angle) + streamOther.x * Math.sin(angle)) * r
      positions[k + 1] = streamPoint.y + (streamSide.y * Math.cos(angle) + streamOther.y * Math.sin(angle)) * r
      positions[k + 2] = streamPoint.z + (streamSide.z * Math.cos(angle) + streamOther.z * Math.sin(angle)) * r
    }
  }
  geometry.attributes.position.needsUpdate = true
  geometry.computeVertexNormals()
}

const DROPLETS = 7
const dropletMatrix = new THREE.Matrix4()
const dropletPosition = new THREE.Vector3()
const dropletScale = new THREE.Vector3()
const noRotation = new THREE.Quaternion()

// ---------- The scene ----------

function Whiskey({ settings }) {
  const model = useModel(settings)
  const aspect = useThree((state) => state.viewport.aspect)
  const camera = useThree((state) => state.camera)
  const portrait = aspect < PORTRAIT_BELOW
  const rig = portrait ? rigs.phone : rigs.desktop

  const bottleValues = useTimelineValues(rig.bottle)
  const corkValues = useTimelineValues(rig.cork)
  const glassValues = useTimelineValues(rig.glass)
  const liquidValues = useTimelineValues(rig.liquid)
  const cameraValues = useTimelineValues(rig.camera)

  const world = useRef()
  const bottleRig = useRef()
  const spin = useRef()
  const lean = useRef()
  const mouth = useRef()
  const bottleLiquid = useRef()
  const glassRig = useRef()
  const stream = useRef()
  const ripples = useRef([])
  const droplets = useRef()

  const bottleLiquidMaterial = useMemo(() => makeLiquidMaterial(), [])
  const streamMaterial = useMemo(() => makeStreamMaterial(), [])
  const rippleMaterials = useMemo(() => [makeRippleMaterial(), makeRippleMaterial()], [])
  const streamGeometry = useMemo(() => makeStreamGeometry(), [])
  const bottleLiquidGeometry = useMemo(() => {
    const points = BOTTLE_INTERIOR.map(([r, y]) => new THREE.Vector2(r, y))
    const geometry = new THREE.LatheGeometry(points, 56)
    geometry.computeBoundingBox()
    return geometry
  }, [])

  // Pointer position and speed. Position gives the scene a slight parallax
  // and leans the bottle toward the cursor. Speed stirs the whiskey.
  const pointer = useRef({ x: 0, y: 0, vx: 0, vy: 0, lastX: 0, lastY: 0, seen: false })
  useEffect(() => {
    const onMove = (e) => {
      const p = pointer.current
      const x = (e.clientX / window.innerWidth) * 2 - 1
      const y = (e.clientY / window.innerHeight) * 2 - 1
      if (p.seen) {
        p.vx += x - p.lastX
        p.vy += y - p.lastY
      }
      p.lastX = p.x = x
      p.lastY = p.y = y
      p.seen = true
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    return () => window.removeEventListener('pointermove', onMove)
  }, [])

  // Lets the page fade its own pieces in once the bottle is ready.
  useEffect(() => {
    document.documentElement.classList.add('is-loaded')
  }, [])

  const scratch = useMemo(
    () => ({
      lastScroll: -1,
      intro: 0,
      lastLift: 0,
      lastLanding: 0,
      extent: [0, 0],
      slosh: new THREE.Vector2(),
      sloshVelocity: new THREE.Vector2(),
      liquidCenter: new THREE.Vector3(),
      lastCenter: null,
      normal: new THREE.Vector3(0, 1, 0),
      glassNormal: new THREE.Vector3(0, 1, 0),
      mouth: new THREE.Vector3(),
      pivot: new THREE.Vector3(),
      axis: new THREE.Vector3(),
      end: new THREE.Vector3(),
      control: new THREE.Vector3(),
      curve: new THREE.QuadraticBezierCurve3(),
    }),
    []
  )

  useFrame((state, rawDelta) => {
    const delta = Math.min(rawDelta, 1 / 20)
    const time = state.clock.elapsedTime

    // Scroll drives the timeline. One screen of scroll is one unit. Only
    // touching it when the scroll moves leaves the editor's playhead free.
    const scrollY = window.scrollY
    if (scrollY !== scratch.lastScroll) {
      scratch.lastScroll = scrollY
      const position = clamp(scrollY / window.innerHeight, 0, SEQUENCE_LENGTH)
      rigs.desktop.sheet.sequence.position = position
      rigs.phone.sheet.sequence.position = position
    }

    const b = bottleValues.current
    const g = glassValues.current
    const l = liquidValues.current
    const c = cameraValues.current
    const p = pointer.current

    // The phone timeline is composed for a narrow screen already. In between
    // sizes, the wide timeline is shrunk and pulled toward the middle.
    const fit = portrait ? 1 : clamp(aspect / 1.6, 0.6, 1)
    const spread = portrait ? 1 : lerp(0.45, 1, clamp((aspect - PORTRAIT_BELOW) / 0.6, 0, 1))
    const bottleX = b.x * spread
    const shift = b.x - bottleX

    // Entrance: everything rises into frame once, when the model arrives.
    scratch.intro = Math.min(1, scratch.intro + delta / 1.7)
    const rise = (1 - easeOut(scratch.intro)) * -7

    world.current.scale.setScalar(fit)
    world.current.position.y = rise
    world.current.rotation.y = lerp(world.current.rotation.y, p.x * 0.07, 0.06)
    world.current.rotation.x = lerp(world.current.rotation.x, p.y * 0.04, 0.06)

    camera.position.set(0, c.y, c.z)

    bottleRig.current.position.set(bottleX, b.y, 0)
    bottleRig.current.scale.setScalar(b.scale)
    // A gentle lean toward the cursor, on top of whatever the timeline asks.
    bottleRig.current.rotation.z = lerp(bottleRig.current.rotation.z, -p.x * 0.07, 0.05)
    bottleRig.current.rotation.x = lerp(bottleRig.current.rotation.x, p.y * 0.05, 0.05)
    spin.current.rotation.y = b.spin * Math.PI * 2
    lean.current.rotation.z = -degToRad(b.lean)

    glassRig.current.position.set(g.x - shift, g.y, 0)
    glassRig.current.scale.setScalar(g.scale)

    // Cork: it leaves like a thrown object. Up fast, slowing, arcing off to
    // the side and tumbling as it falls away.
    const lift = corkValues.current.lift
    const { cork, corkHome, corkScale } = model
    cork.visible = lift < 0.995
    cork.position.set(corkHome.x + lift * 1.9, corkHome.y + lift * 6 - lift * lift * 8, corkHome.z + lift * 0.6)
    cork.rotation.set(lift * 4.5, 0, -lift * 7)
    cork.scale.copy(corkScale).multiplyScalar(1 - smoothstep(lift, 0.8, 1))
    if (lift > 0.2 && scratch.lastLift <= 0.2) sound.pop()
    scratch.lastLift = lift

    world.current.updateWorldMatrix(true, true)

    // Slosh: the liquid surface lags behind the bottle's movement like a
    // weight on a spring, then settles. Quick cursor moves stir it too.
    const mesh = bottleLiquid.current
    scratch.liquidCenter.set(0, BOTTLE_PIVOT, 0).applyMatrix4(mesh.matrixWorld)
    if (scratch.lastCenter) {
      const vx = (scratch.liquidCenter.x - scratch.lastCenter.x) / delta
      const vz = (scratch.liquidCenter.z - scratch.lastCenter.z) / delta
      const targetX = clamp(vx * 0.05 + p.vx * 2.2, -0.4, 0.4)
      const targetZ = clamp(vz * 0.05 + p.vy * 2.2, -0.4, 0.4)
      scratch.sloshVelocity.x += ((targetX - scratch.slosh.x) * 70 - scratch.sloshVelocity.x * 5) * delta
      scratch.sloshVelocity.y += ((targetZ - scratch.slosh.y) * 70 - scratch.sloshVelocity.y * 5) * delta
      scratch.slosh.addScaledVector(scratch.sloshVelocity, delta)
    } else {
      scratch.lastCenter = new THREE.Vector3()
    }
    p.vx *= 0.8
    p.vy *= 0.8
    scratch.lastCenter.copy(scratch.liquidCenter)
    scratch.normal.set(scratch.slosh.x, 1, scratch.slosh.y).normalize()

    // Bottle fill.
    let u = bottleLiquidMaterial.userData.uniforms
    let [low, high] = extentAlong(mesh, scratch.normal, scratch.extent)
    u.uPlaneNormal.value.copy(scratch.normal)
    u.uPlaneLevel.value = lerp(low, high, l.bottleFill)

    const head = l.streamHead
    const tail = l.streamTail
    const pouring = head - tail > 0.01
    const landing = pouring && head > 0.98 ? 1 - smoothstep(tail, 0.6, 1) : 0

    // Glass fill. While the pour is landing the surface rocks a little.
    scratch.glassNormal.set(Math.sin(time * 9) * 0.035 * landing, 1, Math.cos(time * 7.3) * 0.035 * landing).normalize()
    u = model.glassLiquidMaterial.userData.uniforms
    ;[low, high] = extentAlong(model.glassLiquidMesh, scratch.glassNormal, scratch.extent)
    u.uPlaneNormal.value.copy(scratch.glassNormal)
    u.uPlaneLevel.value = lerp(low, high, l.glassFill * 1.002)
    model.glassLiquid.visible = l.glassFill > 0.001

    // The ice floats up with the drink, bobbing and turning as it goes.
    const { ice, iceHome, iceRotation } = model
    const afloat = smoothstep(l.glassFill, 0.25, 1)
    ice.position.y = iceHome.y + afloat * 0.1 + Math.sin(time * 2.6) * 0.012 * afloat * (0.4 + landing)
    ice.rotation.set(
      iceRotation.x + Math.sin(time * 1.9) * 0.07 * afloat,
      iceRotation.y + afloat * 0.9,
      iceRotation.z + Math.cos(time * 1.6) * 0.06 * afloat
    )

    // The pour itself.
    stream.current.visible = pouring
    const glassSize = g.scale * fit
    if (pouring) {
      mouth.current.getWorldPosition(scratch.mouth)
      scratch.pivot.set(0, BOTTLE_PIVOT, 0).applyMatrix4(mesh.matrixWorld)
      scratch.axis.subVectors(scratch.mouth, scratch.pivot).normalize()
      model.glass.getWorldPosition(scratch.end)
      scratch.end.y = lerp(low, high, Math.max(l.glassFill, 0.04))
      const reach = scratch.mouth.distanceTo(scratch.end)
      scratch.control.copy(scratch.mouth).addScaledVector(scratch.axis, reach * 0.3)
      scratch.control.x = lerp(scratch.control.x, scratch.end.x, 0.6)
      scratch.curve.v0.copy(scratch.mouth)
      scratch.curve.v1.copy(scratch.control)
      scratch.curve.v2.copy(scratch.end)
      updateStream(streamGeometry, scratch.curve, tail, head, 0.06 * fit * b.scale, time)
    }
    if (landing > 0 && scratch.lastLanding === 0) sound.plop()
    scratch.lastLanding = landing

    // Where it lands: rings spreading across the surface and a few beads
    // jumping up out of it.
    ripples.current.forEach((ring, i) => {
      const phase = (time * 0.9 + i * 0.5) % 1
      ring.visible = landing > 0.01
      ring.position.copy(scratch.end)
      ring.position.y += 0.004
      ring.scale.setScalar(GLASS_INNER_RADIUS * glassSize * lerp(0.2, 0.92, phase))
      rippleMaterials[i].opacity = (1 - phase) * 0.55 * landing
    })
    droplets.current.visible = landing > 0.01
    if (landing > 0.01) {
      for (let i = 0; i < DROPLETS; i++) {
        const life = (time * 1.7 + i / DROPLETS) % 1
        const angle = i * 2.4 + Math.floor(time * 1.7 + i / DROPLETS) * 1.3
        const out = GLASS_INNER_RADIUS * glassSize * 0.7 * life
        dropletPosition.set(
          scratch.end.x + Math.cos(angle) * out,
          scratch.end.y + 4 * life * (1 - life) * 0.22 * glassSize,
          scratch.end.z + Math.sin(angle) * out
        )
        dropletScale.setScalar(0.028 * glassSize * (1 - life) * landing)
        droplets.current.setMatrixAt(i, dropletMatrix.compose(dropletPosition, noRotation, dropletScale))
      }
      droplets.current.instanceMatrix.needsUpdate = true
    }
  })

  return (
    <>
      <group ref={world}>
        <group ref={bottleRig}>
          <group ref={spin}>
            <group ref={lean} position={[0, BOTTLE_PIVOT, 0]}>
              <group position={[0, -BOTTLE_PIVOT, 0]}>
                <mesh ref={bottleLiquid} geometry={bottleLiquidGeometry} material={bottleLiquidMaterial} />
                <primitive object={model.bottle} />
                <primitive object={model.cork} />
                <object3D ref={mouth} position={[0, BOTTLE_MOUTH, 0]} />
              </group>
            </group>
          </group>
        </group>

        <group ref={glassRig}>
          <primitive object={model.glassLiquid} />
          <primitive object={model.ice} />
          <primitive object={model.glass} />
        </group>
      </group>

      {/* These live outside the scaled group because they are built from world positions. */}
      <mesh ref={stream} geometry={streamGeometry} material={streamMaterial} visible={false} frustumCulled={false} />
      {rippleMaterials.map((material, i) => (
        <mesh key={i} ref={(el) => (ripples.current[i] = el)} material={material} rotation-x={-Math.PI / 2} visible={false} renderOrder={5}>
          <ringGeometry args={[0.82, 1, 48]} />
        </mesh>
      ))}
      <instancedMesh ref={droplets} args={[null, null, DROPLETS]} material={streamMaterial} visible={false} frustumCulled={false}>
        <sphereGeometry args={[1, 10, 8]} />
      </instancedMesh>
    </>
  )
}

function Backdrop() {
  const material = useMemo(() => makeBackdropMaterial(), [])
  const size = useThree((state) => state.size)
  const dpr = useThree((state) => state.viewport.dpr)
  useEffect(() => {
    material.uniforms.uResolution.value.set(size.width * dpr, size.height * dpr)
  }, [material, size, dpr])
  return (
    <mesh material={material} position={[0, 0, -14]} renderOrder={-10}>
      <planeGeometry args={[120, 80]} />
    </mesh>
  )
}

// The lighting is the Blender file's own setup: its four area lights, placed
// and sized as they are there and turned to face the camera the same way,
// plus that file's dim green ambient. Two thin strips are added at the sides
// because they are what draw the long highlights down the glass and whiskey.
function Lighting() {
  return (
    <>
      <ambientLight intensity={0.2} color="#c9d6cb" />
      <directionalLight position={[-4.7, 7, 6.4]} intensity={1.7} />
      <pointLight position={[-5, -1, 3]} intensity={40} color="#ff8a2a" />
      <Environment resolution={256} frames={1}>
        <color attach="background" args={['#070a07']} />
        {/* Area.004: the rectangular key, front left and above */}
        <Lightformer form="rect" intensity={9} position={[-4.7, 7, 6.4]} target={[0, 0, 0]} scale={[2, 4.8, 1]} />
        {/* Area.002: a round light high on the right, behind */}
        <Lightformer form="circle" intensity={5} position={[10, 4, -5.4]} target={[0, 0, 0]} scale={6} />
        {/* Area.001: the large warm disk overhead and behind */}
        <Lightformer form="circle" intensity={3} color="#fffdc5" position={[-0.5, 4.7, -8.3]} target={[0, 0, 0]} scale={10} />
        {/* Area.003: the huge, faint one far behind */}
        <Lightformer form="circle" intensity={0.6} position={[1.1, 8.1, -23.8]} target={[0, 0, 0]} scale={28} />
        <Lightformer form="rect" intensity={9} position={[-6, 1.5, 2]} rotation-y={Math.PI / 2} scale={[0.5, 9, 1]} />
        <Lightformer form="rect" intensity={7} position={[6, 0.5, 3]} rotation-y={-Math.PI / 2} scale={[0.4, 8, 1]} />
        <Lightformer form="rect" intensity={2} color="#ff9a3c" position={[3, -3, -6]} scale={[10, 3, 1]} />
      </Environment>
    </>
  )
}

// Bloom on the brightest highlights, a little film grain and darker corners.
function Effects({ settings }) {
  return (
    <EffectComposer multisampling={settings.samples} disableNormalPass>
      <Bloom mipmapBlur intensity={0.5} luminanceThreshold={1.1} luminanceSmoothing={0.3} radius={0.72} />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      <Noise blendFunction={BlendFunction.SOFT_LIGHT} opacity={0.22} />
      <Vignette offset={0.28} darkness={0.5} />
    </EffectComposer>
  )
}

export default function Scene() {
  const [quality, setQuality] = useState(detectQuality)
  const settings = SETTINGS[quality]

  return (
    <Canvas
      dpr={settings.dpr}
      camera={{ fov: 30, near: 0.1, far: 80, position: [0, 0, 14] }}
      gl={{ antialias: !settings.effects, alpha: false, powerPreference: 'high-performance' }}
    >
      <color attach="background" args={['#0a0705']} />
      {/* If the frame rate stays poor, drop to the next tier down. */}
      <PerformanceMonitor onDecline={() => setQuality(stepDown)} flipflops={2} />
      <Backdrop />
      <Lighting />
      <Suspense fallback={null}>
        <Whiskey settings={settings} />
      </Suspense>
      {settings.effects && <Effects settings={settings} />}
    </Canvas>
  )
}

useGLTF.preload(MODEL_URL)
useTexture.preload(CORK_TEXTURES)
