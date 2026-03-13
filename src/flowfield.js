// src/flowfield.js
import * as THREE from "three"

export function createFlowField(scene, count = 1500) {

  const positions = new Float32Array(count * 6)
  const velocities = new Float32Array(count * 3)

  for (let i = 0; i < count; i++) {

    const x = -3 + Math.random() * 0.2
    const y = Math.random() * 2
    const z = (Math.random() - 0.5) * 3

    const i6 = i * 6
    const i3 = i * 3

    positions[i6 + 0] = x
    positions[i6 + 1] = y
    positions[i6 + 2] = z

    positions[i6 + 3] = x - 0.05
    positions[i6 + 4] = y
    positions[i6 + 5] = z

    velocities[i3 + 0] = 1
    velocities[i3 + 1] = (Math.random() - 0.5) * 0.02
    velocities[i3 + 2] = (Math.random() - 0.5) * 0.02
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3))

  const material = new THREE.LineBasicMaterial({
    color: 0x00e5ff,
    transparent: true,
    opacity: 0.85
  })

  const flowLines = new THREE.LineSegments(geometry, material)

  scene.add(flowLines)

  return {
    flowLines,
    positions,
    velocities,
    count
  }
}

export function updateFlowField(flow, delta, speed = 1.5) {

  const positions = flow.positions
  const velocities = flow.velocities
  const count = flow.count

  for (let i = 0; i < count; i++) {

    const i6 = i * 6
    const i3 = i * 3

    let x = positions[i6 + 0]
    let y = positions[i6 + 1]
    let z = positions[i6 + 2]

    x += velocities[i3 + 0] * speed * delta
    y += velocities[i3 + 1] * speed * delta
    z += velocities[i3 + 2] * speed * delta

    if (x > 5) {
      x = -3
      y = Math.random() * 2
      z = (Math.random() - 0.5) * 3
    }

    positions[i6 + 0] = x
    positions[i6 + 1] = y
    positions[i6 + 2] = z

    positions[i6 + 3] = x - 0.05
    positions[i6 + 4] = y
    positions[i6 + 5] = z
  }

  flow.flowLines.geometry.attributes.position.needsUpdate = true
}