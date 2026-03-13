// src/vehicleDynamics.js

const GRAVITY = 9.81

export function computeVehicleDynamics(aeroData, options = {}) {
  if (!aeroData) return null

  const mass = Number(options.mass ?? 1200)
  const rollingCoeff = Number(options.rollingCoeff ?? 0.012)
  const motorPowerKw = Number(options.motorPowerKw ?? 0)

  const velocityMS = aeroData.velocityMS

  const rollingResistance = rollingCoeff * mass * GRAVITY

  const aeroPower = aeroData.drag * velocityMS
  const rollingPower = rollingResistance * velocityMS
  const totalPower = aeroPower + rollingPower

  const motorPowerW = motorPowerKw * 1000

  let estimatedTopSpeedMS = null
  let estimatedTopSpeedKmh = null

  if (motorPowerW > 0) {
    estimatedTopSpeedMS = solveTopSpeed({
      airDensity: aeroData.airDensity,
      Cd: aeroData.Cd,
      frontalArea: options.frontalArea ?? 2.0,
      rollingCoeff,
      mass,
      motorPowerW
    })

    estimatedTopSpeedKmh = estimatedTopSpeedMS * 3.6
  }

  return {
    mass,
    rollingCoeff,
    rollingResistance,
    aeroPower,
    rollingPower,
    totalPower,
    totalPowerKw: totalPower / 1000,
    aeroPowerKw: aeroPower / 1000,
    rollingPowerKw: rollingPower / 1000,
    motorPowerKw,
    estimatedTopSpeedMS,
    estimatedTopSpeedKmh
  }
}

function solveTopSpeed({
  airDensity,
  Cd,
  frontalArea,
  rollingCoeff,
  mass,
  motorPowerW
}) {
  let low = 0
  let high = 200

  for (let i = 0; i < 60; i++) {
    const mid = (low + high) * 0.5
    const dragForce = 0.5 * airDensity * Cd * frontalArea * mid * mid
    const rollingForce = rollingCoeff * mass * GRAVITY
    const requiredPower = (dragForce + rollingForce) * mid

    if (requiredPower > motorPowerW) {
      high = mid
    } else {
      low = mid
    }
  }

  return (low + high) * 0.5
}