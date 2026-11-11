// src/neko/services/animationManager.ts
//
// Что исправлено:
//  • .vrma-файлы раньше грузились обычным GLTFLoader и брались из gltf.animations[0] — такие треки не привязывались
//    к костям VRM-модели, анимации «не играли». Теперь используется @pixiv/three-vrm-animation
//    (createVRMAnimationClip), а для обычных GLB с анимациями остаётся прежний путь;
//  • плавные переходы (crossfade) вместо резкого stop()/play();
//  • таймер «закончить анимацию» больше не обрывает чужую (новую) анимацию;
//  • не-idle анимации играются один раз и держат последнюю позу до следующей смены;
//  • анимации идут не подряд: после каждой аватар возвращается в стандартную позу (клип idle…) и стоит там паузу
//    `animationPause` — расписание в shared/services/animationScheduler.ts.

import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { VRM } from '@pixiv/three-vrm'
import { VRMAnimationLoaderPlugin, createVRMAnimationClip } from '@pixiv/three-vrm-animation'
import { AnimationScheduler } from '@shared/services/animationScheduler'

const FADE = 0.45

export class AnimationManager {
  private mixer: THREE.AnimationMixer
  private clips = new Map<string, THREE.AnimationClip>()
  private currentAction: THREE.AnimationAction | null = null
  private currentName: string | null = null
  private scheduler: AnimationScheduler | null = null
  private isBusy: () => boolean = () => false

  constructor(private vrm: VRM) {
    this.mixer = new THREE.AnimationMixer(vrm.scene)
    // клип «сыгран один раз» дошёл до конца → расписание возвращает аватар в стандартную позу
    this.mixer.addEventListener('finished', (e: { action?: THREE.AnimationAction }) => {
      if (e.action === this.currentAction) this.scheduler?.onGestureFinished()
    })
  }

  addAnimation(name: string, clip: THREE.AnimationClip) {
    this.clips.set(name, clip)
    if (name.startsWith('idle') && !this.currentAction) this.playAnimation(name)
  }

  /**
   * Плавно переключается на анимацию. Idle зациклен, остальные — один раз с удержанием позы.
   * `once` принудительно играет клип один раз (так расписание проигрывает и «idle2» как обычную анимацию).
   * Возвращает длительность клипа в секундах (null — клипа нет).
   */
  playAnimation(name: string, once?: boolean): number | null {
    const clip = this.clips.get(name)
    if (!clip) {
      console.warn(`Анимация «${name}» не найдена`)
      return null
    }
    if (this.currentName === name && this.currentAction?.isRunning()) return clip.duration

    const next = this.mixer.clipAction(clip)
    next.reset()
    if (!(once ?? !name.startsWith('idle'))) {
      next.setLoop(THREE.LoopRepeat, Infinity)
      next.clampWhenFinished = false
    } else {
      next.setLoop(THREE.LoopOnce, 1)
      next.clampWhenFinished = true
    }
    next.enabled = true
    next.setEffectiveWeight(1)

    if (this.currentAction && this.currentAction !== next) {
      next.play()
      this.currentAction.crossFadeTo(next, FADE, false)
    } else {
      next.fadeIn(FADE).play()
    }
    this.currentAction = next
    this.currentName = name
    return clip.duration
  }

  /** Стандартная поза — первый клип idle… (по алфавиту: idle1). Нет такого клипа — null */
  private restName(): string | null {
    const idle = [...this.clips.keys()].filter((n) => n.startsWith('idle')).sort()
    return idle[0] ?? null
  }

  /** Всё, кроме стандартной позы: это и есть «анимации» для случайного показа */
  private gestureNames(): string[] {
    const rest = this.restName()
    return [...this.clips.keys()].filter((n) => n !== rest)
  }

  /** Плавное возвращение в стандартную позу (зацикленный idle) */
  returnToIdle() {
    const rest = this.restName()
    if (rest) this.playAnimation(rest, false)
  }

  /**
   * Случайные анимации с паузами: стандартная поза ↔ клип. `pauseSeconds` — средняя пауза в стандартной позе.
   * Повторный вызов только меняет паузу (идущий клип не обрывается). `busy` — «не сейчас» (аватар говорит, окно скрыто).
   */
  startRandomAnimationCycle(pauseSeconds = 30, busy?: () => boolean) {
    if (busy) this.isBusy = busy
    if (!this.scheduler) {
      this.scheduler = new AnimationScheduler({
        gestures: () => this.gestureNames(),
        play: (name) => this.playAnimation(name, true),
        rest: () => this.returnToIdle(),
        busy: () => this.isBusy(),
      })
    }
    // Если сейчас играет не стандартная поза (например, после загрузки модели) — сначала в неё
    if (!this.scheduler.running) this.returnToIdle()
    this.scheduler.start(pauseSeconds)
  }

  stopRandomAnimationCycle() {
    this.scheduler?.stop()
  }

  getAnimationNames(): string[] {
    return [...this.clips.keys()]
  }

  update(delta: number) {
    this.mixer.update(delta)
  }

  async loadAnimationsFromUrls(urls: { name: string; url: string }[]) {
    const loader = new GLTFLoader()
    loader.register((parser) => new VRMAnimationLoaderPlugin(parser))

    // Файлы независимы — грузим параллельно, а в карту добавляем в исходном порядке
    const loaded = await Promise.all(
      urls.map(async ({ name, url }) => {
        try {
          const gltf = await loader.loadAsync(url)
          const vrma = gltf.userData.vrmAnimations?.[0]
          if (vrma) return { name, clip: createVRMAnimationClip(vrma, this.vrm) }
          if (gltf.animations?.length) return { name, clip: gltf.animations[0] } // обычный GLB — как раньше
          console.warn(`⚠️ В файле ${name} нет анимаций`)
        } catch (error) {
          console.error(`❌ Ошибка загрузки анимации ${name}:`, error)
        }
        return null
      })
    )
    for (const item of loaded) if (item) this.addAnimation(item.name, item.clip)
  }

  dispose() {
    this.stopRandomAnimationCycle()
    this.scheduler = null
    this.mixer.stopAllAction()
    this.mixer.uncacheRoot(this.vrm.scene)
    this.clips.clear()
    this.currentAction = null
  }
}
