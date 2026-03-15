import * as THREE from "three"
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js"
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js"
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"

import {
  createFlowField,
  updateFlowField,
  resetFlowField,
  disposeFlowField,
} from "./flowfield.js"
import { analyzeGeometry } from "./geometry.js"
import { computeAerodynamics } from "./aerodynamics.js"
import { computeVehicleDynamics } from "./vehicleDynamics.js"
import { saveTestResult, exportCSV } from "./export.js"

const SOFTWARE_VERSION = "R02.1"

const ui = {
  fileInput: document.getElementById("fileInput"),
  clearModel: document.getElementById("clearModel"),
  exportCsvBtn: document.getElementById("exportCsvBtn"),

  speed: document.getElementById("speed"),
  ground: document.getElementById("ground"),
  quality: document.getElementById("quality"),
  showFlow: document.getElementById("showFlow"),
  showWake: document.getElementById("showWake"),
  showPressure: document.getElementById("showPressure"),
  showFloor: document.getElementById("showFloor"),

  playBtn: document.getElementById("playBtn"),
  stopBtn: document.getElementById("stopBtn"),
  resetCam: document.getElementById("resetCam"),

  massInput: document.getElementById("massInput"),
  powerInput: document.getElementById("powerInput"),
  crrInput: document.getElementById("crrInput"),

  rotXPos: document.getElementById("rotXPos"),
  rotXNeg: document.getElementById("rotXNeg"),
  rotYPos: document.getElementById("rotYPos"),
  rotYNeg: document.getElementById("rotYNeg"),
  rotZPos: document.getElementById("rotZPos"),
  rotZNeg: document.getElementById("rotZNeg"),

  realLength: document.getElementById("realLength"),
  realWidth: document.getElementById("realWidth"),
  realHeight: document.getElementById("realHeight"),
  applyUniformScale: document.getElementById("applyUniformScale"),
  applyXYZScale: document.getElementById("applyXYZScale"),
  resetScale: document.getElementById("resetScale"),

  speedVal: document.getElementById("speedVal"),
  groundVal: document.getElementById("groundVal"),

  lengthOut: document.getElementById("lengthOut"),
  widthOut: document.getElementById("widthOut"),
  heightOut: document.getElementById("heightOut"),
  frontalAreaOut: document.getElementById("frontalAreaOut"),
  surfaceAreaOut: document.getElementById("surfaceAreaOut"),
  complexityOut: document.getElementById("complexityOut"),
  modelStatusOut: document.getElementById("modelStatusOut"),

  cxOut: document.getElementById("cxOut"),
  clOut: document.getElementById("clOut"),
  dragOut: document.getElementById("dragOut"),
  downforceOut: document.getElementById("downforceOut"),
  wakeOut: document.getElementById("wakeOut"),
  efficiencyOut: document.getElementById("efficiencyOut"),
  powerReqOut: document.getElementById("powerReqOut"),
  topSpeedOut: document.getElementById("topSpeedOut"),

  viewerSpeedOut: document.getElementById("viewerSpeedOut"),
  massOut: document.getElementById("massOut"),
  viewerFrontalAreaOut: document.getElementById("viewerFrontalAreaOut"),
  rollingOut: document.getElementById("rollingOut"),
  viewerLengthOut: document.getElementById("viewerLengthOut"),
  viewerWidthOut: document.getElementById("viewerWidthOut"),

  dropzone: document.getElementById("dropzone"),
  simStatus: document.getElementById("simStatus"),
  fpsBox: document.getElementById("fpsBox"),
  softwareVersion: document.getElementById("softwareVersion"),
}

if (ui.softwareVersion) ui.softwareVersion.textContent = SOFTWARE_VERSION

function fmt(v, d = 2, s = "") {
  if (v === null || v === undefined || Number.isNaN(v)) return "—"
  return `${Number(v).toFixed(d)}${s}`
}

function readPositiveInput(el) {
  const v = Number(el?.value)
  return Number.isFinite(v) && v > 0 ? v : null
}

function updateLabels() {
  if (ui.speedVal) ui.speedVal.textContent = `${ui.speed.value} km/h`
  if (ui.groundVal) ui.groundVal.textContent = `${Number(ui.ground.value).toFixed(2)} m`
}
updateLabels()

const canvas = document.getElementById("mainCanvas")

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
})
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.shadowMap.enabled = true

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x20242c)

const camera = new THREE.PerspectiveCamera(55, 1, 0.01, 1000)
camera.position.set(4, 2.5, 4)

const controls = new OrbitControls(camera, renderer.domElement)
controls.target.set(0, 0.5, 0)
controls.update()

scene.add(new THREE.AmbientLight(0xffffff, 0.62))

const hemi = new THREE.HemisphereLight(0xbfd4ff, 0x33404f, 0.38)
scene.add(hemi)

const sun = new THREE.DirectionalLight(0xffffff, 0.95)
sun.position.set(7, 12, 7)
sun.castShadow = true
scene.add(sun)

const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(120, 120),
  new THREE.MeshStandardMaterial({
    color: 0x2c313a,
    roughness: 0.95,
    metalness: 0.0,
  })
)
floor.rotation.x = -Math.PI / 2
floor.receiveShadow = true
scene.add(floor)

const grid = new THREE.GridHelper(120, 120, 0x4a5568, 0x2d3748)
scene.add(grid)

const contactShadow = new THREE.Mesh(
  new THREE.CircleGeometry(1, 64),
  new THREE.MeshBasicMaterial({
    color: 0x000000,
    transparent: true,
    opacity: 0.25,
  })
)
contactShadow.rotation.x = -Math.PI / 2
scene.add(contactShadow)

const modelRoot = new THREE.Group()
scene.add(modelRoot)

const stlLoader = new STLLoader()
const objLoader = new OBJLoader()
const gltfLoader = new GLTFLoader()

const appState = {
  currentModel: null,
  modelName: "",
  modelBounds: null,
  geometry: null,
  aero: null,
  dynamics: null,
  simulationRunning: false,
  flow: null,
  fpsFrames: 0,
  fpsAccum: 0,
}

const raycaster = new THREE.Raycaster()
const clock = new THREE.Clock()

buildFlowField()
resizeRenderer()

function updateSimulationStatus() {
  if (ui.simStatus) ui.simStatus.textContent = appState.simulationRunning ? "RUNNING" : "STOPPED"
}

function updateFPS(dt) {
  appState.fpsFrames++
  appState.fpsAccum += dt

  if (appState.fpsAccum >= 0.5) {
    const fps = Math.round(appState.fpsFrames / appState.fpsAccum)
    if (ui.fpsBox) ui.fpsBox.textContent = `FPS ${fps}`
    appState.fpsFrames = 0
    appState.fpsAccum = 0
  }
}

function createBaseMaterial() {
  return new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.42,
    metalness: 0.18,
    vertexColors: true,
  })
}

function setModelMaterials(object) {
  object.traverse?.((child) => {
    if (!child.isMesh) return
    child.geometry?.computeVertexNormals?.()
    child.material = createBaseMaterial()
    child.castShadow = true
  })

  if (object.isMesh) {
    object.geometry?.computeVertexNormals?.()
    object.material = createBaseMaterial()
    object.castShadow = true
  }
}

function pressureFromNormal(normal) {
  const flowDir = new THREE.Vector3(1, 0, 0)
  let p = Math.max(0, -(normal.x * flowDir.x + normal.y * flowDir.y + normal.z * flowDir.z))
  p = Math.min(1, p * 1.8)
  return p
}

function applyPressureMap(object) {
  const paintMesh = (mesh) => {
    const geometry = mesh.geometry
    if (!geometry?.attributes?.position) return

    geometry.computeVertexNormals()

    const normals = geometry.attributes.normal
    const positions = geometry.attributes.position
    const vcount = positions.count
    const colors = new Float32Array(vcount * 3)

    let step = 1
    if (vcount > 300000) step = 20
    else if (vcount > 150000) step = 10
    else if (vcount > 80000) step = 5
    else if (vcount > 30000) step = 2

    for (let i = 0; i < vcount; i += step) {
      const normal = new THREE.Vector3(
        normals.getX(i),
        normals.getY(i),
        normals.getZ(i)
      ).normalize()

      const p = pressureFromNormal(normal)

      for (let j = 0; j < step && i + j < vcount; j++) {
        const k = i + j
        colors[k * 3 + 0] = p
        colors[k * 3 + 1] = 0.05
        colors[k * 3 + 2] = 1 - p
      }
    }

    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3))
    mesh.material.vertexColors = true
    mesh.material.color.set(0xffffff)
    mesh.material.needsUpdate = true
  }

  object.traverse?.((child) => {
    if (child.isMesh) paintMesh(child)
  })

  if (object.isMesh) paintMesh(object)
}

function removePressureMap(object) {
  object.traverse?.((child) => {
    if (!child.isMesh) return
    child.material.vertexColors = false
    child.material.color.set(0xffffff)
    child.material.needsUpdate = true
  })

  if (object.isMesh) {
    object.material.vertexColors = false
    object.material.color.set(0xffffff)
    object.material.needsUpdate = true
  }
}

function updatePressureDisplay() {
  if (!appState.currentModel) return
  if (ui.showPressure?.checked) applyPressureMap(appState.currentModel)
  else removePressureMap(appState.currentModel)
}

function updateFloorVisuals() {
  const y = Math.max(0, Number(ui.ground?.value ?? 0.1))
  floor.position.y = y
  grid.position.y = y + 0.001
  contactShadow.position.y = y + 0.002

  const visible = ui.showFloor?.checked ?? true
  floor.visible = visible
  grid.visible = visible
  contactShadow.visible = visible
}
updateFloorVisuals()

function updateContactShadow() {
  if (!appState.modelBounds) {
    contactShadow.scale.set(0.0001, 0.0001, 1)
    return
  }

  const size = new THREE.Vector3()
  const center = new THREE.Vector3()
  appState.modelBounds.getSize(size)
  appState.modelBounds.getCenter(center)

  const r = 0.62 * Math.max(size.x, size.z)
  contactShadow.scale.set(r, r, 1)
  contactShadow.position.set(center.x, floor.position.y + 0.002, center.z)
}

function fitCameraToModel() {
  if (!appState.modelBounds) return

  const size = new THREE.Vector3()
  const center = new THREE.Vector3()
  appState.modelBounds.getSize(size)
  appState.modelBounds.getCenter(center)

  const maxDim = Math.max(size.x, size.y, size.z)
  const dist = Math.max(maxDim * 2.0, 2.6)

  controls.target.copy(center)
  camera.position.set(center.x + dist, center.y + dist * 0.6, center.z + dist)
  camera.near = Math.max(0.01, dist / 300)
  camera.far = dist * 80
  camera.updateProjectionMatrix()
  controls.update()
}

function updateSlicePlanePlacement() {
  if (!appState.flow?.slicePlane || !appState.modelBounds) return

  const size = new THREE.Vector3()
  const center = new THREE.Vector3()
  appState.modelBounds.getSize(size)
  appState.modelBounds.getCenter(center)

  appState.flow.slicePlane.scale.set(
    Math.max(0.8, size.y * 0.9),
    Math.max(0.8, size.y * 0.9),
    1
  )

  appState.flow.slicePlane.position.set(
    appState.modelBounds.max.x + Math.max(0.8, size.x * 0.35),
    center.y + size.y * 0.15,
    center.z
  )
}

function updateSlicePlane() {
  const flow = appState.flow
  if (!flow?.sliceCtx || !flow.sliceCanvas || !flow.sliceTexture) return

  const ctx = flow.sliceCtx
  const canvas2 = flow.sliceCanvas
  const tex = flow.sliceTexture

  const w = canvas2.width
  const h = canvas2.height

  ctx.clearRect(0, 0, w, h)

  const wakeLevel = appState.aero ? Math.min(1, appState.aero.wakeIndex) : 0

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const nx = x / w
      const ny = y / h

      const rearMask = Math.max(0, (nx - 0.18) / 0.82)
      const wakeCore = Math.exp(-Math.pow((nx - 0.35) * 4.5, 2))
      const verticalShape = Math.exp(-Math.pow((ny - 0.5) * 3.6, 2))
      const noise =
        0.85 +
        0.15 * Math.sin(nx * 28.0 + ny * 11.0) +
        0.10 * Math.sin(nx * 53.0 - ny * 17.0)

      let intensity = rearMask * wakeCore * verticalShape * noise * wakeLevel
      intensity = Math.max(0, Math.min(1, intensity))

      const r = Math.floor(255 * intensity)
      const g = Math.floor(220 * (1 - intensity) + 25)
      const b = Math.floor(255 * (1 - intensity * 0.65))

      ctx.fillStyle = `rgba(${r},${g},${b},0.92)`
      ctx.fillRect(x, y, 1, 1)
    }
  }

  tex.needsUpdate = true
}

function normalizeModelUnits(object) {
  object.updateMatrixWorld(true)

  const box = new THREE.Box3().setFromObject(object)
  const size = new THREE.Vector3()
  box.getSize(size)

  let maxDim = Math.max(size.x, size.y, size.z)
  if (maxDim <= 0) return

  let scale = 1

  while (maxDim > 12) {
    maxDim /= 10
    scale /= 10
  }

  while (maxDim < 0.5) {
    maxDim *= 10
    scale *= 10
  }

  if (scale !== 1) {
    object.scale.multiplyScalar(scale)
    object.updateMatrixWorld(true)
  }
}

function fixUpright(object) {
  object.updateMatrixWorld(true)

  const getSize = () => {
    const box = new THREE.Box3().setFromObject(object)
    const size = new THREE.Vector3()
    box.getSize(size)
    return size
  }

  let size = getSize()

  if (size.y > size.x * 1.4 && size.y > size.z * 1.4) {
    object.rotation.z += Math.PI / 2
    object.updateMatrixWorld(true)
    size = getSize()
  }

  if (size.y > size.z * 1.15) {
    object.rotation.x += Math.PI / 2
    object.updateMatrixWorld(true)
  }
}

function alignToFlowYaw(object) {
  const box = new THREE.Box3().setFromObject(object)
  const size = new THREE.Vector3()
  box.getSize(size)

  if (size.z > size.x) {
    object.rotation.y -= Math.PI / 2
    object.updateMatrixWorld(true)
  }
}

function placeModelOnGround() {
  if (!appState.currentModel) return

  const y = Math.max(0, Number(ui.ground?.value ?? 0.1))
  const box = new THREE.Box3().setFromObject(appState.currentModel)
  appState.currentModel.position.y += (y - box.min.y)
  appState.currentModel.updateMatrixWorld(true)

  appState.modelBounds = new THREE.Box3().setFromObject(appState.currentModel)
  updateContactShadow()
  updateSlicePlanePlacement()
}

function rotateCurrentModel(rx = 0, ry = 0, rz = 0) {
  if (!appState.currentModel) return

  appState.currentModel.rotation.x += rx
  appState.currentModel.rotation.y += ry
  appState.currentModel.rotation.z += rz
  appState.currentModel.updateMatrixWorld(true)

  const box = new THREE.Box3().setFromObject(appState.currentModel)
  const center = new THREE.Vector3()
  box.getCenter(center)
  appState.currentModel.position.sub(center)
  appState.currentModel.updateMatrixWorld(true)

  placeModelOnGround()
  updatePressureDisplay()
  fitCameraToModel()
  recomputeMetrics()
}

function normalizeAndPlace(object) {
  setModelMaterials(object)

  modelRoot.add(object)
  appState.currentModel = object

  fixUpright(object)
  alignToFlowYaw(object)
  normalizeModelUnits(object)
  object.updateMatrixWorld(true)

  const box = new THREE.Box3().setFromObject(object)
  const center = new THREE.Vector3()
  box.getCenter(center)
  object.position.sub(center)
  object.updateMatrixWorld(true)

  placeModelOnGround()
  fitCameraToModel()

  if (ui.showPressure?.checked) {
    requestAnimationFrame(() => updatePressureDisplay())
  }
}

function getMass() {
  return Math.max(100, Number(ui.massInput?.value ?? 1500))
}

function getMotorPowerKw() {
  return Math.max(1, Number(ui.powerInput?.value ?? 150))
}

function getRollingCoeff() {
  return Math.max(0.005, Number(ui.crrInput?.value ?? 0.012))
}

function recomputeMetrics() {
  if (!appState.currentModel) {
    appState.geometry = null
    appState.aero = null
    appState.dynamics = null
    writeOutputs()
    return
  }

  appState.currentModel.updateMatrixWorld(true)
  appState.geometry = analyzeGeometry(appState.currentModel)

  const velocityKmh = Number(ui.speed?.value ?? 120)
  appState.aero = computeAerodynamics(appState.currentModel, appState.geometry, velocityKmh)

  appState.dynamics = computeVehicleDynamics(appState.aero, {
    mass: getMass(),
    rollingCoeff: getRollingCoeff(),
    motorPowerKw: getMotorPowerKw(),
    frontalArea: appState.geometry.frontalArea,
  })

  if (appState.modelBounds == null) {
    appState.modelBounds = new THREE.Box3().setFromObject(appState.currentModel)
  }

  updateSlicePlane()
  updateModelComplexityStatus()
  writeOutputs()
}

function updateModelComplexityStatus() {
  if (!appState.geometry) {
    ui.complexityOut.textContent = "—"
    ui.modelStatusOut.textContent = "Sin modelo"
    return
  }

  const tri = appState.geometry.triangleCount
  ui.complexityOut.textContent = `${tri.toLocaleString()} tris`

  if (tri > 300000) {
    ui.modelStatusOut.textContent = "Pesado"
    if (ui.quality.value !== "LOW") {
      ui.quality.value = "LOW"
      rebuildFlowField()
    }
  } else if (tri > 100000) {
    ui.modelStatusOut.textContent = "Medio"
  } else {
    ui.modelStatusOut.textContent = "Óptimo"
  }
}

function writeOutputs() {
  const g = appState.geometry
  const a = appState.aero
  const d = appState.dynamics

  ui.lengthOut.textContent = g ? fmt(g.length, 2, " m") : "—"
  ui.widthOut.textContent = g ? fmt(g.width, 2, " m") : "—"
  ui.heightOut.textContent = g ? fmt(g.height, 2, " m") : "—"
  ui.frontalAreaOut.textContent = g ? fmt(g.frontalArea, 2, " m²") : "—"
  ui.surfaceAreaOut.textContent = g ? fmt(g.surfaceArea, 2, " m²") : "—"

  ui.cxOut.textContent = a ? fmt(a.Cd, 3) : "—"
  ui.clOut.textContent = a ? fmt(a.Cl, 3) : "—"
  ui.dragOut.textContent = a ? fmt(a.drag, 1, " N") : "—"
  ui.downforceOut.textContent = a ? fmt(a.downforce, 1, " N") : "—"
  ui.wakeOut.textContent = a ? fmt(a.wakeIndex, 2) : "—"
  ui.efficiencyOut.textContent = a ? fmt(a.aeroEfficiency, 2) : "—"

  ui.powerReqOut.textContent = d ? fmt(d.requiredPowerKw, 1, " kW") : "—"
  ui.topSpeedOut.textContent = d?.estimatedTopSpeedKmh ? fmt(d.estimatedTopSpeedKmh, 0, " km/h") : "—"

  ui.viewerSpeedOut.textContent = fmt(Number(ui.speed?.value ?? 0), 0, " km/h")
  ui.massOut.textContent = fmt(getMass(), 0, " kg")
  ui.viewerFrontalAreaOut.textContent = g ? fmt(g.frontalArea, 2, " m²") : "—"
  ui.rollingOut.textContent = d ? fmt(d.rollingResistance, 1, " N") : "—"
  ui.viewerLengthOut.textContent = g ? fmt(g.length, 2, " m") : "—"
  ui.viewerWidthOut.textContent = g ? fmt(g.width, 2, " m") : "—"

  if (ui.dropzone) ui.dropzone.classList.toggle("hidden", Boolean(appState.currentModel))
}

function applyUniformRealScale() {
  if (!appState.currentModel || !appState.geometry) return

  const realLength = readPositiveInput(ui.realLength)
  if (!realLength || appState.geometry.length <= 0) return

  const factor = realLength / appState.geometry.length
  appState.currentModel.scale.multiplyScalar(factor)
  appState.currentModel.updateMatrixWorld(true)

  placeModelOnGround()
  updatePressureDisplay()
  fitCameraToModel()
  recomputeMetrics()
}

function applyXYZRealScale() {
  if (!appState.currentModel || !appState.geometry) return

  const realLength = readPositiveInput(ui.realLength)
  const realWidth = readPositiveInput(ui.realWidth)
  const realHeight = readPositiveInput(ui.realHeight)

  if (!realLength || !realWidth || !realHeight) return
  if (appState.geometry.length <= 0 || appState.geometry.width <= 0 || appState.geometry.height <= 0) return

  appState.currentModel.scale.x *= realLength / appState.geometry.length
  appState.currentModel.scale.y *= realHeight / appState.geometry.height
  appState.currentModel.scale.z *= realWidth / appState.geometry.width
  appState.currentModel.updateMatrixWorld(true)

  placeModelOnGround()
  updatePressureDisplay()
  fitCameraToModel()
  recomputeMetrics()
}

function resetScale() {
  if (!appState.currentModel) return

  appState.currentModel.scale.set(1, 1, 1)
  appState.currentModel.updateMatrixWorld(true)

  placeModelOnGround()
  updatePressureDisplay()
  fitCameraToModel()
  recomputeMetrics()
}

function clearModel() {
  if (appState.currentModel) {
    modelRoot.remove(appState.currentModel)
    appState.currentModel = null
  }

  appState.modelBounds = null
  appState.geometry = null
  appState.aero = null
  appState.dynamics = null
  appState.modelName = ""
  writeOutputs()
  if (appState.flow) resetFlowField(appState.flow)
  updateModelComplexityStatus()
}

function handleLoadedObject(object, fileName = "") {
  clearModel()
  appState.modelName = fileName
  normalizeAndPlace(object)
  recomputeMetrics()
  if (appState.flow) resetFlowField(appState.flow)
}

function loadFile(file) {
  if (!file) return

  const url = URL.createObjectURL(file)
  const ext = file.name.split(".").pop().toLowerCase()

  if (ext === "stl") {
    stlLoader.load(
      url,
      (geometry) => {
        geometry.computeVertexNormals()
        const mesh = new THREE.Mesh(geometry, createBaseMaterial())
        handleLoadedObject(mesh, file.name)
        URL.revokeObjectURL(url)
      },
      undefined,
      () => URL.revokeObjectURL(url)
    )
    return
  }

  if (ext === "obj") {
    objLoader.load(
      url,
      (obj) => {
        handleLoadedObject(obj, file.name)
        URL.revokeObjectURL(url)
      },
      undefined,
      () => URL.revokeObjectURL(url)
    )
    return
  }

  if (ext === "glb" || ext === "gltf") {
    gltfLoader.load(
      url,
      (gltf) => {
        handleLoadedObject(gltf.scene, file.name)
        URL.revokeObjectURL(url)
      },
      undefined,
      () => URL.revokeObjectURL(url)
    )
    return
  }

  URL.revokeObjectURL(url)
}

function updateFlowVisibility() {
  if (!appState.flow) return
  appState.flow.flowLines.visible = ui.showFlow?.checked ?? true
  appState.flow.slicePlane.visible = (ui.showWake?.checked ?? true) && (ui.showFlow?.checked ?? true)
}

function sculptFlowAroundModel() {
  if (!appState.currentModel || !(ui.showFlow?.checked ?? true) || !appState.aero || !appState.modelBounds || !appState.flow) {
    return
  }

  const positions = appState.flow.positions
  const velocities = appState.flow.velocities
  const count = appState.flow.count
  const pointsPerLine = appState.flow.pointsPerLine

  const wakeStart = appState.modelBounds.max.x
  const baseWake = (ui.showWake?.checked ?? true) ? 0.18 : 0.0
  const globalWakeIntensity = baseWake * (0.55 + appState.aero.wakeIndex * 0.9)

  const avoidDist = 0.22
  const pushStrength = 2.6

  const pos = new THREE.Vector3()
  const dir = new THREE.Vector3(-1, 0, 0)
  const normal = new THREE.Vector3()

  for (let i = 0; i < count; i++) {
    const lineBase = i * pointsPerLine * 3
    const i3 = i * 3

    pos.set(
      positions[lineBase + 0],
      positions[lineBase + 1],
      positions[lineBase + 2]
    )

    velocities[i3 + 0] += (1.0 - velocities[i3 + 0]) * 0.02
    velocities[i3 + 1] *= 0.985
    velocities[i3 + 2] *= 0.985

    raycaster.set(pos, dir)
    raycaster.far = avoidDist

    const hits = raycaster.intersectObject(appState.currentModel, true)

    if (hits.length > 0) {
      const hit = hits[0]

      if (hit.face?.normal) {
        normal.copy(hit.face.normal).transformDirection(hit.object.matrixWorld).normalize()
      } else {
        normal.set(0, 1, 0)
      }

      const localPressure = pressureFromNormal(normal)

      velocities[i3 + 0] *= 0.83 - localPressure * 0.18
      velocities[i3 + 1] += normal.y * pushStrength * (0.012 + localPressure * 0.014)
      velocities[i3 + 2] += normal.z * pushStrength * (0.012 + localPressure * 0.014)

      if (ui.showWake?.checked ?? true) {
        velocities[i3 + 1] += (Math.random() - 0.5) * localPressure * 0.10
        velocities[i3 + 2] += (Math.random() - 0.5) * localPressure * 0.10
      }
    }

    if (pos.x > wakeStart && (ui.showWake?.checked ?? true)) {
      velocities[i3 + 1] += (Math.random() - 0.5) * globalWakeIntensity
      velocities[i3 + 2] += (Math.random() - 0.5) * globalWakeIntensity
      velocities[i3 + 0] *= 0.99 - appState.aero.wakeIndex * 0.012
    }

    if (pos.y < floor.position.y + 0.02) {
      velocities[i3 + 1] = Math.abs(velocities[i3 + 1]) + 0.01
    }
  }

  updateSlicePlane()
}

function buildFlowField() {
  if (appState.flow) {
    disposeFlowField(scene, appState.flow)
  }
  appState.flow = createFlowField(scene, ui.quality?.value ?? "MEDIUM")
  updateFlowVisibility()
  updateSlicePlanePlacement()
}

function rebuildFlowField() {
  buildFlowField()
  if (appState.currentModel) updateSlicePlane()
}

function resizeRenderer() {
  const w = canvas.clientWidth
  const h = canvas.clientHeight
  renderer.setSize(w, h, false)
  camera.aspect = w / Math.max(h, 1)
  camera.updateProjectionMatrix()
}

ui.fileInput?.addEventListener("change", (e) => {
  const file = e.target.files?.[0]
  if (file) loadFile(file)
})

ui.clearModel?.addEventListener("click", clearModel)

ui.exportCsvBtn?.addEventListener("click", () => {
  if (!appState.currentModel || !appState.geometry || !appState.aero || !appState.dynamics) return

  saveTestResult({
    model: appState.modelName,
    velocityKmh: Number(ui.speed?.value ?? 0),
    massKg: getMass(),
    frontalArea: appState.geometry.frontalArea,
    Cd: appState.aero.Cd,
    Cl: appState.aero.Cl,
    dragN: appState.aero.drag,
    downforceN: appState.aero.downforce,
    wakeIndex: appState.aero.wakeIndex,
    requiredPowerKw: appState.dynamics.requiredPowerKw,
    topSpeedKmh: appState.dynamics.estimatedTopSpeedKmh,
  })
  exportCSV()
})

ui.playBtn?.addEventListener("click", () => {
  appState.simulationRunning = true
  updateSimulationStatus()
})

ui.stopBtn?.addEventListener("click", () => {
  appState.simulationRunning = false
  updateSimulationStatus()
})

ui.resetCam?.addEventListener("click", () => {
  controls.reset()
  camera.position.set(4, 2.5, 4)
  controls.target.set(0, 0.5, 0)
  controls.update()
})

ui.speed?.addEventListener("input", () => {
  updateLabels()
  recomputeMetrics()
})

ui.ground?.addEventListener("input", () => {
  updateLabels()
  updateFloorVisuals()
  if (appState.currentModel) {
    placeModelOnGround()
    recomputeMetrics()
  }
})

ui.quality?.addEventListener("change", rebuildFlowField)

ui.showFlow?.addEventListener("change", updateFlowVisibility)
ui.showWake?.addEventListener("change", () => {
  updateFlowVisibility()
  recomputeMetrics()
})
ui.showPressure?.addEventListener("change", updatePressureDisplay)
ui.showFloor?.addEventListener("change", updateFloorVisuals)

ui.massInput?.addEventListener("input", recomputeMetrics)
ui.powerInput?.addEventListener("input", recomputeMetrics)
ui.crrInput?.addEventListener("input", recomputeMetrics)

ui.rotXPos?.addEventListener("click", () => rotateCurrentModel(Math.PI / 2, 0, 0))
ui.rotXNeg?.addEventListener("click", () => rotateCurrentModel(-Math.PI / 2, 0, 0))
ui.rotYPos?.addEventListener("click", () => rotateCurrentModel(0, Math.PI / 2, 0))
ui.rotYNeg?.addEventListener("click", () => rotateCurrentModel(0, -Math.PI / 2, 0))
ui.rotZPos?.addEventListener("click", () => rotateCurrentModel(0, 0, Math.PI / 2))
ui.rotZNeg?.addEventListener("click", () => rotateCurrentModel(0, 0, -Math.PI / 2))

ui.applyUniformScale?.addEventListener("click", applyUniformRealScale)
ui.applyXYZScale?.addEventListener("click", applyXYZRealScale)
ui.resetScale?.addEventListener("click", resetScale)

window.addEventListener("dragover", (e) => {
  e.preventDefault()
})

window.addEventListener("drop", (e) => {
  e.preventDefault()
  const file = e.dataTransfer.files?.[0]
  if (file) loadFile(file)
})

window.addEventListener("resize", resizeRenderer)

function animate() {
  requestAnimationFrame(animate)

  const dt = Math.min(clock.getDelta(), 0.03)
  updateFPS(dt)

  if (appState.simulationRunning && (ui.showFlow?.checked ?? true) && appState.flow) {
    updateFlowField(appState.flow, dt, Number(ui.speed?.value ?? 120) / 10)
    sculptFlowAroundModel()
  }

  renderer.render(scene, camera)
}

updateSimulationStatus()
updateFlowVisibility()
updateModelComplexityStatus()
writeOutputs()
animate()