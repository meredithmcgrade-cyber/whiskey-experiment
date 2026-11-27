import { Suspense, useEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Environment, Lightformer, useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import * as timeline from '../theatre/index.js'
import { makeCorkMaterial, makeGlassMaterial, makeLiquidMaterial, makeStreamMaterial } from './materials.js'

const MODEL_URL = '/models/whiskey.glb'

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

const clamp = THREE.MathUtils.clamp
const lerp = THREE.MathUtils.lerp
const UP = new THREE.Vector3(0, 1, 0)

// Keeps the latest keyframed values for a timeline object in a ref so the
// render loop can read them without re-rendering React.
function useTimelineValues(object) {
  const ref = useRef(object.value)
  useEffect(() => object.onValuesChange((values) => (ref.current = values)), [object])
  return ref
}

// Splits the exported file into the pieces the scene animates separately.
function useModel() {
  const { scene } = useGLTF(MODEL_URL)
  return useMemo(() => {
    const root = scene.clone(true)
    const find = (name) => root.getObjectByName(name) || root.getObjectByName(name.replace(/ /g, '_'))
    const bottle = find('Bottle')
    const cork = find('Cork')
    const glass = find('Glass')
    const glassLiquid = find('Glass Liquid')
    const ice = find('Ice')

    const glassMaterial = makeGlassMaterial()
    const iceMaterial = makeGlassMaterial({ tint: '#dcecf5', opacity: 0.1, roughness: 0.25, shine: 0.7, edge: 0.4 })
    const corkMaterial = makeCorkMaterial()
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
    paint(glass, glassMaterial, 3)
    paint(ice, iceMaterial, 2)
    paint(cork, corkMaterial)
    paint(glassLiquid, glassLiquidMaterial)

    let glassLiquidMesh = null
    glassLiquid.traverse((child) => child.isMesh && (glassLiquidMesh = child))
    glassLiquidMesh.geometry.computeBoundingBox()

    return { bottle, cork, corkHome: cork.position.clone(), corkScale: cork.scale.clone(), glass, glassLiquid, glassLiquidMesh, glassLiquidMaterial, ice }
  }, [scene])
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

function Whiskey() {
  const model = useModel()
  const aspect = useThree((state) => state.viewport.aspect)
  const camera = useThree((state) => state.camera)

  const bottleValues = useTimelineValues(timeline.bottle)
  const corkValues = useTimelineValues(timeline.cork)
  const glassValues = useTimelineValues(timeline.glass)
  const liquidValues = useTimelineValues(timeline.liquid)
  const cameraValues = useTimelineValues(timeline.camera)

  const world = useRef()
  const bottleRig = useRef()
  const spin = useRef()
  const lean = useRef()
  const mouth = useRef()
  const bottleLiquid = useRef()
  const glassRig = useRef()
  const stream = useRef()

  const bottleLiquidMaterial = useMemo(() => makeLiquidMaterial(), [])
  const streamMaterial = useMemo(() => makeStreamMaterial(), [])
  const bottleLiquidGeometry = useMemo(() => {
    const points = BOTTLE_INTERIOR.map(([r, y]) => new THREE.Vector2(r, y))
    const geometry = new THREE.LatheGeometry(points, 56)
    geometry.computeBoundingBox()
    return geometry
  }, [])

  // Pointer position, for a slight parallax on the whole scene.
  const pointer = useRef({ x: 0, y: 0 })
  useEffect(() => {
    const onMove = (e) => {
      pointer.current.x = (e.clientX / window.innerWidth) * 2 - 1
      pointer.current.y = (e.clientY / window.innerHeight) * 2 - 1
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    return () => window.removeEventListener('pointermove', onMove)
  }, [])

  const scratch = useMemo(
    () => ({
      lastScroll: -1,
      extent: [0, 0],
      slosh: new THREE.Vector2(),
      sloshVelocity: new THREE.Vector2(),
      liquidCenter: new THREE.Vector3(),
      lastCenter: null,
      normal: new THREE.Vector3(0, 1, 0),
      mouth: new THREE.Vector3(),
      pivot: new THREE.Vector3(),
      axis: new THREE.Vector3(),
      end: new THREE.Vector3(),
      control: new THREE.Vector3(),
      curve: new THREE.QuadraticBezierCurve3(),
    }),
    []
  )

  useFrame((_, rawDelta) => {
    const delta = Math.min(rawDelta, 1 / 20)

    // Scroll drives the timeline. One screen of scroll is one unit. Only
    // touching it when the scroll moves leaves the editor's playhead free.
    const scrollY = window.scrollY
    if (scrollY !== scratch.lastScroll) {
      scratch.lastScroll = scrollY
      timeline.sheet.sequence.position = clamp(scrollY / window.innerHeight, 0, timeline.SEQUENCE_LENGTH)
    }

    const b = bottleValues.current
    const g = glassValues.current
    const l = liquidValues.current
    const c = cameraValues.current

    // Narrow screens shrink the whole scene so it stays in frame.
    const fit = clamp(aspect / 1.6, 0.55, 1)
    world.current.scale.setScalar(fit)
    world.current.rotation.y = lerp(world.current.rotation.y, pointer.current.x * 0.07, 0.06)
    world.current.rotation.x = lerp(world.current.rotation.x, pointer.current.y * 0.04, 0.06)

    camera.position.set(0, c.y, c.z)

    // On tall, narrow screens the side to side travel is pulled in toward the
    // middle. The glass shifts by the same amount so the pour still lines up.
    const spread = lerp(0.25, 1, clamp((aspect - 0.5) / 0.8, 0, 1))
    const bottleX = b.x * spread
    const shift = b.x - bottleX

    bottleRig.current.position.set(bottleX, b.y, 0)
    bottleRig.current.scale.setScalar(b.scale)
    spin.current.rotation.y = b.spin * Math.PI * 2
    lean.current.rotation.z = -THREE.MathUtils.degToRad(b.lean)

    glassRig.current.position.set(g.x - shift, g.y, 0)
    glassRig.current.scale.setScalar(g.scale)

    // Cork: lifts out, drifts off and shrinks away.
    const lift = corkValues.current.lift
    const { cork, corkHome, corkScale } = model
    cork.visible = lift < 0.995
    cork.position.set(corkHome.x + lift * lift * 0.9, corkHome.y + lift * 1.7, corkHome.z)
    cork.rotation.z = -lift * 1.4
    cork.scale.copy(corkScale).multiplyScalar(1 - THREE.MathUtils.smoothstep(lift, 0.55, 1))

    world.current.updateWorldMatrix(true, true)

    // Slosh: the liquid surface lags behind the bottle's movement like a
    // weight on a spring, then settles.
    const mesh = bottleLiquid.current
    scratch.liquidCenter.set(0, BOTTLE_PIVOT, 0).applyMatrix4(mesh.matrixWorld)
    if (scratch.lastCenter) {
      const vx = (scratch.liquidCenter.x - scratch.lastCenter.x) / delta
      const vz = (scratch.liquidCenter.z - scratch.lastCenter.z) / delta
      const targetX = clamp(vx * 0.05, -0.35, 0.35)
      const targetZ = clamp(vz * 0.05, -0.35, 0.35)
      scratch.sloshVelocity.x += ((targetX - scratch.slosh.x) * 70 - scratch.sloshVelocity.x * 5) * delta
      scratch.sloshVelocity.y += ((targetZ - scratch.slosh.y) * 70 - scratch.sloshVelocity.y * 5) * delta
      scratch.slosh.addScaledVector(scratch.sloshVelocity, delta)
    } else {
      scratch.lastCenter = new THREE.Vector3()
    }
    scratch.lastCenter.copy(scratch.liquidCenter)
    scratch.normal.set(scratch.slosh.x, 1, scratch.slosh.y).normalize()

    // Bottle fill.
    let u = bottleLiquidMaterial.userData.uniforms
    let [low, high] = extentAlong(mesh, scratch.normal, scratch.extent)
    u.uPlaneNormal.value.copy(scratch.normal)
    u.uPlaneLevel.value = lerp(low, high, l.bottleFill)

    // Glass fill.
    u = model.glassLiquidMaterial.userData.uniforms
    ;[low, high] = extentAlong(model.glassLiquidMesh, UP, scratch.extent)
    u.uPlaneLevel.value = lerp(low, high, l.glassFill * 1.002)
    model.glassLiquid.visible = l.glassFill > 0.001

    // The pour: a thin curved tube from the mouth of the bottle to the
    // surface of the drink, drawn only between its tail and its head.
    const head = l.streamHead
    const tail = l.streamTail
    const pouring = head - tail > 0.01
    stream.current.visible = pouring
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

      const points = []
      const steps = 18
      for (let i = 0; i <= steps; i++) points.push(scratch.curve.getPoint(lerp(tail, head, i / steps)))
      const radius = 0.05 * fit * b.scale
      stream.current.geometry.dispose()
      stream.current.geometry = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 28, radius, 10, false)
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

      {/* Lives outside the scaled group because it is built from world positions. */}
      <mesh ref={stream} material={streamMaterial} visible={false} frustumCulled={false}>
        <bufferGeometry />
      </mesh>
    </>
  )
}

// Studio lighting made of glowing panels. Glass and polished metal are mostly
// reflections, so these panels are what you actually see in the highlights.
function Lighting() {
  return (
    <>
      <ambientLight intensity={0.25} />
      <directionalLight position={[4, 6, 5]} intensity={1.6} />
      <pointLight position={[-5, -1, 3]} intensity={40} color="#ff8a2a" />
      <Environment resolution={256} frames={1}>
        <color attach="background" args={['#050302']} />
        <Lightformer form="rect" intensity={6} position={[0, 6, 2]} rotation-x={Math.PI / 2} scale={[9, 5, 1]} />
        <Lightformer form="rect" intensity={9} position={[-6, 1.5, 2]} rotation-y={Math.PI / 2} scale={[1.2, 9, 1]} />
        <Lightformer form="rect" intensity={7} position={[6, 0.5, 3]} rotation-y={-Math.PI / 2} scale={[0.8, 8, 1]} />
        <Lightformer form="rect" intensity={3} color="#ff9a3c" position={[3, -3, -6]} scale={[10, 3, 1]} />
        <Lightformer form="circle" intensity={12} position={[2.5, 3, 7]} rotation-y={Math.PI} scale={1.6} />
        <Lightformer form="rect" intensity={1.1} color="#ffb060" position={[-3, -5, 4]} rotation-x={-Math.PI / 2} scale={[8, 4, 1]} />
      </Environment>
    </>
  )
}

export default function Scene() {
  return (
    <Canvas
      dpr={[1, 2]}
      camera={{ fov: 30, near: 0.1, far: 60, position: [0, 0, 14] }}
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
    >
      <Lighting />
      <Suspense fallback={null}>
        <Whiskey />
      </Suspense>
    </Canvas>
  )
}

useGLTF.preload(MODEL_URL)
