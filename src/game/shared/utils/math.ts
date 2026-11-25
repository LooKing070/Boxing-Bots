// Математические утилиты
import type { Vec3 } from '../types/bot.types'

export const clamp = (v: number, min: number, max: number): number =>
  v < min ? min : v > max ? max : v

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

export const randRange = (min: number, max: number): number => min + Math.random() * (max - min)

export function round3(v: number): number {
  return Math.round(v * 1000) / 1000
}

/** Детерминированный ГПСЧ (mulberry32) для сетевой воспроизводимости */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function dist3(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

/** Полилиния по прямым сегментам с индивидуальными длительностями кадров (TZ-UPDATE §3.4.2).
 *  p — смещения от стойки; t — время 0..Σd. Никаких сплайнов (UPD-04). */
export function polylineAt(points: Vec3[], durations: number[], t: number): Vec3 {
  const n = points.length
  if (n === 0) return { x: 0, y: 0, z: 0 }
  if (n === 1 || t <= 0) return { ...points[0] }
  let acc = 0
  for (let i = 0; i < n - 1; i++) {
    const seg = Math.max(1e-6, durations[i] ?? 0.2)
    if (t < acc + seg) {
      const k = (t - acc) / seg
      return {
        x: points[i].x + (points[i + 1].x - points[i].x) * k,
        y: points[i].y + (points[i + 1].y - points[i].y) * k,
        z: points[i].z + (points[i + 1].z - points[i].z) * k,
      }
    }
    acc += seg
  }
  return { ...points[n - 1] }
}

/** Простой 2-костный IK для руки: возвращает углы плеча/локтя в плоскости XY */
export function solveIK2(
  shoulder: { x: number; y: number },
  target: { x: number; y: number },
  upperLen: number,
  foreLen: number,
  bendSign: number
): { elbow: Vec3; shoulderAngle: number; elbowAngle: number } {
  const dx = target.x - shoulder.x
  const dy = target.y - shoulder.y
  let d = Math.sqrt(dx * dx + dy * dy)
  d = clamp(d, Math.abs(upperLen - foreLen) + 1e-4, upperLen + foreLen - 1e-4)
  const baseAngle = Math.atan2(dy, dx)
  const cosA = (upperLen * upperLen + d * d - foreLen * foreLen) / (2 * upperLen * d)
  const a1 = Math.acos(clamp(cosA, -1, 1))
  const shoulderAngle = baseAngle + a1 * bendSign
  const cosB = (upperLen * upperLen + foreLen * foreLen - d * d) / (2 * upperLen * foreLen)
  const elbowAngle = Math.acos(clamp(cosB, -1, 1))
  const elbow: Vec3 = {
    x: shoulder.x + Math.cos(shoulderAngle) * upperLen,
    y: shoulder.y + Math.sin(shoulderAngle) * upperLen,
    z: 0,
  }
  return { elbow, shoulderAngle, elbowAngle }
}
