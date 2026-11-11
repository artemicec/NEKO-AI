// src/neko/services/vrmService.ts
//
// Что изменено:
//  • анимации и физика обновляются по реальному delta (THREE.Clock), а не по фиксированным 0.016;
//    порядок как в документации three-vrm: mixer → vrm.update;
//  • лимит FPS (по умолчанию 30): виджет, который всегда лежит поверх окон, не должен греть видеокарту на 60 fps;
//  • VRM 0.x автоматически разворачивается лицом к камере (VRMUtils.rotateVRM0);
//  • оптимизация модели (removeUnnecessaryVertices / combineSkeletons) и корректная очистка памяти;
//  • setEmotion(): плавные VRM-выражения лица + автоматическое моргание;
//  • capture(): портретный снимок для «селфи» в дневнике;
//  • ResizeObserver и обработчики больше не утекают при dispose().

import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { VRM, VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm'
import { AnimationManager } from './animationManager'
import { EMOTIONS } from '@shared/services/emotion'
import { MouthFilter, VISEMES } from '@shared/services/lipSync'
import type { EmotionLabel } from '@shared/types'

const PRESETS = ['happy', 'angry', 'sad', 'relaxed', 'surprised'] as const

export interface VRMInitOptions {
  maxFps?: number
  /** Цвет заливающего и контурного света (по умолчанию — тёплые тона NEKO) */
  fillColor?: number
  rimColor?: number
  /** Автокадрирование по росту модели: 'full' — в полный рост, 'bust' — по колени и выше. Без параметра камера как у NEKO */
  frame?: 'full' | 'bust'
  /** false — модель нельзя крутить и приближать мышью (окно ARIA) */
  interactive?: boolean
  /** Глаза следят за камерой */
  lookAtCamera?: boolean
}

export class VRMService {
  private scene: THREE.Scene | null = null
  private camera: THREE.PerspectiveCamera | null = null
  private renderer: THREE.WebGLRenderer | null = null
  private controls: OrbitControls | null = null
  private currentModel: VRM | null = null
  private animationFrame: number | null = null
  private container: HTMLElement | null = null
  private animationManager: AnimationManager | null = null
  private resizeObserver: ResizeObserver | null = null

  private opts: VRMInitOptions = {}
  private paused = false

  private clock = new THREE.Clock()
  private lastRender = 0
  private frameInterval = 1000 / 30

  // выражения лица
  private exprTarget: Partial<Record<string, number>> = {}
  private exprCurrent: Record<string, number> = {}
  private exprTimer: ReturnType<typeof setTimeout> | null = null
  private blinkIn = 2 + Math.random() * 3
  private blinkT = -1

  // липсинк: целевая форма рта приходит кадрами, здесь она сглаживается и пишется в VRM-выражения aa/ih/ou/ee/oh
  private mouth = new MouthFilter()
  private mouthApplied: number[] = [0, 0, 0, 0, 0]
  /** Когда рот в последний раз двигался (идёт озвучка) — в это время анимации не запускаются */
  private lastMouthActiveAt = -Infinity

  async initialize(container: HTMLElement, opts: VRMInitOptions = {}) {
    this.opts = opts
    this.container = container
    this.setMaxFps(opts.maxFps ?? 30)
    const width = Math.max(1, container.clientWidth)
    const height = Math.max(1, container.clientHeight)

    this.scene = new THREE.Scene()

    this.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000)
    this.camera.position.set(0, 1.4, 3.5)

    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'default' })
    this.renderer.setSize(width, height)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    container.appendChild(this.renderer.domElement)

    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.08
    this.controls.autoRotate = false
    this.controls.target.set(0, 1.2, 0)
    this.controls.minDistance = 1.5
    this.controls.maxDistance = 8
    if (opts.interactive === false) {
      this.controls.enableRotate = false
      this.controls.enableZoom = false
      this.controls.enablePan = false
    }
    this.controls.update()

    this.scene.add(new THREE.AmbientLight(0x404060, 0.6))

    const main = new THREE.DirectionalLight(0xffffff, 1.2)
    main.position.set(2, 3, 4)
    this.scene.add(main)

    const fill = new THREE.DirectionalLight(opts.fillColor ?? 0x9b7bb8, 0.4)
    fill.position.set(-2, 1, -2)
    this.scene.add(fill)

    const rim = new THREE.DirectionalLight(opts.rimColor ?? 0x6cb4ee, 0.3)
    rim.position.set(0, 2, -3)
    this.scene.add(rim)

    this.resizeObserver = new ResizeObserver(() => this.onResize())
    this.resizeObserver.observe(container)

    this.clock.start()
    this.animationFrame = requestAnimationFrame(this.loop)
  }

  setMaxFps(fps: number) {
    this.frameInterval = 1000 / Math.max(10, Math.min(120, fps || 30))
  }

  /** Приостановить отрисовку (модель не загружена или не видна) — видеокарта и процессор отдыхают */
  setPaused(paused: boolean) {
    this.paused = paused
    if (!paused) this.clock.getDelta() // не «проматывать» анимацию на время паузы
  }

  /** true — модель загружена; false — файла нет или он не VRM (причина в консоли) */
  async loadModel(url: string): Promise<boolean> {
    if (!this.scene) return false

    try {
      const loader = new GLTFLoader()
      loader.register((parser) => new VRMLoaderPlugin(parser))

      const gltf = await loader.loadAsync(url)
      const vrm = gltf.userData.vrm as VRM | undefined
      if (!vrm) throw new Error('Загруженный файл не является VRM-моделью')

      // Облегчаем модель и разворачиваем VRM 0.x лицом к камере
      const U = VRMUtils as any
      U.removeUnnecessaryVertices?.(gltf.scene)
      if (typeof U.combineSkeletons === 'function') U.combineSkeletons(gltf.scene)
      else U.removeUnnecessaryJoints?.(gltf.scene)
      U.rotateVRM0?.(vrm)
      vrm.scene.traverse((obj: THREE.Object3D) => { obj.frustumCulled = false })

      if (this.currentModel) this.disposeModel()

      this.mouthApplied = [0, 0, 0, 0, 0] // у новой модели рот в нуле
      this.currentModel = vrm
      this.scene.add(vrm.scene)
      vrm.scene.position.set(0, 0, 0)

      if (this.controls) {
        this.controls.target.set(0, 1.2, 0)
        this.controls.update()
      }
      if (this.opts.lookAtCamera && this.camera && vrm.lookAt) vrm.lookAt.target = this.camera
      if (this.opts.frame) this.frameModel()

      this.animationManager = new AnimationManager(vrm)
      console.log('✅ VRM модель загружена')
      return true
    } catch (error) {
      console.error('❌ Ошибка загрузки VRM:', error)
      return false
    }
  }

  /** Ставит камеру так, чтобы модель любого роста красиво поместилась в окно: от пола (или колен) до макушки */
  private frameModel() {
    const { camera, currentModel, controls } = this
    const mode = this.opts.frame
    if (!camera || !currentModel || !mode) return

    currentModel.scene.updateMatrixWorld(true)
    const boneY = (bone: 'head' | 'hips') => {
      const v = new THREE.Vector3()
      currentModel.humanoid?.getNormalizedBoneNode(bone)?.getWorldPosition(v)
      return v.y
    }
    const headY = boneY('head') > 0.3 ? boneY('head') : 1.45
    const hipsY = boneY('hips') > 0.1 ? boneY('hips') : headY * 0.55

    const top = headY + 0.24 // запас на причёску
    const bottom = mode === 'full' ? 0 : hipsY * 0.55 // «bust»: примерно до колен
    const centerY = (top + bottom) / 2

    const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))
    const byHeight = (top - bottom) / 2 / tan
    const byWidth = 0.36 / (tan * Math.max(0.2, camera.aspect)) // по ширине нужно уместить плечи и руки
    const dist = Math.max(byHeight, byWidth) * 1.06

    camera.position.set(0, centerY, dist)
    camera.lookAt(0, centerY, 0)
    controls?.target.set(0, centerY, 0)
    controls?.update()
  }

  private disposeModel() {
    this.animationManager?.dispose()
    this.animationManager = null
    if (this.currentModel) {
      this.scene?.remove(this.currentModel.scene)
      VRMUtils.deepDispose(this.currentModel.scene)
      this.currentModel = null
    }
  }

  async loadAnimations(animationUrls: { name: string; url: string }[]) {
    if (!this.animationManager) return
    await this.animationManager.loadAnimationsFromUrls(animationUrls)
  }

  /**
   * Случайные анимации с паузами в стандартной позе (`pauseSeconds` — средняя пауза).
   * Не запускаются, пока окно скрыто или аватар говорит (липсинк); повторный вызов меняет только паузу.
   */
  startRandomAnimations(pauseSeconds = 30) {
    this.animationManager?.startRandomAnimationCycle(pauseSeconds, () => this.isIdleBlocked())
  }

  /** Жест телом во время речи/в скрытом окне отвлекает — расписание в это время ждёт */
  private isIdleBlocked(): boolean {
    if (typeof document !== 'undefined' && document.hidden) return true
    return performance.now() - this.lastMouthActiveAt < 2500
  }

  stopRandomAnimations() {
    this.animationManager?.stopRandomAnimationCycle()
  }

  playAnimation(name: string) {
    this.animationManager?.playAnimation(name)
  }

  hasAnimations(): boolean {
    return (this.animationManager?.getAnimationNames().length ?? 0) > 0
  }

  getAnimationNames(): string[] {
    return this.animationManager?.getAnimationNames() ?? []
  }

  /* ───────────── выражения лица ───────────── */

  /** Показывает эмоцию на лице; через holdMs возвращается к нейтральному выражению */
  setEmotion(label: EmotionLabel, intensity = 0.7, holdMs = 7000) {
    const meta = EMOTIONS[label]
    const k = 0.6 + 0.4 * Math.max(0, Math.min(1, intensity))
    const target: Partial<Record<string, number>> = {}
    for (const [name, w] of Object.entries(meta.vrm)) target[name] = Math.min(1, (w ?? 0) * k)
    this.exprTarget = target

    if (this.exprTimer) clearTimeout(this.exprTimer)
    this.exprTimer = setTimeout(() => { this.exprTarget = {} }, holdMs)
  }

  private updateExpressions(delta: number) {
    const em = this.currentModel?.expressionManager
    if (!em) return
    const k = 1 - Math.exp(-delta * 7) // плавное приближение к целевому значению

    for (const name of PRESETS) {
      const target = this.exprTarget[name] ?? 0
      const cur = this.exprCurrent[name] ?? 0
      if (Math.abs(target - cur) < 0.002 && cur === target) continue
      const next = Math.abs(target - cur) < 0.002 ? target : cur + (target - cur) * k
      this.exprCurrent[name] = next
      em.setValue(name, next)
    }

    // моргание: короткий треугольный импульс раз в 2–6 секунд
    this.blinkIn -= delta
    if (this.blinkT < 0 && this.blinkIn <= 0) this.blinkT = 0
    let blink = 0
    if (this.blinkT >= 0) {
      this.blinkT += delta
      const phase = this.blinkT / 0.18
      blink = phase < 1 ? (phase < 0.5 ? phase * 2 : (1 - phase) * 2) : 0
      if (phase >= 1) { this.blinkT = -1; this.blinkIn = 2 + Math.random() * 4 }
    }
    em.setValue('blink', Math.max(blink, this.exprTarget.blink ?? 0))

    this.updateMouth(delta, em)
  }

  /**
   * Форма рта для липсинка. frame — пять весов [aa, ih, ou, ee, oh] 0..1 либо null/пусто (рот закрыт).
   * Кадры приходят из озвучки ~30 раз в секунду; нет кадров дольше 0,3 с — рот закрывается сам.
   */
  setMouth(frame: readonly number[] | null | undefined) {
    const now = performance.now()
    if (frame && frame.some((v) => v > 0.05)) this.lastMouthActiveAt = now
    this.mouth.set(frame, now)
  }

  private updateMouth(delta: number, em: NonNullable<VRM['expressionManager']>) {
    const m = this.mouth.step(delta, performance.now())
    for (let i = 0; i < 5; i++) {
      if (m[i] === this.mouthApplied[i]) continue
      this.mouthApplied[i] = m[i]
      em.setValue(VISEMES[i], m[i])
    }
  }

  /* ───────────── снимок для дневника ───────────── */

  /**
   * Портретный снимок (голова и плечи) в виде прозрачного PNG (data URL).
   * Камера и размер буфера на время съёмки меняются и тут же возвращаются — на экране ничего не мелькает.
   */
  async capture(emotion?: EmotionLabel, scale = 3): Promise<string | null> {
    const { renderer, camera, scene } = this
    if (!renderer || !camera || !scene || !this.currentModel) return null

    const savedPos = camera.position.clone()
    const savedTarget = this.controls?.target.clone()
    const savedRatio = renderer.getPixelRatio()
    try {
      if (emotion) {
        this.setEmotion(emotion, 0.9, 4000)
        this.exprCurrent = {}
        for (const [name, w] of Object.entries(this.exprTarget)) {
          this.exprCurrent[name] = w ?? 0
          this.currentModel.expressionManager?.setValue(name, w ?? 0)
        }
      }

      const head = new THREE.Vector3(0, 1.45, 0)
      this.currentModel.humanoid?.getNormalizedBoneNode('head')?.getWorldPosition(head)

      camera.position.set(head.x, head.y + 0.03, head.z + 1.0)
      camera.lookAt(head.x, head.y - 0.12, head.z)
      camera.updateProjectionMatrix()

      renderer.setPixelRatio(Math.max(1, savedRatio) * scale)
      this.currentModel.update(0)
      renderer.render(scene, camera)
      return renderer.domElement.toDataURL('image/png')
    } catch (e) {
      console.warn('Не удалось сделать снимок аватара:', e)
      return null
    } finally {
      camera.position.copy(savedPos)
      if (savedTarget) {
        this.controls?.target.copy(savedTarget)
        camera.lookAt(savedTarget)
      }
      renderer.setPixelRatio(savedRatio)
      camera.updateProjectionMatrix()
      this.controls?.update()
    }
  }

  /* ───────────── цикл отрисовки ───────────── */

  private loop = (time: number) => {
    this.animationFrame = requestAnimationFrame(this.loop)
    if (!this.renderer || !this.scene || !this.camera) return
    if (document.hidden || this.paused) return
    if (time - this.lastRender < this.frameInterval - 1) return
    this.lastRender = time

    const delta = Math.min(this.clock.getDelta(), 0.1)
    this.controls?.update()
    if (this.currentModel) {
      this.animationManager?.update(delta) // сначала анимация…
      this.updateExpressions(delta)
      this.currentModel.update(delta)      // …потом VRM (spring bones, expressions, look-at)
    }
    this.renderer.render(this.scene, this.camera)
  }

  private onResize() {
    if (!this.container || !this.camera || !this.renderer) return
    const width = Math.max(1, this.container.clientWidth)
    const height = Math.max(1, this.container.clientHeight)
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(width, height)
    if (this.opts.frame) this.frameModel() // окно изменило форму — перекадрируем
  }

  dispose() {
    if (this.animationFrame !== null) cancelAnimationFrame(this.animationFrame)
    this.animationFrame = null
    if (this.exprTimer) clearTimeout(this.exprTimer)
    this.resizeObserver?.disconnect()
    this.resizeObserver = null

    this.disposeModel()
    this.controls?.dispose()
    this.controls = null

    if (this.renderer) {
      this.renderer.dispose()
      this.renderer.domElement.remove()
    }
    this.renderer = null
    this.scene = null
    this.camera = null
  }
}
