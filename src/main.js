import "./style.css"
import * as THREE from "three"
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js"
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js"
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js"

import { analyzeGeometry } from "./geometry.js"
import { computeAerodynamics } from "./aerodynamics.js"
import { computeVehicleDynamics } from "./vehicleDynamics.js"
import { createFlowField, updateFlowField } from "./flowfield.js"
import { saveTestResult, exportCSV, clearHistory } from "./export.js"

/* ---------------- UI ---------------- */
const ui = {
  fileInput: document.getElementById("fileInput"),
  clearModel: document.getElementById("clearModel"),

  speed: document.getElementById("speed"),
  ground: document.getElementById("ground"),
  mass: document.getElementById("mass"),
  rollingCoeff: document.getElementById("rollingCoeff"),
  motorPower: document.getElementById("motorPower"),

  speedVal: document.getElementById("speedVal"),
  groundVal: document.getElementById("groundVal"),
  massVal: document.getElementById("massVal"),
  rollingVal: document.getElementById("rollingVal"),
  powerVal: document.getElementById("powerVal"),

  realLengthInput: document.getElementById("realLengthInput"),
  realWidthInput: document.getElementById("realWidthInput"),
  realHeightInput: document.getElementById("realHeightInput"),
  applyUniformScaleBtn: document.getElementById("applyUniformScaleBtn"),
  applyXYZScaleBtn: document.getElementById("applyXYZScaleBtn"),
  resetScaleBtn: document.getElementById("resetScaleBtn"),

  showFlow: document.getElementById("showFlow"),
  showWake: document.getElementById("showWake"),
  showPressure: document.getElementById("showPressure"),
  showFloor: document.getElementById("showFloor"),

  playBtn: document.getElementById("playBtn"),
  stopBtn: document.getElementById("stopBtn"),
  resetCam: document.getElementById("resetCam"),

  saveTestBtn: document.getElementById("saveTestBtn"),
  exportCsvBtn: document.getElementById("exportCsvBtn"),
  clearHistoryBtn: document.getElementById("clearHistoryBtn"),

  rotXPos: document.getElementById("rotXPos"),
  rotXNeg: document.getElementById("rotXNeg"),
  rotYPos: document.getElementById("rotYPos"),
  rotYNeg: document.getElementById("rotYNeg"),
  rotZPos: document.getElementById("rotZPos"),
  rotZNeg: document.getElementById("rotZNeg"),

  lengthOut: document.getElementById("lengthOut"),
  widthOut: document.getElementById("widthOut"),
  heightOut: document.getElementById("heightOut"),
  frontalAreaOut: document.getElementById("frontalAreaOut"),
  surfaceOut: document.getElementById("surfaceOut"),
  volumeOut: document.getElementById("volumeOut"),

  cdOut: document.getElementById("cdOut"),
  dragOut: document.getElementById("dragOut"),
  downforceOut: document.getElementById("downforceOut"),

  aeroPowerOut: document.getElementById("aeroPowerOut"),
  totalPowerOut: document.getElementById("totalPowerOut"),
  topSpeedOut: document.getElementById("topSpeedOut"),
}

function fmt(value, digits = 2, suffix = "") {
  if (value === null || value === undefined || Number.isNaN(value)) return "—"
  return `${Number(value).toFixed(digits)}${suffix}`
}

function clampGround() {
  return Math.max(0, Number(ui.ground.value))
}

function getNumInput(el) {
  const v = Number(el?.value)
  return Number.isFinite(v) && v > 0 ? v : null
}

function syncLabels() {
  ui.speedVal.textContent = `${ui.speed.value} km/h`
  ui.groundVal.textContent = `${Number(ui.ground.value).toFixed(2)} m`
  ui.massVal.textContent = `${ui.mass.value} kg`
  ui.rollingVal.textContent = Number(ui.rollingCoeff.value).toFixed(3)
  ui.powerVal.textContent = `${ui.motorPower.value} kW`
}
syncLabels()

/* ---------------- Scene ---------------- */
const canvas = document.getElementById("mainCanvas")

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
})
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.setSize(canvas.clientWidth, canvas.clientHeight, false)
renderer.shadowMap.enabled = true

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x20242c)

const camera = new THREE.PerspectiveCamera(55, 1, 0.01, 500)
camera.position.set(3, 2, 3)

const controls = new OrbitControls(camera, renderer.domElement)
controls.target.set(0, 0.4, 0)
controls.update()

scene.add(new THREE.AmbientLight(0xffffff, 0.6))

const sun = new THREE.DirectionalLight(0xffffff, 0.95)
sun.position.set(5, 10, 5)
sun.castShadow = true
sun.shadow.mapSize.set(2048, 2048)
sun.shadow.camera.near = 0.1
sun.shadow.camera.far = 100
sun.shadow.camera.left = -20
sun.shadow.camera.right = 20
sun.shadow.camera.top = 20
sun.shadow.camera.bottom = -20
scene.add(sun)

/* ---------------- Floor / Grid / Contact Shadow ---------------- */
const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(80, 80),
  new THREE.MeshStandardMaterial({
    color: 0x2c313a,
    roughness: 0.95,
    metalness: 0.0,
  })
)
floor.rotation.x = -Math.PI / 2
floor.receiveShadow = true
scene.add(floor)

const grid = new THREE.GridHelper(80, 80, 0x4a5568, 0x2d3748)
scene.add(grid)

const contactShadow = new THREE.Mesh(
  new THREE.CircleGeometry(1, 48),
  new THREE.MeshBasicMaterial({
    color: 0x000000,
    transparent: true,
    opacity: 0.25,
  })
)
contactShadow.rotation.x = -Math.PI / 2
scene.add(contactShadow)

function updateFloorVisuals() {
  const y = clampGround()
  floor.position.y = y
  grid.position.y = y + 0.001
  contactShadow.position.y = y + 0.002

  const visible = ui.showFloor.checked
  floor.visible = visible
  grid.visible = visible
  contactShadow.visible = visible
}
updateFloorVisuals()

/* ---------------- Model / Flow State ---------------- */
const modelRoot = new THREE.Group()
scene.add(modelRoot)

const stlLoader = new STLLoader()
const objLoader = new OBJLoader()

const flow = createFlowField(scene, 1800)
flow.flowLines.visible = ui.showFlow.checked

let currentModel = null
let currentModelName = ""
let geometryData = null
let aeroData = null
let vehicleData = null
let modelBounds = null
let running = true

const scaleState = {
  currentUniform: 1,
  currentXYZ: new THREE.Vector3(1, 1, 1),
}

const clock = new THREE.Clock()
const raycaster = new THREE.Raycaster()

/* ---------------- Materials / Pressure ---------------- */
function createBaseMaterial() {
  return new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.45,
    metalness: 0.15,
    vertexColors: true,
  })
}

function setModelMaterials(object) {
  object.traverse?.((child) => {
    if (!child.isMesh) return
    child.geometry?.computeVertexNormals?.()
    child.material = createBaseMaterial()
    child.castShadow = true
    child.receiveShadow = false
  })

  if (object.isMesh) {
    object.geometry?.computeVertexNormals?.()
    object.material = createBaseMaterial()
    object.castShadow = true
    object.receiveShadow = false
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
    const colors = new Float32Array(positions.count * 3)

    for (let i = 0; i < positions.count; i++) {
      const normal = new THREE.Vector3(
        normals.getX(i),
        normals.getY(i),
        normals.getZ(i)
      ).normalize()

      const p = pressureFromNormal(normal)

      colors[i * 3 + 0] = p
      colors[i * 3 + 1] = 0.05
      colors[i * 3 + 2] = 1 - p
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
  if (!currentModel) return
  if (ui.showPressure.checked) applyPressureMap(currentModel)
  else removePressureMap(currentModel)
}

/* ---------------- Placement / Camera ---------------- */
function updateContactShadow() {
  if (!modelBounds) {
    contactShadow.scale.set(0.0001, 0.0001, 1)
    return
  }

  const size = new THREE.Vector3()
  const center = new THREE.Vector3()
  modelBounds.getSize(size)
  modelBounds.getCenter(center)

  const r = 0.62 * Math.max(size.x, size.z)
  contactShadow.scale.set(r, r, 1)
  contactShadow.position.set(center.x, floor.position.y + 0.002, center.z)
}

function fitCameraToModel() {
  if (!modelBounds) return

  const size = new THREE.Vector3()
  const center = new THREE.Vector3()
  modelBounds.getSize(size)
  modelBounds.getCenter(center)

  const maxDim = Math.max(size.x, size.y, size.z)
  const dist = maxDim * 1.9

  controls.target.copy(center)
  camera.position.set(center.x + dist, center.y + dist * 0.55, center.z + dist)
  camera.near = Math.max(0.01, dist / 200)
  camera.far = dist * 60
  camera.updateProjectionMatrix()
  controls.update()
}

function placeModelOnGround() {
  if (!currentModel) return

  const y = clampGround()
  const box = new THREE.Box3().setFromObject(currentModel)
  currentModel.position.y += (y - box.min.y)
  currentModel.updateMatrixWorld(true)

  modelBounds = new THREE.Box3().setFromObject(currentModel)
  updateContactShadow()
}

/* ---------------- Orientation ---------------- */
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
    size = getSize()
  }

  if (size.z > size.x * 1.05) {
    object.rotation.y -= Math.PI / 2
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

  const box2 = new THREE.Box3().setFromObject(object)
  const center = new THREE.Vector3()
  box2.getCenter(center)

  const front = box2.max.x - center.x
  const back = center.x - box2.min.x

  if (back > front) {
    object.rotation.y += Math.PI
    object.updateMatrixWorld(true)
  }
}

function rotateCurrentModel(rx = 0, ry = 0, rz = 0) {
  if (!currentModel) return

  currentModel.rotation.x += rx
  currentModel.rotation.y += ry
  currentModel.rotation.z += rz
  currentModel.updateMatrixWorld(true)

  const box = new THREE.Box3().setFromObject(currentModel)
  const center = new THREE.Vector3()
  box.getCenter(center)
  currentModel.position.sub(center)
  currentModel.updateMatrixWorld(true)

  placeModelOnGround()
  modelBounds = new THREE.Box3().setFromObject(currentModel)

  updatePressureDisplay()
  updateContactShadow()
  fitCameraToModel()
  recalculateAll()
}

function normalizeAndPlace(object) {
  setModelMaterials(object)

  modelRoot.add(object)
  currentModel = object

  fixUpright(object)
  alignToFlowYaw(object)
  object.updateMatrixWorld(true)

  // No normalizamos a 1.8 para conservar la escala del archivo.
  {
    const box = new THREE.Box3().setFromObject(object)
    const center = new THREE.Vector3()
    box.getCenter(center)
    object.position.sub(center)
    object.updateMatrixWorld(true)
  }

  placeModelOnGround()
  modelBounds = new THREE.Box3().setFromObject(object)

  scaleState.currentUniform = 1
  scaleState.currentXYZ.set(1, 1, 1)

  updatePressureDisplay()
  updateContactShadow()
  fitCameraToModel()
}

/* ---------------- Real Scale ---------------- */
function applyUniformRealScale() {
  if (!currentModel || !geometryData) return

  const realLength = getNumInput(ui.realLengthInput)
  if (!realLength || geometryData.length <= 0) return

  const factor = realLength / geometryData.length
  currentModel.scale.multiplyScalar(factor)
  scaleState.currentUniform *= factor
  scaleState.currentXYZ.multiplyScalar(factor)

  currentModel.updateMatrixWorld(true)
  placeModelOnGround()
  modelBounds = new THREE.Box3().setFromObject(currentModel)

  updatePressureDisplay()
  updateContactShadow()
  fitCameraToModel()
  recalculateAll()
}

function applyXYZRealScale() {
  if (!currentModel || !geometryData) return

  const realLength = getNumInput(ui.realLengthInput)
  const realWidth = getNumInput(ui.realWidthInput)
  const realHeight = getNumInput(ui.realHeightInput)

  if (!realLength || !realWidth || !realHeight) return
  if (geometryData.length <= 0 || geometryData.width <= 0 || geometryData.height <= 0) return

  const fx = realLength / geometryData.length
  const fy = realHeight / geometryData.height
  const fz = realWidth / geometryData.width

  currentModel.scale.x *= fx
  currentModel.scale.y *= fy
  currentModel.scale.z *= fz

  scaleState.currentXYZ.x *= fx
  scaleState.currentXYZ.y *= fy
  scaleState.currentXYZ.z *= fz

  currentModel.updateMatrixWorld(true)
  placeModelOnGround()
  modelBounds = new THREE.Box3().setFromObject(currentModel)

  updatePressureDisplay()
  updateContactShadow()
  fitCameraToModel()
  recalculateAll()
}

function resetRealScale() {
  if (!currentModel) return

  currentModel.scale.set(1, 1, 1)
  scaleState.currentUniform = 1
  scaleState.currentXYZ.set(1, 1, 1)

  currentModel.updateMatrixWorld(true)
  placeModelOnGround()
  modelBounds = new THREE.Box3().setFromObject(currentModel)

  updatePressureDisplay()
  updateContactShadow()
  fitCameraToModel()
  recalculateAll()
}

/* ---------------- Calculations ---------------- */
function updateOutputs() {
  ui.lengthOut.textContent = geometryData ? fmt(geometryData.length, 2, " m") : "—"
  ui.widthOut.textContent = geometryData ? fmt(geometryData.width, 2, " m") : "—"
  ui.heightOut.textContent = geometryData ? fmt(geometryData.height, 2, " m") : "—"
  ui.frontalAreaOut.textContent = geometryData ? fmt(geometryData.frontalArea, 2, " m²") : "—"
  ui.surfaceOut.textContent = geometryData ? fmt(geometryData.surfaceArea, 2, " m²") : "—"
  ui.volumeOut.textContent = geometryData ? fmt(geometryData.volume, 2, " m³") : "—"

  ui.cdOut.textContent = aeroData ? fmt(aeroData.Cd, 3) : "—"
  ui.dragOut.textContent = aeroData ? fmt(aeroData.drag, 1, " N") : "—"
  ui.downforceOut.textContent = aeroData ? fmt(aeroData.downforce, 1, " N") : "—"

  ui.aeroPowerOut.textContent = vehicleData ? fmt(vehicleData.aeroPowerKw, 1, " kW") : "—"
  ui.totalPowerOut.textContent = vehicleData ? fmt(vehicleData.totalPowerKw, 1, " kW") : "—"
  ui.topSpeedOut.textContent = vehicleData?.estimatedTopSpeedKmh
    ? fmt(vehicleData.estimatedTopSpeedKmh, 1, " km/h")
    : "—"
}

function recalculateAll() {
  if (!currentModel) {
    geometryData = null
    aeroData = null
    vehicleData = null
    updateOutputs()
    return
  }

  geometryData = analyzeGeometry(currentModel)

  aeroData = computeAerodynamics(
    currentModel,
    geometryData,
    Number(ui.speed.value)
  )

  vehicleData = computeVehicleDynamics(aeroData, {
    mass: Number(ui.mass.value),
    rollingCoeff: Number(ui.rollingCoeff.value),
    motorPowerKw: Number(ui.motorPower.value),
    frontalArea: geometryData.frontalArea,
  })

  updateOutputs()
}

/* ---------------- Flow / Wake ---------------- */
function updateFlowVisibility() {
  flow.flowLines.visible = ui.showFlow.checked
}

function resetFlowVelocities() {
  for (let i = 0; i < flow.count; i++) {
    const i3 = i * 3
    flow.velocities[i3 + 0] = 1
    flow.velocities[i3 + 1] = (Math.random() - 0.5) * 0.02
    flow.velocities[i3 + 2] = (Math.random() - 0.5) * 0.02
  }
}

function sculptFlowAroundModel() {
  if (!currentModel || !ui.showFlow.checked) return

  const positions = flow.positions
  const velocities = flow.velocities
  const count = flow.count

  const box = modelBounds || new THREE.Box3().setFromObject(currentModel)
  const wakeStart = box.max.x

  const baseWake = ui.showWake.checked ? 0.10 : 0.0
  const cdFactor = aeroData ? Math.min(2.0, aeroData.Cd / 0.30) : 1.0
  const dragFactor = aeroData ? Math.min(2.0, aeroData.drag / 300) : 1.0
  const globalWakeIntensity = baseWake * (0.7 * cdFactor + 0.3 * dragFactor)

  const avoidDist = 0.10
  const pushStrength = 2.2

  const pos = new THREE.Vector3()
  const dir = new THREE.Vector3(-1, 0, 0)
  const normal = new THREE.Vector3()

  for (let i = 0; i < count; i++) {
    const i6 = i * 6
    const i3 = i * 3

    pos.set(positions[i6 + 0], positions[i6 + 1], positions[i6 + 2])

    velocities[i3 + 0] += (1.0 - velocities[i3 + 0]) * 0.02
    velocities[i3 + 1] *= 0.98
    velocities[i3 + 2] *= 0.98

    raycaster.set(pos, dir)
    raycaster.far = avoidDist

    const hits = raycaster.intersectObject(currentModel, true)
    if (hits.length > 0) {
      const hit = hits[0]

      if (hit.face?.normal) {
        normal.copy(hit.face.normal).transformDirection(hit.object.matrixWorld).normalize()
      } else {
        normal.set(0, 1, 0)
      }

      const localPressure = pressureFromNormal(normal)

      velocities[i3 + 0] *= 0.85 - localPressure * 0.15
      velocities[i3 + 1] += normal.y * pushStrength * (0.01 + localPressure * 0.01)
      velocities[i3 + 2] += normal.z * pushStrength * (0.01 + localPressure * 0.01)

      if (ui.showWake.checked) {
        velocities[i3 + 1] += (Math.random() - 0.5) * localPressure * 0.08
        velocities[i3 + 2] += (Math.random() - 0.5) * localPressure * 0.08
      }
    }

    if (pos.x > wakeStart && ui.showWake.checked) {
      velocities[i3 + 1] += (Math.random() - 0.5) * globalWakeIntensity
      velocities[i3 + 2] += (Math.random() - 0.5) * globalWakeIntensity
      velocities[i3 + 0] *= 0.992
    }

    if (pos.y < floor.position.y + 0.02) {
      velocities[i3 + 1] = Math.abs(velocities[i3 + 1]) + 0.01
    }
  }

  flow.flowLines.geometry.attributes.position.needsUpdate = true
}

/* ---------------- Load / Clear ---------------- */
function clearCurrentModel() {
  if (currentModel) {
    modelRoot.remove(currentModel)
    currentModel = null
  }

  currentModelName = ""
  geometryData = null
  aeroData = null
  vehicleData = null
  modelBounds = null

  updateContactShadow()
  updateOutputs()
  resetFlowVelocities()
}

function handleLoadedObject(object, filename) {
  clearCurrentModel()
  currentModelName = filename
  normalizeAndPlace(object)
  recalculateAll()
}

function loadFile(file) {
  if (!file) return

  const url = URL.createObjectURL(file)
  const ext = file.name.toLowerCase().split(".").pop()

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
      (err) => {
        console.error(err)
        URL.revokeObjectURL(url)
      }
    )
  } else if (ext === "obj") {
    objLoader.load(
      url,
      (obj) => {
        handleLoadedObject(obj, file.name)
        URL.revokeObjectURL(url)
      },
      undefined,
      (err) => {
        console.error(err)
        URL.revokeObjectURL(url)
      }
    )
  } else {
    URL.revokeObjectURL(url)
  }
}

/* ---------------- Events ---------------- */
ui.fileInput.addEventListener("change", (e) => {
  const file = e.target.files?.[0]
  if (file) loadFile(file)
  ui.fileInput.value = ""
})

ui.clearModel.addEventListener("click", clearCurrentModel)

ui.speed.addEventListener("input", () => {
  syncLabels()
  recalculateAll()
})

ui.ground.addEventListener("input", () => {
  syncLabels()
  updateFloorVisuals()
  if (currentModel) {
    placeModelOnGround()
    recalculateAll()
  }
})

ui.mass.addEventListener("input", () => {
  syncLabels()
  recalculateAll()
})

ui.rollingCoeff.addEventListener("input", () => {
  syncLabels()
  recalculateAll()
})

ui.motorPower.addEventListener("input", () => {
  syncLabels()
  recalculateAll()
})

ui.applyUniformScaleBtn.addEventListener("click", applyUniformRealScale)
ui.applyXYZScaleBtn.addEventListener("click", applyXYZRealScale)
ui.resetScaleBtn.addEventListener("click", resetRealScale)

ui.showFlow.addEventListener("change", updateFlowVisibility)
ui.showWake.addEventListener("change", () => resetFlowVelocities())
ui.showPressure.addEventListener("change", () => updatePressureDisplay())
ui.showFloor.addEventListener("change", updateFloorVisuals)

ui.playBtn.addEventListener("click", () => {
  running = true
})

ui.stopBtn.addEventListener("click", () => {
  running = false
})

ui.resetCam.addEventListener("click", () => {
  controls.reset()
  camera.position.set(3, 2, 3)
  controls.target.set(0, 0.4, 0)
  controls.update()
})

ui.saveTestBtn.addEventListener("click", () => {
  if (!geometryData || !aeroData || !vehicleData) return

  saveTestResult({
    model: currentModelName,
    velocity: Number(ui.speed.value),
    height: Number(ui.ground.value),
    frontalArea: geometryData.frontalArea,
    Cd: aeroData.Cd,
    drag: aeroData.drag,
    downforce: aeroData.downforce,
    powerRequired: vehicleData.totalPowerKw,
    topSpeed: vehicleData.estimatedTopSpeedKmh,
  })
})

ui.exportCsvBtn.addEventListener("click", () => {
  exportCSV("tunel_r01_historial.csv")
})

ui.clearHistoryBtn.addEventListener("click", () => {
  clearHistory()
})

ui.rotXPos.addEventListener("click", () => rotateCurrentModel(Math.PI / 2, 0, 0))
ui.rotXNeg.addEventListener("click", () => rotateCurrentModel(-Math.PI / 2, 0, 0))
ui.rotYPos.addEventListener("click", () => rotateCurrentModel(0, Math.PI / 2, 0))
ui.rotYNeg.addEventListener("click", () => rotateCurrentModel(0, -Math.PI / 2, 0))
ui.rotZPos.addEventListener("click", () => rotateCurrentModel(0, 0, Math.PI / 2))
ui.rotZNeg.addEventListener("click", () => rotateCurrentModel(0, 0, -Math.PI / 2))

window.addEventListener("keydown", (e) => {
  if (!currentModel) return
  const key = e.key.toLowerCase()

  if (key === "q") rotateCurrentModel(Math.PI / 2, 0, 0)
  if (key === "a") rotateCurrentModel(-Math.PI / 2, 0, 0)

  if (key === "w") rotateCurrentModel(0, Math.PI / 2, 0)
  if (key === "s") rotateCurrentModel(0, -Math.PI / 2, 0)

  if (key === "e") rotateCurrentModel(0, 0, Math.PI / 2)
  if (key === "d") rotateCurrentModel(0, 0, -Math.PI / 2)
})

window.addEventListener("resize", () => {
  const w = canvas.clientWidth
  const h = canvas.clientHeight
  renderer.setSize(w, h, false)
  camera.aspect = w / h
  camera.updateProjectionMatrix()
})

/* ---------------- Animate ---------------- */
function animate() {
  requestAnimationFrame(animate)

  const delta = Math.min(clock.getDelta(), 0.03)

  if (running) {
    updateFlowField(flow, delta, Number(ui.speed.value) / 25)
    sculptFlowAroundModel()
  }

  renderer.render(scene, camera)
}

updateOutputs()
animate()