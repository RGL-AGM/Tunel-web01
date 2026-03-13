import * as THREE from "three"

export function analyzeGeometry(object) {
  if (!object) return null

  object.updateMatrixWorld(true)

  const box = new THREE.Box3().setFromObject(object)
  const size = new THREE.Vector3()
  const center = new THREE.Vector3()

  box.getSize(size)
  box.getCenter(center)

  const length = size.x
  const height = size.y
  const width = size.z

  const frontalArea = height * width
  const surfaceArea = computeSurfaceAreaWorld(object)
  const volume = length * width * height

  return {
    length,
    width,
    height,
    frontalArea,
    surfaceArea,
    volume,
    center
  }
}

export function computeSurfaceAreaWorld(object) {
  let totalArea = 0

  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()

  const ab = new THREE.Vector3()
  const ac = new THREE.Vector3()
  const cross = new THREE.Vector3()

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
      cross.crossVectors(ab, ac)

      totalArea += cross.length() * 0.5
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

  return totalArea
}