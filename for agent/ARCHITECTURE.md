# АРХИТЕКТУРА — «Boxing-Bots»
Файл: ARCHITECTURE.md | Версия 5.1

## 0. ОБЗОР И МАППИНГ ПАПОК
ECS-подобные системы над сущностями; рендер отделён от логики; shared-контракты.
client/src: core → §1; rendering → §2; physics → §3; entities → §4; systems → §5;
editor → §6; network → §7; ui/ → SCENES/STYLE.

## 1. CORE
ARC-1.1 GameLoop: fixed-step PHYS_STEP_HZ + rAF-рендер с alpha-интерполяцией.
ARC-1.2 SceneManager: одна активная сцена; переходы SCN-0.
ARC-1.3 InputManager: буфер инпутов с таймстемпами; клавиатура/тач/геймпад; дебафф материнки —
сдвиг таймстемпов на DEBUFF_INPUT_DELAY_MS; multi-touch изоляция.
ARC-1.4 AudioManager (Howler, ≤3), EventBus (события MEC-7), AssetLoader.

## 2. RENDERING
ARC-2.1 RenderEngine: renderer, свет/тени (STYLE §5.3), постпроцессинг (STYLE §8).
ARC-2.2 VoxelRenderer: ОДИН InstancedMesh на бота; уничтоженный куб = нулевая матрица;
повреждения через instanceColor/масштаб (уменьшение скелета MEC-2.6).
ARC-2.3 DebrisRenderer+DebrisPool: пул обломков и отсечённых кластеров (включая внутренние
компоненты); лимиты PERF-2; sleep/culling.
ARC-2.4 ParticleSystem: пулы, лимиты PERF-3.
ARC-2.5 FloatingText3D: пул спрайтов; RU-тексты; подъём FLOAT_TEXT_RISE за FLOAT_TEXT_DURATION_S.
ARC-2.6 PostProcessing: виньетка/шум (STY-8.1); глитч — шейдер материала бота (STY-8.2).
ARC-2.7 CameraController: CAM_*; lerp; адаптивный FOV; не вращается.
ARC-2.8 LODManager: дистанции PERF-4.

## 3. PHYSICS
ARC-3.1 PhysicsWorld: Rapier fixed step; GRAVITY; capsule-тело бота; пол/стены.
ARC-3.2 CollisionHandler: запросы против ФАКТИЧЕСКИХ позиций вокселей (хитбоксы всегда
следуют визуальной модели, MEC-5.1); куб-хитбокс кулака FIST_HITBOX_SIZE (для культи —
VOXEL_SIZE у края остатка); проверка остановки на первом контакте; проверка «попадание по
рукам позы» для баффов блока; push-коллизия ботов (off во время кувырка).
ARC-3.2 CollisionHandler: возврат списка по глубине (MEC-2.1); проверка «попадание по рукам позы» для MEC-4.0.
ARC-3.3 Мусор: динамические тела обломков; авто-sleep.

## 4. ENTITIES
ARC-4.1 VoxelGrid: воксели {id, pos, type, hp, maxHp, scale, alive, parentId}; getInRadius(pos,r).
ARC-4.2 LimbGraph: направленный граф (корень грудь/таз → конечности); УЗЛЫ ВНУТРЕННИХ
КОМПОНЕНТОВ прикреплены к скелету своей части; traverseChildren(destroyedId) → список отсечения
(может включать компоненты, MEC-2.7).
ARC-4.3 BotEntity: статы, дебаффы, производные множители, суммарный урон, сетевой id, слоты.
ARC-4.4 BotAnimator: позы/изгибы + разворот (MEC-9), кувырок (MEC-5.3), нокдаун/подъём
(MEC-2.10), шатание гироскопа (STY-3.9), «попытка» культей (STY-3.10).
ARC-4.5 BotFactory: сборка по схемам STY-1.2/1.3; assert(count ≤ BOT_CUBE_LIMIT).

## 5. SYSTEMS
ARC-5.1 DamageSystem: урон по кубику (слой, HP, пороги MEC-2.2); события MEC-7.
ARC-5.2 LimbDetachmentSystem: traverse → detached (скелет+обшивка+компоненты) → DebrisPool +
импульс; компоненты помечаются уничтоженными (MEC-2.4/2.7); сеть: LimbDetachmentEvent.
ARC-5.3 DebuffManager: дебаффы, производные статов, триггер надписей.
ARC-5.4 StrikeSystem: таймлайн кадров с индивидуальными длительностями; возврат в стойку
за ACTION_GAP_MS; урон по формуле MEC-3.2; ≤1 попадания на куб от каждого кулака; остановка
на первом контакте; кулдауны слотовый + глобальный.
ARC-5.5 BlockSystem: условия MEC-4.0/4.6/4.7 (воздух запрещён; ходьба ×0.5; удары запрещены;
культя); стамина MEC-4.2; баффы MEC-4.3.
ARC-5.6 BalanceSystem: wobble/падения, потеря опоры.
ARC-5.7 AISystem: FSM MEC-6 на тех же Systems.

## 6. РЕДАКТОР
ARC-6.1 KinematicTimeline: кадры = {point:Vec3, duration:0.2–1.0}; валидация ±EDITOR_RANGE,
n ≤ FRAMES_MAX.
ARC-6.2 StrikeSerializer: удар {slot, hand, force, frames:[{p:Vec3, d:number}]};
блок {slot, hand, buff, reductionPct, returnPct, frame:Vec3}; ≤ PRESET_BYTES_MAX
(6 кадров × 16 Б + заголовок ≈ 120 Б).
ARC-6.2 StrikeSerializer: пресет → параметрический формат ≤ PRESET_BYTES_MAX:
удар {slot, hand, force, speed, frames: Vec3[]}; блок {slot, hand, buff, reduction, return, frame}.
generateHitboxPath(preset, t) — позиция куба-хитбокса по полилинии; детерминированно на клиенте и хосте.

## 7. СЕТЬ (клиент/хост) — детали в NETWORK.md
LobbyClient, PeerConnection, HostSimulator (headless Rapier + все Systems авторитетно),
InputSender, StateInterpolator, RollbackBuffer, NetworkManager.

## 8. КЛЮЧЕВЫЕ АЛГОРИТМЫ
ARC-8.1 Resolution урона: 1) куб-хитбокс кулака по траектории; 2) пересечение с вокселями,
сортировка по глубине вдоль нормали; 3) урон в первый живой слой (обшивка→скелет→компонент);
4) пересчёт scale скелета; 5) проверки порогов и отсечения (включая компоненты); 6) условия
   баффов блока (попадание по рукам позы) и контрудара; 7) события MEC-7 + DamageEvent/
   LimbDetachmentEvent (PvP).
   ARC-8.2 Rollback: буфер ≤ ROLLBACK_MAX_FRAMES; restore → replay инпутов → сглаживание 100 мс.
   ARC-8.3 Детерминизм: fixed step; округление NET_ROUND_DECIMALS; seed-RNG из tick; параметрические
   пресеты; FIST_HITBOX_SIZE — общая константа, не передаётся.
   ARC-8.4 Пулинг: частицы/обломки/спрайты/надписи — пулы с лимитами PERF.

## 9. TS-КОНТРАКТЫ (ключевые)
interface Voxel { id:number; pos:Vec3; type:VoxelType; hp:number; maxHp:number; scale:number; alive:boolean; parentId:number|null; }
type VoxelType='armor'|'skeleton'|'motherboard'|'battery'|'gyro'|'camera';
interface StrikePreset { id:string; slot:'A'|'B'|'C'|'D'; hand:'left'|'right'|'both';
force:number; speed:number; frames:Vec3[]; }
interface BlockPreset { id:string; slot:'A'|'B'|'C'|'D'; hand:'left'|'right'|'both';
buff:'fortification'|'counterstrike'; reductionPct:number; returnPct:number; frame:Vec3; }
interface BotSnapshot { id:string; pos:Vec3; rot:number; anim:string; stamina:number;
blockSlot:'A'|'B'|'C'|'D'|null; debuffs:DebuffState; totalDamage:number; }
Экспорты — по папкам §0; shared/types едины для client/server.

## 10. ТЕСТЫ (обязательные юнит-тесты)
VoxelGrid (радиус-запросы); LimbGraph (локоть/бедро/шея/грудь: компоненты отсекаются и помечаются
уничтоженными); StrikeSerializer (round-trip ≤ PRESET_BYTES_MAX); BlockSystem (стамина-формула;
баффы только при попадании по рукам; контрудар-цель); BotFactory (лимит кубов); DamageSystem
(пороги 60/0; HP_ARMOR=20/HP_SKELETON=60); StrikeSystem (хитбокс = FIST_HITBOX_SIZE, ≤1 попадание на куб).