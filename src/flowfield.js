import * as THREE from "three"

export function getFlowCountByQuality(quality = "MEDIUM") {
  if (quality === "LOW") return 120
  if (quality === "HIGH") return 400
  return 220
}

export function createFlowField(scene, quality = "MEDIUM") {
  const count = getFlowCountByQuality(quality)
  const segmentsPerLine = quality === "HIGH" ? 24 : 18
  const pointsPerLine = segmentsPerLine + 1

  const positions = new Float32Array(count * pointsPerLine * 3)
  const velocities = new Float32Array(count * 3)

  const seedCols = Math.max(6, Math.floor(Math.sqrt(count)))
  const seedRows = Math.ceil(count / seedCols)

  let n = 0
  for (let r = 0; r < seedRows; r++) {
    for (let c = 0; c < seedCols; c++) {
      if (n >= count) break

      const x = -8 + Math.random() * 1.5
      const y = 0.35 + (r / Math.max(1, seedRows - 1)) * 2.8
      const z = -3.5 + (c / Math.max(1, seedCols - 1)) * 7.0

      resetLineWithSeed(n, positions, velocities, pointsPerLine, x, y, z)
      n++
    }
  }

  const material = new THREE.LineBasicMaterial({
    color: 0x00e5ff,
    transparent: true,
    opacity: 0.85,
  })

  const flowLines = new THREE.LineSegments(
    buildSegmentGeometryFromPolylinePositions(positions, count, pointsPerLine),
    material
  )
  flowLines.frustumCulled = false
  scene.add(flowLines)

  const sliceCanvas = document.createElement("canvas")
  sliceCanvas.width = quality === "HIGH" ? 320 : quality === "LOW" ? 180 : 220
  sliceCanvas.height = quality === "HIGH" ? 160 : quality === "LOW" ? 96 : 120
  const sliceCtx = sliceCanvas.getContext("2d")

  const sliceTexture = new THREE.CanvasTexture(sliceCanvas)
  sliceTexture.needsUpdate = true

  const sliceMaterial = new THREE.MeshBasicMaterial({
    map: sliceTexture,
    transparent: true,
    opacity: 0.34,
    side: THREE.DoubleSide,
    depthWrite: false,
  })

  const slicePlane = new THREE.Mesh(
    new THREE.PlaneGeometry(3.8, 1.9),
    sliceMaterial
  )
  slicePlane.position.set(3.5, 1.2, 0)
  slicePlane.renderOrder = 2
  scene.add(slicePlane)

  return {
    flowLines,
    positions,
    velocities,
    count,
    pointsPerLine,
    sliceCanvas,
    sliceCtx,
    sliceTexture,
    slicePlane,
    quality,
  }
}

export function disposeFlowField(scene, flow) {
  if (!flow) return
  scene.remove(flow.flowLines)
  scene.remove(flow.slicePlane)
  flow.flowLines.geometry.dispose()
  flow.flowLines.material.dispose()
  flow.slicePlane.geometry.dispose()
  flow.slicePlane.material.map?.dispose?.()
  flow.slicePlane.material.dispose()
}

export function resetFlowField(flow) {
  const { positions, velocities, count, pointsPerLine } = flow

  const seedCols = Math.max(6, Math.floor(Math.sqrt(count)))
  const seedRows = Math.ceil(count / seedCols)

  let n = 0
  for (let r = 0; r < seedRows; r++) {
    for (let c = 0; c < seedCols; c++) {
      if (n >= count) break

      const x = -8 + Math.random() * 1.5
      const y = 0.35 + (r / Math.max(1, seedRows - 1)) * 2.8
      const z = -3.5 + (c / Math.max(1, seedCols - 1)) * 7.0

      resetLineWithSeed(n, positions, velocities, pointsPerLine, x, y, z)
      n++
    }
  }

  rebuildLineSegmentsGeometry(flow)
}

export function updateFlowField(flow, delta, speed = 1.0) {
  const { positions, velocities, count, pointsPerLine } = flow

  for (let i = 0; i < count; i++) {
    const lineBase = i * pointsPerLine * 3
    const velBase = i * 3

    for (let p = pointsPerLine - 1; p > 0; p--) {
      const dst = lineBase + p * 3
      const src = lineBase + (p - 1) * 3

      positions[dst + 0] = positions[src + 0]
      positions[dst + 1] = positions[src + 1]
      positions[dst + 2] = positions[src + 2]
    }

    let x = positions[lineBase + 0]
    let y = positions[lineBase + 1]
    let z = positions[lineBase + 2]

    x += velocities[velBase + 0] * speed * delta
    y += velocities[velBase + 1] * speed * delta
    z += velocities[velBase + 2] * speed * delta

    if (x > 12 || y < -1 || y > 8 || z < -10 || z > 10) {
      const sx = -8 + Math.random() * 1.5
      const sy = 0.35 + Math.random() * 2.8
      const sz = -3.5 + Math.random() * 7.0
      resetLineWithSeed(i, positions, velocities, pointsPerLine, sx, sy, sz)
      continue
    }

    positions[lineBase + 0] = x
    positions[lineBase + 1] = y
    positions[lineBase + 2] = z
  }

  rebuildLineSegmentsGeometry(flow)
}

function resetLineWithSeed(i, positions, velocities, pointsPerLine, x, y, z) {
  const lineBase = i * pointsPerLine * 3
  const velBase = i * 3

  velocities[velBase + 0] = 1.0
  velocities[velBase + 1] = (Math.random() - 0.5) * 0.01
  velocities[velBase + 2] = (Math.random() - 0.5) * 0.01

  for (let p = 0; p < pointsPerLine; p++) {
    const idx = lineBase + p * 3
    positions[idx + 0] = x - p * 0.08
    positions[idx + 1] = y
    positions[idx + 2] = z
  }
}

function buildSegmentGeometryFromPolylinePositions(positions, count, pointsPerLine) {
  const segPositions = new Float32Array(count * (pointsPerLine - 1) * 2 * 3)
  let write = 0

  for (let i = 0; i < count; i++) {
    const lineBase = i * pointsPerLine * 3

    for (let p = 0; p < pointsPerLine - 1; p++) {
      const a = lineBase + p * 3
      const b = lineBase + (p + 1) * 3

      segPositions[write++] = positions[a + 0]
      segPositions[write++] = positions[a + 1]
      segPositions[write++] = positions[a + 2]

      segPositions[write++] = positions[b + 0]
      segPositions[write++] = positions[b + 1]
      segPositions[write++] = positions[b + 2]
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute("position", new THREE.BufferAttribute(segPositions, 3))
  return geometry
}

function rebuildLineSegmentsGeometry(flow) {
  const oldGeometry = flow.flowLines.geometry
  flow.flowLines.geometry = buildSegmentGeometryFromPolylinePositions(
    flow.positions,
    flow.count,
    flow.pointsPerLine
  )
  oldGeometry.dispose()
}