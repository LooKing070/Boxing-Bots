# МЕХАНИКИ, БАЛАНС, ДАННЫЕ, ПРОИЗВОДИТЕЛЬНОСТЬ — «Boxing-Bots»
Файл: MECHANICS.md | Версия 5.0
Единственный источник всех числовых констант (§8–9). Имена DAT_*/PERF_* генерируются
в shared/constants (TZ-7.2).

## 1. МАТЧ И ПОБЕДА
MEC-1.1 Длительность матча MATCH_DURATION_S. Таймер виден в HUD (SCN-4.1).
MEC-1.2 Нокаут: HP Материнской платы ИЛИ Аккумулятора противника ≤ 0 → немедленная победа.
MEC-1.3 По очкам: по истечении времени побеждает больший суммарный урон за матч;
при равенстве — ничья (оверлей SCN-4.6).
MEC-1.4 Суммарный урон = весь нанесённый урон по всем кубикам противника, включая
возвращённый контрударом (MEC-4.3Б). Отображение — цифрами (SCN-4.1).
MEC-1.5 Комбо, серий, множителей урона НЕТ (TZ-6.2).

## 2. УРОН, ПОРОГИ, ОТСЕЧЕНИЯ
MEC-2.1 Слои и порядок доступа: удар сначала бьёт Обшивку; после разрушения куба обшивки
в точке попадания урон идёт в Скелет; после разрушения скелета/через «окна» — во внутренние
компоненты (spherecast по глубине, ARC-8.1).
MEC-2.2 Пороги внутренних компонентов: Цел HP ≥ THRESHOLD_DAMAGE·maxHP; Повреждён
0 < HP < THRESHOLD_DAMAGE·maxHP; Уничтожен HP ≤ 0.
MEC-2.3 При переходе в «Повреждён»: дебафф (MEC-2.5) + надпись 2 сек (SCN-4.4) + VFX (STYLE §4).
MEC-2.4 При «Уничтожен»: компонент удаляется из модели («дыра»); Материнская плата/
Аккумулятор → нокаут (MEC-1.2); Гироскоп/Камеры → усиленный дебафф, бой продолжается.
MEC-2.5 Таблица дебаффов:
| Компонент | Повреждён | Уничтожен |
|---|---|---|
| Материнская плата | задержка ввода DEBUFF_INPUT_DELAY_MS; глитч модели | нокаут |
| Аккумулятор | сила удара ×DEBUFF_FORCE_MULT; тусклые глаза | нокаут |
| Гироскоп | скорость ×DEBUFF_SPEED_MULT; wobble | скорость ×DEBUFF_SPEED_MULT_DESTROYED, «падения» |
| Камеры | виньетка; искры из глаз | сильная виньетка+шум |
MEC-2.6 Скелет: каждый куб уменьшается: currentScale = 1 − damageTaken/maxHP (равномерно
XYZ, центр сохраняется). scale ≤ 0 → куб уничтожен.
MEC-2.7 Отсечение (Limb Detachment): уничтожение куба скелета отсекает все дочерние кубы
скелета и привязанной обшивки ниже по иерархии графа (корень = грудь/таз). Внутренние
компоненты НЕ отваливаются (TZ-6.5). Примеры: локоть → предплечье+кисть; бедро → вся нога;
шея → голова (бой продолжается, эффект уничтоженных камер).
MEC-2.8 Отсечённые части — независимый мусор: DebrisPool, sleep через DEBRIS_SLEEP_S,
удаление через DEBRIS_LIFETIME_S, урона не наносят, предупреждений нет.
MEC-2.9 Геймплейные последствия: нет руки → нельзя бить ею; нет ноги → потеря опоры
(скорость ×DEBUFF_NOLEG_MULT); нет головы → MEC-2.4 «Камеры уничтожены».

## 3. УДАРЫ
MEC-3.1 Слоты A–D: в каждом удар ИЛИ блок (MEC-4.1). Пресет удара: рука (левая/правая/обе),
сплайн Catmull-Rom, фазы windup/active/recovery, force, hitboxRadius, knockback.
MEC-3.2 Хитбокс активен только в фазе active; позиция — точка сплайна; проверка spherecast
по вокселям противника (ARC-8.1).
MEC-3.3 Кулдаун слота после удара STRIKE_COOLDOWN_MS. Один удар за фазу active попадает
по каждому кубику не более 1 раза.
MEC-3.4 Дефолты редактора: левая — замах→выброс; правая — прямой выброс.
MEC-3.5 Knockback применяется к телу бота; в блоке с любым баффом knockback = 0 (MEC-4.3).

## 4. БЛОКИ И СТАМИНА
MEC-4.1 Блок занимает слот A–D вместо удара (стратегическая цена). Активация — зажатие.
MEC-4.2 Стамина: макс STAMINA_MAX; тап (<1 с) −STAMINA_TAP_COST; удержание
−STAMINA_HOLD_COST_PER_S за каждую полную секунду; реген +STAMINA_REGEN_PER_2S каждые 2 с
вне блока; 0 → принудительное прерывание. Полоска над ботом (SCN-4.3).
MEC-4.3 Баффы (один на слот, выбор в редакторе):
А «Укрепление»: весь входящий урон ×BLOCK_DAMAGE_MULT; knockback сохраняется.
Б «Контрудар»: атакующему возвращается COUNTERSTRIKE_RETURN от входящего урона —
в случайный кубик ТОЙ руки атакующего, которой нанесён удар; возвращённый урон может
опускать HP кубиков руки ниже порогов (дебаффы/отсечения руки возможны); добавляется
к суммарному урону защищающегося (MEC-1.4); knockback обнуляется.
MEC-4.4 Блок защищает только зоны позы; спина и незакрытые зоны урон получают полностью.
MEC-4.5 Визуал блока — ТОЛЬКО поза + полоска стамины (TZ-6.4).

## 5. ДВИЖЕНИЕ
MEC-5.1 Оси: X — ходьба со скоростью MOVE_SPEED; Y — прыжок JUMP_FORCE, гравитация GRAVITY;
присед ↓ уменьшает высоту хитбоксов корпуса на CROUCH_HEIGHT_MULT.
MEC-5.2 Границы арены — невидимые стены по X (STYLE §5).
MEC-5.3 Итоговая скорость = MOVE_SPEED × множители дебаффов (MEC-2.5) × MEC-2.9.

## 6. PvE ИИ
MEC-6.1 Конечный автомат: Подход → Атака (слот из доступных) → Отступление/Блок
(вероятностно по сложности easy/medium/hard) → Пауза. Реагирует на дистанцию и кулдауны;
использует блоки с той же математикой стамины.

## 7. СОБЫТИЯ ДЛЯ VFX/ЗВУКА/СЕТИ
MEC-7.1 Боевые события (триггеры): HIT_ARMOR, HIT_SKELETON, COMPONENT_DAMAGED,
COMPONENT_DESTROYED, LIMB_DETACHED, BLOCK_ABSORBED, COUNTERSTRIKE, MATCH_END.
Каждое порождает VFX (STYLE §4), звук (STYLE §6) и, в PvP, сетевое событие (NETWORK §3).

## 8. ЧИСЛОВЫЕ КОНСТАНТЫ (единственный источник)
Бот: VOXEL_SIZE=0.25; BOT_CUBE_LIMIT=1000; HP_ARMOR=30; HP_SKELETON=50; HP_CAMERA=30;
HP_MOTHERBOARD=40; HP_GYRO=40; HP_BATTERY=40; JOINT_SIZE=0.5.
Пороги/дебаффы: THRESHOLD_DAMAGE=0.6; DEBUFF_INPUT_DELAY_MS=500; DEBUFF_FORCE_MULT=0.7;
DEBUFF_SPEED_MULT=0.6; DEBUFF_SPEED_MULT_DESTROYED=0.5; DEBUFF_NOLEG_MULT=0.3.
Матч: MATCH_DURATION_S=180; FLOAT_TEXT_DURATION_S=2; FLOAT_TEXT_RISE=0.5.
Удары: STRIKE_COOLDOWN_MS=800; STR_FORCE_MIN=1; STR_FORCE_MAX=10.
Блок: STAMINA_MAX=100; STAMINA_TAP_COST=10; STAMINA_HOLD_COST_PER_S=10;
STAMINA_REGEN_PER_2S=2; BLOCK_DAMAGE_MULT=0.65; COUNTERSTRIKE_RETURN=0.08.
Движение: MOVE_SPEED=5.0; JUMP_FORCE=8.0; GRAVITY=-9.81; CROUCH_HEIGHT_MULT=0.6.
Обломки/частицы: DEBRIS_SLEEP_S=0.5; DEBRIS_LIFETIME_S=5; PARTICLE_LIFE_S=1.5;
SKELETON_HIT_DEFORM=0.10; SPARK counts см. STYLE §4 (числа там же как DAT-ссылки:
P_HIT_ARMOR_MIN=3, P_HIT_ARMOR_MAX=5, P_HIT_SKEL_MIN=5, P_HIT_SKEL_MAX=8,
P_COMP_DMG_MIN=8, P_COMP_DMG_MAX=12, P_COMP_DESTROY_MIN=15, P_COMP_DESTROY_MAX=20).
Камера: CAM_FOV=30; CAM_POS=(0,5,18); CAM_LOOK=(0,3,0); CAM_LERP=0.05;
CAM_FOV_MIN=25; CAM_FOV_MAX=35.
Арена: ARENA_SIZE=(20,1,6); RAIL_HEIGHT=1.5; POST_SIZE=(0.5,3,0.5); CITY_DIST=50.
Анимации: BREATH_AMP=0.02; BREATH_HZ=1; WALK_AMP=0.3; WALK_HZ=2.
Сеть: NET_SNAPSHOT_HZ=30; NET_INPUT_BUFFER_MS=50; ROLLBACK_MAX_FRAMES=7;
GUEST_RECONNECT_S=10; NET_ROUND_DECIMALS=3; PRESET_BYTES_MAX=200.
UI: TOUCH_MIN_MOVE_PX=48; TOUCH_MIN_ACTION_PX=64.
Хранилище: STORE_SETTINGS="bb_settings_v1"; STORE_PRESETS="bb_presets_v1";
STORE_PROFILE="bb_profile_v1".

## 9. ПРОИЗВОДИТЕЛЬНОСТЬ (бюджеты и меры)
PERF-1 Цели: FPS_TARGET_DESKTOP=60; FPS_TARGET_MOBILE=30; BUNDLE_GZIP_MB=2.
PERF-2 Тела: MAX_PHYS_BODIES=300; MAX_DEBRIS_DESKTOP=200; MAX_DEBRIS_MOBILE=100.
PERF-3 Частицы: MAX_PARTICLES_DESKTOP=150; MAX_PARTICLES_MOBILE=50.
PERF-4 LOD: полная детализация <LOD_FULL=10 юнитов; средняя <LOD_MED=20; низкая (~100 кубов)
<LOD_LOW=40; далее billboard-силуэт.
PERF-5 Мобильный профиль: SHADOW_MAP_MOBILE=512 (десктоп 1024); PIXEL_RATIO_MOBILE=1.5
(десктоп 2); пост-эффекты отключаемы (SCN-3.2); chunking отсечений кластерами 4–8 кубов;
sleep/culling обломков (MEC-2.8); пулинг всего (ARC-2).
PERF-6 Draw calls цели: ≤10 на сцену боя (InstancedMesh: бот×2, мусор, частицы, арена, фон).
PERF-7 Замеры: Chrome DevTools Performance + Spector.js; тест-устройства: mid-Android
(Snapdragon 7xx-серии), iPhone 11-серии, десктоп GTX1050-уровня; профилирование после фаз 2, 5, 6.