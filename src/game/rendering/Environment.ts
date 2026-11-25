// Environment — арена-КРЫША ЗДАНИЯ, фон, освещение, выразительная гроза (ТЗ 3.4–3.6)
// Ринг — плоская крыша высотки: битумная плита, бетонный парапет (кольцо вокруг
// крыши, без копланарных граней — без «ряби»), кровельные надстройки
// (вентбоксы/скайлайт/антенна) ЗА тросами; фасад с окнами уходит вниз.
// Столбики с тросами остаются — канатный забор ПО ВСЕМУ периметру (торцы тоже),
// перепрыгивается в воздухе.
// Гроза (выразительно): ломаный болт молнии от неба до крыш города + мерцающая
// вспышка (dirLight + ambient), возможен двойной разряд; видимый дождь —
// THREE.Points, плотность/яркость взлетают при вспышке.
import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { ARENA, ENVIRONMENT } from '../shared/constants/physics'

export interface EnvironmentHandles {
  dirLight: THREE.DirectionalLight
  ambient: THREE.AmbientLight
  updateStorm: (dt: number) => void
  dispose: () => void
}

function makeSkyTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 4
  c.height = 256
  const ctx = c.getContext('2d')!
  const grad = ctx.createLinearGradient(0, 0, 0, 256)
  grad.addColorStop(0, '#0a1520')
  grad.addColorStop(1, '#8899aa')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, 4, 256)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

function makeCloudTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 128
  c.height = 64
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#2a3a4a'
  for (let i = 0; i < 7; i++) {
    const x = 14 + Math.random() * 100
    const y = 20 + Math.random() * 24
    const r = 10 + Math.random() * 16
    ctx.beginPath()
    ctx.ellipse(x, y, r, r * 0.55, 0, 0, Math.PI * 2)
    ctx.fill()
  }
  return new THREE.CanvasTexture(c)
}

/** Фасад здания под крышей: тёмные стены + сетка окон, часть светится (гроза/вечер) */
function makeFacadeTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 512
  c.height = 512
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#1c2129'
  ctx.fillRect(0, 0, 512, 512)
  // Лёгкая бетонная полоса между этажами
  const cols = 12
  const rows = 16
  const cw = 512 / cols
  const rh = 512 / rows
  const lit = ['#ffd9a0', '#cfe6ff', '#ffe9c8', '#9fd0ff']
  for (let r = 0; r < rows; r++) {
    for (let col = 0; col < cols; col++) {
      const x = col * cw + cw * 0.22
      const y = r * rh + rh * 0.24
      const w = cw * 0.56
      const h = rh * 0.5
      const on = Math.random() < 0.14
      ctx.fillStyle = on ? lit[Math.floor(Math.random() * lit.length)] : '#12161c'
      ctx.globalAlpha = on ? 0.55 + Math.random() * 0.45 : 1
      ctx.fillRect(x, y, w, h)
      ctx.globalAlpha = 1
    }
    // Межэтажный пояс
    ctx.fillStyle = 'rgba(255,255,255,0.04)'
    ctx.fillRect(0, (r + 1) * rh - 2, 512, 2)
  }
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/** Текстура капли-штриха для дождя (вертикальный градиент) */
function makeRainTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 8
  c.height = 48
  const ctx = c.getContext('2d')!
  const g = ctx.createLinearGradient(0, 0, 0, 48)
  g.addColorStop(0, 'rgba(200,225,255,0)')
  g.addColorStop(0.5, 'rgba(200,225,255,0.9)')
  g.addColorStop(1, 'rgba(200,225,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(2, 0, 4, 48)
  return new THREE.CanvasTexture(c)
}

export function buildEnvironment(
  scene: THREE.Scene,
  renderer?: THREE.WebGLRenderer,
  onFlash?: () => void,
): EnvironmentHandles {
  // Небо — градиент (ТЗ 3.5)
  scene.background = makeSkyTexture()
  scene.fog = new THREE.Fog(0x33455a, 40, 90)

  // Карта окружения для металлов (иначе metalness 0.7 выглядит чёрным без отражений)
  if (renderer) {
    try {
      const pmrem = new THREE.PMREMGenerator(renderer)
      const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
      scene.environment = envTex
      scene.environmentIntensity = 0.55
      pmrem.dispose()
    } catch {
      /* graceful degradation без env-карты */
    }
  }

  // Свет (ТЗ 3.6)
  const dirLight = new THREE.DirectionalLight(ENVIRONMENT.dirLight.color, ENVIRONMENT.dirLight.intensity)
  dirLight.position.set(...ENVIRONMENT.dirLight.pos)
  dirLight.castShadow = true
  const shadowMapSize = window.innerWidth < 1024 ? ENVIRONMENT.dirLight.shadowMapMobile : ENVIRONMENT.dirLight.shadowMapDesktop
  dirLight.shadow.mapSize.set(shadowMapSize, shadowMapSize)
  dirLight.shadow.camera.left = -14
  dirLight.shadow.camera.right = 14
  dirLight.shadow.camera.top = 10
  dirLight.shadow.camera.bottom = -4
  dirLight.shadow.camera.far = 40
  scene.add(dirLight)
  const ambient = new THREE.AmbientLight(ENVIRONMENT.ambient.color, ENVIRONMENT.ambient.intensity)
  scene.add(ambient)

  const group = new THREE.Group()
  scene.add(group)

  // ================= КРЫША ЗДАНИЯ (ринг) =================
  // Плита крыши 20×1×6 (ТЗ 3.4) — тёмный битум; земля есть только над зданием,
  // за краем (|x|>roofHalfX) бот падает (см. BotEntity.onRoof).
  const roofMat = new THREE.MeshStandardMaterial({ color: ARENA.roofColor, roughness: 0.95, metalness: 0.05 })
  const platform = new THREE.Mesh(new THREE.BoxGeometry(ARENA.platformLength, ARENA.platformThickness, ARENA.platformDepth), roofMat)
  platform.position.y = -ARENA.platformThickness / 2
  platform.receiveShadow = true
  group.add(platform)

  // Бетонный парапет по периметру: коробки частично УТОПЛЕНЫ в плиту, а наружные
  // грани ВЫСТУПАЮТ за силуэт крыши на 0.04 (урок прежних кромок): ни одна грань
  // парапета не копланарна граням плиты — «ряби двумя цветами» не возникает.
  // Кольцо замкнуто: боковые секции длиннее плиты на 0.08, торцевые — глубже.
  const paraMat = new THREE.MeshStandardMaterial({ color: ARENA.parapetColor, roughness: 0.85, metalness: 0.08 })
  const paraH = 0.52
  const paraLen = ARENA.platformLength + 0.08
  const paraDep = ARENA.platformDepth + 0.08
  for (const sz of [1, -1]) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(paraLen, paraH, 0.16), paraMat)
    p.position.set(0, paraH / 2 - 0.18, sz * (ARENA.platformDepth / 2 - 0.04))
    p.receiveShadow = true
    group.add(p)
  }
  for (const sx of [1, -1]) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.16, paraH, paraDep), paraMat)
    p.position.set(sx * (ARENA.platformLength / 2 - 0.04), paraH / 2 - 0.18, 0)
    p.receiveShadow = true
    group.add(p)
  }

  // Фасад здания под крышей: коробка чуть шире плиты, верх утоплен под низ плиты
  const facadeTex = makeFacadeTexture()
  const facadeMat = new THREE.MeshStandardMaterial({ color: ARENA.facadeColor, map: facadeTex, roughness: 0.9, metalness: 0.05 })
  const facadeH = 30
  const facade = new THREE.Mesh(new THREE.BoxGeometry(ARENA.platformLength + 0.7, facadeH, ARENA.platformDepth + 0.7), facadeMat)
  facade.position.y = -ARENA.platformThickness - facadeH / 2 + 0.02
  group.add(facade)

  // Кровельные надстройки — ЗА тросами (|z|≈2.6..2.75), геймплей не трогают;
  // низ каждой утоплен в плиту (без копланарных граней с кровлей)
  const propMetal = new THREE.MeshStandardMaterial({ color: 0x6a7078, roughness: 0.5, metalness: 0.6 })
  const propDark = new THREE.MeshStandardMaterial({ color: 0x2a3138, roughness: 0.35, metalness: 0.2 })
  const hvac1 = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.55, 0.7), propMetal)
  hvac1.position.set(-6.5, 0.55 / 2 - 0.02, -2.62)
  hvac1.castShadow = true
  group.add(hvac1)
  const hvac2 = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.75, 0.65), propMetal)
  hvac2.position.set(5.5, 0.75 / 2 - 0.02, 2.62)
  hvac2.castShadow = true
  group.add(hvac2)
  const vent = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.9, 10), propMetal)
  vent.position.set(8.2, 0.45 - 0.02, -2.65)
  vent.castShadow = true
  group.add(vent)
  const skylight = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.22, 0.9), propDark)
  skylight.position.set(0, 0.11 - 0.02, 2.66)
  group.add(skylight)
  const ant = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.7, 0.06), propMetal)
  ant.position.set(-8.8, 0.85 - 0.02, 2.7)
  group.add(ant)
  const antBar = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 0.05), propMetal)
  antBar.position.set(-8.8, 1.35, 2.7)
  group.add(antBar)

  // Столбы перил: 4 шт 0.5×3×0.5 (ТЗ 3.4) — канатный забор (остаются)
  const postMat = new THREE.MeshStandardMaterial({ color: ARENA.postColor, roughness: 0.7, metalness: 0.5 })
  const postGeo = new THREE.BoxGeometry(ARENA.postSize.x, ARENA.postSize.y, ARENA.postSize.z)
  const postPositions: [number, number][] = [
    [-9.5, 2.5], [9.5, 2.5], [-9.5, -2.5], [9.5, -2.5],
  ]
  for (const [px, pz] of postPositions) {
    const post = new THREE.Mesh(postGeo, postMat)
    post.position.set(px, ARENA.postSize.y / 2, pz)
    post.castShadow = true
    group.add(post)
  }

  // Тросы: 2 уровня, катенарный провис (ТЗ 3.4) — по ВСЕМУ периметру забора:
  // длинные стороны (z=±2.5) И торцы (x=±9.5, слева/справа арены)
  const ropeMat = new THREE.MeshStandardMaterial({ color: ARENA.ropeColor, roughness: 0.9 })
  const addRopeRun = (ax: number, ay: number, az: number, bx: number, by: number, bz: number): void => {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(ax, ay, az),
      new THREE.Vector3((ax + bx) / 2, (ay + by) / 2 - 0.22, (az + bz) / 2),
      new THREE.Vector3(bx, by, bz),
    ])
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.035, 6), ropeMat)
    tube.castShadow = true
    group.add(tube)
  }
  for (const level of [0, 1]) {
    const yBase = 0.75 + level * 0.75
    for (const z of [2.5, -2.5]) addRopeRun(-9.5, yBase, z, 9.5, yBase, z)
    for (const x of [9.5, -9.5]) addRopeRun(x, yBase, 2.5, x, yBase, -2.5)
  }

  // Городской силуэт (ТЗ 3.5): низкополигональные боксы на дистанции 50
  const cityMat = new THREE.MeshStandardMaterial({ color: ENVIRONMENT.cityColor, roughness: 1 })
  const cityGeo = new THREE.BoxGeometry(1, 1, 1)
  const cityCount = 42
  const city = new THREE.InstancedMesh(cityGeo, cityMat, cityCount)
  const dummy = new THREE.Object3D()
  let seed = 7
  const rnd = (): number => {
    seed = (seed * 16807) % 2147483647
    return seed / 2147483647
  }
  for (let i = 0; i < cityCount; i++) {
    const x = -45 + i * 2.2 + rnd() * 1.5
    const h = 4 + rnd() * 16
    const w = 2 + rnd() * 3
    dummy.position.set(x, h / 2 - 1, -ENVIRONMENT.cityDistance + rnd() * 8)
    dummy.scale.set(w, h, w)
    dummy.rotation.set(0, 0, 0)
    dummy.updateMatrix()
    city.setMatrixAt(i, dummy.matrix)
  }
  group.add(city)

  // Облака
  const cloudTex = makeCloudTexture()
  const clouds: THREE.Mesh[] = []
  for (let i = 0; i < 6; i++) {
    const cm = new THREE.MeshBasicMaterial({ map: cloudTex, transparent: true, opacity: 0.55, depthWrite: false })
    const cloud = new THREE.Mesh(new THREE.PlaneGeometry(16 + rnd() * 14, 6 + rnd() * 4), cm)
    cloud.position.set(-30 + i * 12 + rnd() * 8, 9 + rnd() * 6, -34 - rnd() * 12)
    clouds.push(cloud)
    group.add(cloud)
  }

  // ================= ВИДИМЫЙ ДОЖДЬ (THREE.Points) =================
  const rainTex = makeRainTexture()
  const isNarrow = window.innerWidth < 1024
  const rainCount = isNarrow ? 420 : 900
  const RAIN_BOX = { x: 17, top: 16, z: 9 }
  const rainPos = new Float32Array(rainCount * 3)
  const rainSeed: Float32Array = new Float32Array(rainCount)
  for (let i = 0; i < rainCount; i++) {
    rainPos[i * 3] = (Math.random() * 2 - 1) * RAIN_BOX.x
    rainPos[i * 3 + 1] = Math.random() * RAIN_BOX.top
    rainPos[i * 3 + 2] = (Math.random() * 2 - 1) * RAIN_BOX.z
    rainSeed[i] = 0.75 + Math.random() * 0.5 // индивидуальная скорость капли
  }
  const rainGeo = new THREE.BufferGeometry()
  rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3))
  const rainMat = new THREE.PointsMaterial({
    map: rainTex,
    color: 0xa8c4d8,
    size: 0.5,
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
    sizeAttenuation: true,
  })
  const rain = new THREE.Points(rainGeo, rainMat)
  rain.frustumCulled = false
  group.add(rain)
  // Ветровой снос капель (слева направо) + множитель скорости при вспышке
  const RAIN_WIND_X = 1.7
  const RAIN_FALL = 12.5
  let rainBoost = 0 // 0..1 — плотность/скорость при вспышке молнии

  // ================= МОЛНИЯ (болт из светящихся трубок + мерцание) =================
  // Трубки вместо тонкой Line: болт ГУСТОЙ и видимый издалека (fog выключен)
  const boltMat = new THREE.MeshBasicMaterial({
    color: 0xe8f6ff,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
    toneMapped: false,
  })
  let boltMeshes: THREE.Mesh[] = []

  /** Перегенерировать болт: ломаная от неба до крыш города + 2 ветки */
  const strikeBolt = (): void => {
    for (const m of boltMeshes) {
      group.remove(m)
      m.geometry.dispose()
    }
    boltMeshes = []
    const x0 = -16 + Math.random() * 32
    const z0 = -18 - Math.random() * 12
    const yTop = 22
    const yBot = 2.5
    const segs = 10 + Math.floor(Math.random() * 4)
    const pts: THREE.Vector3[] = [new THREE.Vector3(x0, yTop, z0)]
    for (let i = 1; i <= segs; i++) {
      const t = i / segs
      const y = yTop - t * (yTop - yBot)
      const jitter = 1 - t * 0.35
      pts.push(new THREE.Vector3(
        x0 + (Math.random() - 0.5) * 3.2 * jitter,
        y,
        z0 + (Math.random() - 0.5) * 1.8 * jitter,
      ))
    }
    // Ветки: от случайной точки основного канала в сторону
    for (let b = 0; b < 2; b++) {
      const i0 = 3 + Math.floor(Math.random() * (pts.length - 6))
      const dir = Math.random() < 0.5 ? -1 : 1
      const branch: THREE.Vector3[] = [pts[i0]]
      const n = 2 + Math.floor(Math.random() * 2)
      for (let i = 1; i <= n; i++) {
        const p = pts[Math.min(pts.length - 1, i0 + i)]
        branch.push(new THREE.Vector3(
          p.x + dir * (0.8 + Math.random() * 1.6) * i,
          p.y - 0.4 - Math.random() * 1.4,
          p.z + (Math.random() - 0.5) * 1.2,
        ))
      }
      const bg = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(branch), 16, 0.045, 4, false)
      const bm = new THREE.Mesh(bg, boltMat)
      bm.frustumCulled = false
      group.add(bm)
      boltMeshes.push(bm)
    }
    const geo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 64, 0.1, 5, false)
    const main = new THREE.Mesh(geo, boltMat)
    main.frustumCulled = false
    group.add(main)
    boltMeshes.push(main)
  }

  // Гроза: вспышка-мерцание (ТЗ 3.5) + болт; onFlash — колбэк начала вспышки
  // (для грома и всплеска дождя в бою; в меню тишина)
  const SF = ENVIRONMENT.stormFlash
  let stormTimer = 2.5 + Math.random() * 4
  let flashT = 0
  let pendingSecond = false
  const baseIntensity = ENVIRONMENT.dirLight.intensity
  const baseAmbient = ENVIRONMENT.ambient.intensity
  const updateStorm = (dt: number): void => {
    if (flashT > 0) {
      flashT -= dt
      const k = Math.max(0, flashT / SF.duration)
      // Мерцание: рваная высокочастотная модуляция — свет «дёргается», как настоящий разряд
      const flick = 0.55 + 0.45 * Math.sin(flashT * 89) * Math.sin(flashT * 47 + 1.7)
      dirLight.intensity = baseIntensity * SF.multiplier * Math.max(0.35, flick)
      ambient.intensity = baseAmbient * (1 + 1.8 * k)
      boltMat.opacity = Math.min(1, k * 1.6)
      rainBoost = 1
      if (flashT <= 0) {
        dirLight.intensity = baseIntensity
        ambient.intensity = baseAmbient
        boltMat.opacity = 0
        // Двойной разряд: короткий повтор через паузу
        if (pendingSecond) {
          pendingSecond = false
          stormTimer = SF.doubleDelay
        }
      }
    } else {
      rainBoost = Math.max(0, rainBoost - dt * 0.8)
      stormTimer -= dt
      if (stormTimer <= 0) {
        stormTimer = SF.intervalMin + Math.random() * (SF.intervalMax - SF.intervalMin)
        flashT = SF.duration
        pendingSecond = Math.random() < SF.doubleChance
        strikeBolt()
        onFlash?.()
      }
    }
    // Дождь: падение с ветровым сносом; при вспышке — быстрее/ярче
    rainBoost = Math.min(1, rainBoost)
    const speedK = 1 + rainBoost * 0.45
    const pos = rainGeo.getAttribute('position') as THREE.BufferAttribute
    const arr = pos.array as Float32Array
    for (let i = 0; i < rainCount; i++) {
      const sp = rainSeed[i] * speedK
      arr[i * 3] += RAIN_WIND_X * sp * dt
      arr[i * 3 + 1] -= RAIN_FALL * sp * dt
      if (arr[i * 3 + 1] < -1) {
        arr[i * 3 + 1] = RAIN_BOX.top + Math.random() * 3
        arr[i * 3] = (Math.random() * 2 - 1) * RAIN_BOX.x
        arr[i * 3 + 2] = (Math.random() * 2 - 1) * RAIN_BOX.z
      }
      if (arr[i * 3] > RAIN_BOX.x) arr[i * 3] = -RAIN_BOX.x
    }
    pos.needsUpdate = true
    rainMat.opacity = 0.22 + rainBoost * 0.3
    // Дрейф облаков
    for (const cl of clouds) {
      cl.position.x += dt * 0.35
      if (cl.position.x > 40) cl.position.x = -40
    }
  }

  const dispose = (): void => {
    scene.remove(group)
    group.traverse((o) => {
      const m = o as THREE.Mesh
      if (m.geometry) m.geometry.dispose()
      const mat = m.material as THREE.Material | THREE.Material[] | undefined
      if (Array.isArray(mat)) mat.forEach(mm => mm.dispose())
      else mat?.dispose()
    })
    if (scene.background instanceof THREE.Texture) scene.background.dispose()
    facadeTex.dispose()
    cloudTex.dispose()
    rainTex.dispose()
    scene.fog = null
  }

  return { dirLight, ambient, updateStorm, dispose }
}
