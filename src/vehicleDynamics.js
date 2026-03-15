const GRAVITY = 9.81

export function computeVehicleDynamics(aeroData, options = {}) {
  if (!aeroData) return null

  const mass = Number(options.mass ?? 1500)
  const rollingCoeff = Number(options.rollingCoeff ?? 0.012)
  const motorPowerKw = Number(options.motorPowerKw ?? 150)
  const frontalArea = Number(options.frontalArea ?? 2.2)
  const drivetrainEfficiency = Number(options.drivetrainEfficiency ?? 0.88)
  const accessoryPowerKw = Number(options.accessoryPowerKw ?? 0.8)

  const velocityMS = aeroData.velocityMS
  const rollingResistance = rollingCoeff * mass * GRAVITY

  const aeroPower = aeroData.drag * velocityMS
  const rollingPower = rollingResistance * velocityMS
  const wheelPower = aeroPower + rollingPower
  const requiredPower = wheelPower / Math.max(drivetrainEfficiency, 0.5) + accessoryPowerKw * 1000
  const totalForce = aeroData.drag + rollingResistance

  let estimatedTopSpeedMS = null
  let estimatedTopSpeedKmh = null

  if (motorPowerKw > 0) {
    estimatedTopSpeedMS = solveTopSpeed({
      airDensity: aeroData.airDensity,
      Cd: aeroData.Cd,
      frontalArea,
      rollingCoeff,
      mass,
      motorPowerW: motorPowerKw * 1000,
      drivetrainEfficiency,
      accessoryPowerW: accessoryPowerKw * 1000,
    })
    estimatedTopSpeedKmh = estimatedTopSpeedMS * 3.6
  }

  const energyPer100kmKwh =
    velocityMS > 0 ? (requiredPower / 1000) / velocityMS * 100000 / 3600 : 0

  return {
    mass,
    rollingCoeff,
    rollingResistance,
    totalForce,
    aeroPower,
    rollingPower,
    wheelPower,
    requiredPower,
    requiredPowerKw: requiredPower / 1000,
    energyPer100kmKwh,
    motorPowerKw,
    estimatedTopSpeedMS,
    estimatedTopSpeedKmh,
  }
}

function solveTopSpeed({
  airDensity,
  Cd,
  frontalArea,
  rollingCoeff,
  mass,
  motorPowerW,
  drivetrainEfficiency,
  accessoryPowerW,
}) {
  let low = 0
  let high = 200

  for (let i = 0; i < 60; i++) {
    const mid = (low + high) * 0.5
    const dragForce = 0.5 * airDensity * Cd * frontalArea * mid * mid
    const rollingForce = rollingCoeff * mass * GRAVITY
    const wheelPower = (dragForce + rollingForce) * mid
    const requiredMotorPower = wheelPower / Math.max(drivetrainEfficiency, 0.5) + accessoryPowerW

    if (requiredMotorPower > motorPowerW) high = mid
    else low = mid
  }

  return (low + high) * 0.5
}