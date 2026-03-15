import * as THREE from "three"

const AIR_DENSITY = 1.225

export function computeAerodynamics(object, geometryData, velocityKmh) {
  if (!object || !geometryData) return null

  object.updateMatrixWorld(true)

  const flowDir = new THREE.Vector3(1, 0, 0)
  const velocityMS = velocityKmh / 3.6

  let frontWeightedArea = 0
  let verticalForceProxy = 0

  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()
  const ab = new THREE.Vector3()
  const ac = new THREE.Vector3()
  const normal = new THREE.Vector3()

  object.traverse((child) => {
    if (!child.isMesh || !child.geometry?.attributes?.position) return

    child.updateMatrixWorld(true)

    const geometry = child.geometry
    const pos = geometry.attributes.position
    const index = geometry.index

    let triangleCount = index ? index.count / 3 : pos.count / 3
    let step = 1

    if (triangleCount > 200000) step = 30
    else if (triangleCount > 100000) step = 20
    else if (triangleCount > 50000) step = 10
    else if (triangleCount > 20000) step = 5
    else if (triangleCount > 10000) step = 3
    else if (triangleCount > 5000) step = 2

    let sampledFrontArea = 0
    let sampledVertical = 0
    let sampledTriangles = 0

    const addTriangle = (ia, ib, ic) => {
      a.fromBufferAttribute(pos, ia).applyMatrix4(child.matrixWorld)
      b.fromBufferAttribute(pos, ib).applyMatrix4(child.matrixWorld)
      c.fromBufferAttribute(pos, ic).applyMatrix4(child.matrixWorld)

      ab.subVectors(b, a)
      ac.subVectors(c, a)
      normal.crossVectors(ab, ac)

      const area2 = normal.length()
      if (area2 < 1e-12) return

      const area = area2 * 0.5
      normal.normalize()

      const facing = Math.max(0, -normal.dot(flowDir))
      sampledFrontArea += area * facing
      sampledVertical += area * normal.y * facing
      sampledTriangles++
    }

    if (index) {
      for (let i = 0; i < index.count; i += 3 * step) {
        addTriangle(index.getX(i), index.getX(i + 1), index.getX(i + 2))
      }
    } else {
      for (let i = 0; i < pos.count; i += 3 * step) {
        addTriangle(i, i + 1, i + 2)
      }
    }

    if (sampledTriangles > 0) {
      frontWeightedArea += sampledFrontArea * step
      verticalForceProxy += sampledVertical * step
    }
  })

  const frontalArea = Math.max(geometryData.frontalArea, 1e-6)

  const shapeFactor = frontWeightedArea / frontalArea
  let Cd = 0.18 + shapeFactor * 0.12
  Cd = clamp(Cd, 0.18, 0.75)

  let Cl = -(verticalForceProxy / frontalArea) * 0.08
  Cl = clamp(Cl, -1.5, 1.0)

  const q = 0.5 * AIR_DENSITY * velocityMS * velocityMS

  const drag = q * Cd * frontalArea
  const lift = q * Cl * frontalArea
  const downforce = Math.max(0, -lift)
  const wakeIndex = clamp((Cd - 0.18) / 0.57, 0.12, 1.0)
  const aeroEfficiency = Math.abs(Cl) / Math.max(Cd, 1e-6)

  return {
    airDensity: AIR_DENSITY,
    velocityKmh,
    velocityMS,
    Cd,
    Cl,
    drag,
    lift,
    downforce,
    wakeIndex,
    aeroEfficiency,
    frontWeightedArea,
    verticalForceProxy,
  }
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}