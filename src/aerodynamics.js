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

      // Superficies enfrentadas al flujo
      const facing = Math.max(0, -normal.dot(flowDir))
      frontWeightedArea += area * facing

      // Proxy vertical para downforce/lift
      verticalForceProxy += area * normal.y * facing
    }

    if (index) {
      for (let i = 0; i < index.count; i += 3) {
        addTriangle(index.getX(i), index.getX(i + 1), index.getX(i + 2))
      }
    } else {
      for (let i = 0; i < pos.count; i += 3) {
        addTriangle(i, i + 1, i + 2)
      }
    }
  })

  const frontalArea = Math.max(geometryData.frontalArea, 1e-6)

  // Cd estimado acotado a rango razonable
  const shapeFactor = frontWeightedArea / frontalArea
  let Cd = 0.18 + shapeFactor * 0.12
  Cd = Math.min(Math.max(Cd, 0.18), 1.20)

  const drag =
    0.5 *
    AIR_DENSITY *
    Cd *
    frontalArea *
    velocityMS *
    velocityMS

  // Downforce estimado y acotado
  let Cl = -verticalForceProxy / Math.max(frontalArea, 1e-6) * 0.08
  Cl = Math.min(Math.max(Cl, -3.0), 1.5)

  const downforce =
    0.5 *
    AIR_DENSITY *
    Math.abs(Cl) *
    frontalArea *
    velocityMS *
    velocityMS *
    Math.sign(-Cl)

  return {
    airDensity: AIR_DENSITY,
    velocityKmh,
    velocityMS,
    Cd,
    Cl,
    drag,
    downforce,
    frontWeightedArea,
    verticalForceProxy
  }
}