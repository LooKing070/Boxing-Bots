// PostProcessing — один проход: виньетка + глитч (RGB shift) + шум (ТЗ 5.5, 12.2)
import * as THREE from 'three'

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`

const FRAG = /* glsl */ `
uniform sampler2D tDiffuse;
uniform float vignette;
uniform float glitch;
uniform float noise;
uniform float time;
varying vec2 vUv;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  vec2 uv = vUv;
  // Глитч: горизонтальные срывы строк (материнская плата)
  if (glitch > 0.001) {
    float band = step(0.8, hash(vec2(floor(uv.y * 24.0), floor(time * 14.0))));
    uv.x += band * glitch * 0.02 * sin(uv.y * 80.0 + time * 40.0);
  }
  // RGB shift
  vec2 off = vec2(glitch * 0.004, 0.0);
  vec3 col;
  col.r = texture2D(tDiffuse, uv + off).r;
  col.g = texture2D(tDiffuse, uv).g;
  col.b = texture2D(tDiffuse, uv - off).b;
  // Виньетка (камеры)
  float d = distance(vUv, vec2(0.5));
  col *= 1.0 - vignette * smoothstep(0.28, 0.82, d);
  // Шум (почти слепота)
  if (noise > 0.001) {
    float n = hash(vUv * vec2(1234.0, 567.0) + vec2(time * 61.0));
    col = mix(col, vec3(n), noise * 0.4);
  }
  gl_FragColor = vec4(col, 1.0);
}
`

export class PostFX {
  target: THREE.WebGLRenderTarget
  material: THREE.ShaderMaterial
  uniforms: { vignette: THREE.IUniform; glitch: THREE.IUniform; noise: THREE.IUniform; time: THREE.IUniform; tDiffuse: THREE.IUniform }
  scene: THREE.Scene
  cam: THREE.OrthographicCamera

  constructor(renderer: THREE.WebGLRenderer) {
    const size = renderer.getSize(new THREE.Vector2())
    const pr = renderer.getPixelRatio()
    this.target = new THREE.WebGLRenderTarget(Math.max(2, size.x * pr), Math.max(2, size.y * pr))
    this.uniforms = {
      tDiffuse: { value: this.target.texture },
      vignette: { value: 0 },
      glitch: { value: 0 },
      noise: { value: 0 },
      time: { value: 0 },
    }
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: this.uniforms,
      depthTest: false,
      depthWrite: false,
    })
    this.scene = new THREE.Scene()
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3))
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2))
    this.scene.add(new THREE.Mesh(geo, this.material))
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  }

  setSize(w: number, h: number): void {
    const pr = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio, 2) : 1
    this.target.setSize(Math.max(2, Math.floor(w * pr)), Math.max(2, Math.floor(h * pr)))
  }

  update(time: number): void {
    this.uniforms.time.value = time
  }

  dispose(): void {
    this.target.dispose()
    this.material.dispose()
  }
}
