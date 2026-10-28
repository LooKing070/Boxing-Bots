# СЕТЬ — «Boxing-Bots»
Файл: NETWORK.md | Версия 5.1

## 1. ТОПОЛОГИЯ И РОЛИ
NET-1.1 Colyseus — только лобби/матчинг/метаданные; бой НЕ симулирует.
NET-1.2 Бой — P2P WebRTC (PeerJS): ХОСТ = авторитет (headless Rapier, все Systems, победы);
ГОСТЬ = инпуты + prediction. Relay-fallback при недоступности прямого канала (RM-5).
NET-1.3 Равный входной буфер задержки NET_INPUT_BUFFER_MS у хоста и гостя (анти host-advantage).

## 2. ЖИЗНЕННЫЙ ЦИКЛ МАТЧА
NET-2.1 Лобби: создать комнату (код) / войти по коду / поиск (SCN-1.3).
NET-2.2 Pre-match: обмен версиями констант, пресетами 4 слотов (формат ARC-6.2), никнеймами.
NET-2.3 Старт: синхронный countdown 3 с от хост-тика.
NET-2.4 Бой: снапшоты NET_SNAPSHOT_HZ; инпуты каждый физический тик.
NET-2.5 Завершение: MatchEnd (knockout|timeout|host_left|guest_timeout|draw).

## 3. DTO (контракты)
// Клиент → Хост
interface ClientInput { seq:number; timestamp:number; actions:InputAction[]; }
interface ClientAction { presetId:string; slot:'A'|'B'|'C'|'D'; kind:'strike'|'block'; timestamp:number; }
// Хост → Клиент
interface HostStateUpdate { tick:number; bots:BotSnapshot[]; }
interface DamageEvent { tick:number; targetBotId:string; hitPoint:Vec3;
  destroyedVoxelIds:number[]; damagedComponent:VoxelType|null;
  debris:{ voxelId:number; force:Vec3 }[]; }
interface LimbDetachmentEvent { tick:number; destroyedCubeId:number; detachedCubeIds:number[];
  center:Vec3; impulse:Vec3; }   // detachedCubeIds может включать кубы внутренних компонентов
interface BlockState { playerId:string; slot:'A'|'B'|'C'|'D'|null;
  buff:'fortification'|'counterstrike'|null; stamina:number; }
interface MatchEnd { reason:'knockout'|'timeout'|'host_left'|'guest_timeout'|'draw';
  winnerId:string|null; damage:{ playerId:string; total:number }[]; }

## 4. НЕТКОД
NET-4.1 Гость: prediction своих действий; RollbackBuffer ≤ ROLLBACK_MAX_FRAMES; reconciliation
по HostStateUpdate (ARC-8.2).
NET-4.2 Интерполяция оппонента: lerp между снапшотами (задержка 1 снапшот).
NET-4.3 Хост: симуляция fixed-step; валидация инпутов (seq, частота, кулдауны, стамина).
NET-4.4 Детерминизм: NET_ROUND_DECIMALS; seed-RNG из tick; параметрические пресеты;
FIST_HITBOX_SIZE — общая константа (не передаётся).
NET-4.5 Fallback: delay-based режим (равный буфер NET_INPUT_BUFFER_MS без prediction)
при невозможности rollback; переключение автоматическое.

## 5. СИНХРОНИЗАЦИЯ РАЗРУШЕНИЙ И ПРЕСЕТОВ
NET-5.1 Координаты обломков НЕ передаются: шлются DamageEvent/LimbDetachmentEvent; клиенты
детерминированно симулируют мусор/частицы локально (STYLE §4).
NET-5.2 Пресеты передаются один раз в pre-match (полилиния кадров + сила/скорость/баффы),
далее только presetId+slot.
NET-5.3 Суммарный урон и стамина — в HostStateUpdate (источник — хост).

## 6. ДИСКОННЕКТЫ (строго)
NET-6.1 Дисконнект ХОСТА → MatchEnd{reason:'host_left', winnerId:null} → оверлей SCN-4.7
«Матч отменён»; статистика не сохраняется.
NET-6.2 Дисконнект ГОСТЯ → ожидание GUEST_RECONNECT_S; реконнект → восстановление сессии по
токену из последнего снапшота; не успел → MatchEnd{reason:'guest_timeout', winnerId:host},
статистика сохраняется.
NET-6.3 UI ожидания/ошибок — SCN-4.7; тосты реконнекта.

## 7. НАДЁЖНОСТЬ И ВАЛИДАЦИЯ
NET-7.1 Хост валидирует: частоту инпутов; кулдауны слотов; трату стамины; невозможные действия
(удар отсечённой рукой; блок при стамине 0; значения пресетов вне диапазонов DAT).
NET-7.2 Heartbeat 1 Гц; таймаут 3 с → процедура NET-6.
NET-7.3 Экспоненциальный retry реконнекта гостя в окне GUEST_RECONNECT_S.
NET-7.4 Сетевые константы — из MECHANICS §8 (R2).