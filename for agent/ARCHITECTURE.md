# АРХИТЕКТУРА — «Boxing-Bots»
Файл: ARCHITECTURE.md | Версия 5.0

## 0. ОБЗОР И МАППИНГ ПАПОК
Паттерн: ECS-подобные системы над сущностями; рендер отделён от логики; shared-контракты.
client/src/core → §1; rendering → §2; physics → §3; entities → §4; systems → §5;
editor-логика в systems+ui → §6; network → §7 (детали в NETWORK.md); ui/ → SCENES/STYLE.

## 1. CORE
ARC-1.1 GameLoop: fixed-step PHYS_STEP_HZ для логики/физики + rAF-рендер с alpha-интерполяцией.
ARC-1.2 SceneManager: стек из одной активной сцены; load/unload; переходы SCN-0.
ARC-1.3 InputManager: буфер инпутов с таймстемпами; клавиатура/тач/геймпад; при дебаффе
материнки сдвигает таймстемпы на DEBUFF_INPUT_DELAY_MS; multi-touch изоляция (SCN-5.1).
ARC-1.4 AudioManager (Howler, микс ≤3, STYLE §6); EventBus (типизированные события MEC-7);
AssetLoader (процедурные ассеты, прогресс-бар).

## 2. RENDERING
ARC-2.1 RenderEngine: renderer, свет/тени (STYLE §5.3), постпроцессинг (STYLE §8).
ARC-2.2 VoxelRenderer: ОДИН InstancedMesh на бота (DynamicDrawUsage); живой куб = матрица,
уничтоженный = нулевая матрица; цвет/повреждение через instanceColor.
ARC-2.3 DebrisRenderer+DebrisPool: пул обломков и отсечённых кластеров; лимиты PERF-2;
sleep/culling (MEC-2.8).
ARC-2.4 ParticleSystem: пулы Points/InstancedMesh, лимиты PERF-3.
ARC-2.5 FloatingText3D: пул спрайтов; текст RU; подъём FLOAT_TEXT_RISE за FLOAT_TEXT_DURATION_S, fade.
ARC-2.6 PostProcessing: виньетка/шум (STY-8.1); глитч бота (STY-8.2) — шейдер материала бота.
ARC-2.7 CameraController: CAM_*; lerp-следование; адаптивный FOV; не вращается.
ARC-2.8 LODManager: дистанции PERF-4; переключение детализации VoxelGrid-представлений.

## 3. PHYSICS
ARC-3.1 PhysicsWorld: Rapier, fixed step; гравитация GRAVITY; тело бота (capsule-коллайдер),
стены арены, пол.
ARC-3.2 CollisionHandler: spherecast-запросы хитбоксов/ударов (radius из пресета); возврат
списка вокселей по глубине (MEC-2.1).
ARC-3.3 Мусор: динамические тела обломков из DebrisPool; авто-sleep.

## 4. ENTITIES
ARC-4.1 VoxelGrid: 3D-массив вокселей {id, pos, type, hp, maxHp, scale, alive, parentId};
запросы getInRadius(pos,r); граф связей скелета (parent → children).
ARC-4.2 LimbGraph: построение при генерации (корень грудь/таз); traverseChildren(destroyedId)
→ список отсечения (MEC-2.7).
ARC-4.3 BotEntity: состояние, дебаффы, производные множители (MEC-2.5/2.9), суммарный урон,
сетевой id; слоты пресетов.
ARC-4.4 BotAnimator: процедурные позы из пресетов/стейтов (ходьба, удар, блок, wobble).
ARC-4.5 BotFactory: сборка по схемам STY-1.2/1.3; assert(count ≤ BOT_CUBE_LIMIT) — юнит-тест.

## 5. SYSTEMS
ARC-5.1 DamageSystem: применение урона по кубику (слой, HP, пороги MEC-2.2); эмит событий MEC-7.
ARC-5.2 LimbDetachmentSystem: по событию уничтожения скелетного куба → LimbGraph.traverse →
пометить detached → DebrisPool + импульс; сеть: LimbDetachmentEvent (NET-3).
ARC-5.3 DebuffManager: включение/выключение дебаффов, производные статов, триггер надписей.
ARC-5.4 StrikeSystem: выполнение пресета по фазам; активный хитбокс; кулдауны; knockback.
ARC-5.5 BlockSystem: поза, стамина (MEC-4.2), баффы (MEC-4.3), зоны покрытия (MEC-4.4);
контрудар выбирает случайный кубик руки атакующего (детерминированно: seed из tick+slot).
ARC-5.6 BalanceSystem: wobble/падения (STY-3.4), потеря опоры (MEC-2.9).
ARC-5.7 AISystem: FSM MEC-6, использует те же Strike/BlockSystem.

## 6. РЕДАКТОР
ARC-6.1 KinematicTimeline: ключевые кадры руки/корпуса; сплайн Catmull-Rom; валидация диапазонов.
ARC-6.2 StrikeSerializer: serialize/deserialize пресета ≤ PRESET_BYTES_MAX; generateHitboxes
(preset, t) — детерминированно на клиенте и хосте.

## 7. СЕТЬ (клиент/хост) — детали в NETWORK.md
LobbyClient, PeerConnection, HostSimulator (headless Rapier + все Systems авторитетно),
InputSender, StateInterpolator, RollbackBuffer, NetworkManager.

## 8. КЛЮЧЕВЫЕ АЛГОРИТМЫ
ARC-8.1 Resolution урона (шаги): 1) spherecast по траектории хитбокса; 2) сортировка вокселей
по глубине вдоль нормали удара; 3) урон в первый живой слой (обшивка→скелет→компонент);
4) пересчёт scale скелета (MEC-2.6); 5) проверки порогов (MEC-2.2) и отсечения (MEC-2.7);
6) события MEC-7 + DamageEvent/LimbDetachmentEvent (PvP).
ARC-8.2 Rollback: буфер снапшотов ≤ ROLLBACK_MAX_FRAMES; при расхождении с хост-снапшотом:
restore → replay инпутов → сглаживание визуала 100 мс.
ARC-8.3 Детерминизм: фикс. step; округление NET_ROUND_DECIMALS; seed-RNG контрудара из tick;
параметрические пресеты.
ARC-8.4 Пулинг: все частицы/обломки/спрайты/надписи — пулы с лимитами PERF.

## 9. TS-КОНТРАКТЫ (ключевые)
interface Voxel { id:number; pos:Vec3; type:VoxelType; hp:number; maxHp:number; scale:number; alive:boolean; parentId:number|null; }
type VoxelType='armor'|'skeleton'|'motherboard'|'battery'|'gyro'|'camera';
interface StrikePreset { id:string; slot:'A'|'B'|'C'|'D'; hand:'left'|'right'|'both';
  controlPoints:Vec3[]; tension:number; duration:number; windup:number; active:number;
  recovery:number; force:number; hitboxRadius:number; knockback:number; }
interface BlockPreset { id:string; slot:'A'|'B'|'C'|'D'; pose:'head'|'cross'|'low';
  buff:'fortification'|'counterstrike'; coverage:Capsule; }
interface BotSnapshot { id:string; pos:Vec3; rot:number; anim:string; stamina:number;
  blockSlot:'A'|'B'|'C'|'D'|null; debuffs:DebuffState; totalDamage:number; }
Экспорты модулей — по папкам §0; shared/types — единые для client/server.

## 10. ТЕСТЫ (обязательные юнит-тесты)
VoxelGrid (запросы радиуса), LimbGraph (отсечение локтя/бедра/шеи; компоненты не отваливаются),
StrikeSerializer (round-trip ≤ PRESET_BYTES_MAX), BlockSystem (стамина-формула, контрудар-цель),
BotFactory (лимит кубов), DamageSystem (пороги 60/0).