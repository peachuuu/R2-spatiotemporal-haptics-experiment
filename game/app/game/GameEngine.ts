import {
  ENCOUNTER_FLOW,
  EVENT_CATALOG,
  getAreaTrials,
  getIntroCues,
  getProjectileTrials,
  type AreaTrial,
  type ProjectileTrial,
} from "./encounterScript";
import { GameTelemetry } from "./GameTelemetry";
import type { GameEventId, GameRunResult, LaunchConfig } from "./types";

export type GameInput = {
  type:
    | "MOVE"
    | "JUMP"
    | "ATTACK"
    | "INTERACT"
    | "PAUSE"
    | "RESUME"
    | "ABORT";
  atMs: number;
  moveX?: number;
  /** Which device produced this input; transitions emit objective input-method events. */
  method?: "keyboard" | "gamepad";
};
export type PlayerState = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  moveX: number;
  grounded: boolean;
  facing: -1 | 1;
  hurtUntilMs: number;
  attackUntilMs: number;
};
export type GameState = {
  phase: "intro" | "explore" | "combat" | "victory" | "terminal";
  elapsedMs: number;
  paused: boolean;
  hp: number;
  bossHp: number;
  player: PlayerState;
  vision: number;
  notice: string;
  impactActive: boolean;
  fireActive: boolean;
  bossCasting: boolean;
  chestOpened: boolean;
  counterUntilMs: number;
  bossCastUntilMs: number;
  activeProjectile?: ProjectileTrial & { x: number };
  activeArea?: AreaTrial;
  areaRadius: number;
  terminal?: GameRunResult;
};

export const PLAYER_HP = {
  max: 100,
  burnDamage: 20,
  attackDamage: 10,
} as const;

export function createGameEngine(config: LaunchConfig) {
  const telemetry = new GameTelemetry(config);
  let state: GameState = {
    phase: "intro",
    elapsedMs: 0,
    paused: false,
    hp: PLAYER_HP.max,
    bossHp: 100,
    player: {
      x: 30,
      y: 0,
      vx: 0,
      vy: 0,
      moveX: 0,
      grounded: true,
      facing: 1,
      hurtUntilMs: 0,
      attackUntilMs: 0,
    },
    vision: 80,
    notice: "点击开始，进入月萤遗迹。",
    impactActive: false,
    fireActive: false,
    bossCasting: false,
    chestOpened: false,
    counterUntilMs: 0,
    bossCastUntilMs: 0,
    areaRadius: 0,
  };
  let projectileIndex = 0;
  let areaIndex = 0;
  let activeAtMs = 0;
  let nextTrialAtMs = 0;
  let previousTickMs = 0;
  let lastInputMethod: "keyboard" | "gamepad" | undefined;
  const shownIntro = new Set<string>();
  const emit = (
    eventId: GameEventId,
    outcome: string,
    atMs: number,
    extra = {},
  ) =>
    telemetry.record({ eventId, outcome, atMs, phase: state.phase, ...extra });
  const end = (
    status: GameRunResult["status"],
    atMs: number,
    eventId?: GameEventId,
  ) => {
    if (state.terminal) return;
    if (eventId) emit(eventId, status, atMs);
    state = {
      ...state,
      phase: "terminal",
      terminal: telemetry.complete(status, atMs),
    };
  };
  const startArea = (atMs: number) => {
    const trial = getAreaTrials(config.areaSequenceId)[areaIndex];
    if (!trial) {
      state = {
        ...state,
        phase: "victory",
        bossHp: 0,
        bossCasting: false,
        notice: "遗迹守卫被击败，试炼完成。",
      };
      emit("boss-defeated", "completed", atMs);
      end("won", atMs);
      return;
    }
    activeAtMs = atMs;
    state = {
      ...state,
      activeArea: trial,
      areaRadius: 0,
      bossCasting: true,
      bossCastUntilMs: atMs + ENCOUNTER_FLOW.combat.areaBossCastMs,
      notice: `范围攻击 ${trial.trialIndex}/4：离开符文范围。`,
    };
    emit("area-rune", "spawned", atMs, { trialIndex: trial.trialIndex });
  };
  const startProjectile = (atMs: number) => {
    const trial = getProjectileTrials(config.projectileSequenceId)[
      projectileIndex
    ];
    if (!trial) {
      startArea(atMs);
      return;
    }
    activeAtMs = atMs;
    state = {
      ...state,
      activeProjectile: { ...trial, x: trial.spawnX },
      bossCasting: true,
      bossCastUntilMs: atMs + trial.telegraphMs,
      notice: `飞行物 ${trial.trialIndex}/6：准备闪避。`,
    };
    emit(trial.eventId, "spawned", atMs, { trialIndex: trial.trialIndex });
  };
  const updatePlayer = (elapsedMs: number) => {
    const dt = Math.min(0.1, Math.max(0, (elapsedMs - previousTickMs) / 1000));
    const p = state.player;
    const nextVx = p.moveX * 18;
    const vx = p.vx + (nextVx - p.vx) * Math.min(1, dt * 14);
    const vy = p.vy - 50 * dt;
    const y = Math.max(0, p.y + vy * dt);
    state = {
      ...state,
      player: {
        ...p,
        x: Math.max(4, Math.min(96, p.x + vx * dt)),
        vx,
        vy: y === 0 ? 0 : vy,
        y,
        grounded: y === 0,
      },
    };
  };
  return {
    enterCombat() {
      if (state.phase !== "terminal") state = { ...state, phase: "combat" };
    },
    tickPlayerOnly(elapsedMs: number) {
      if (state.paused) return;
      updatePlayer(elapsedMs);
      previousTickMs = elapsedMs;
      state = { ...state, elapsedMs };
    },
    takeCinematicFireHit(atMs: number) {
      emit("player-hit", "hit", atMs, { sourceEventId: "fire-wall" });
      state = {
        ...state,
        hp: Math.max(0, state.hp - PLAYER_HP.burnDamage),
        player: { ...state.player, hurtUntilMs: atMs + 650 },
        notice: "受到火焰灼烧。",
      };
      return true;
    },
    takeTimelineHit(atMs: number, source: "projectile" | "area") {
      if (atMs < state.player.hurtUntilMs)
        return false;
      emit("player-hit", "hit", atMs, {
        sourceEventId:
          source === "area" ? "area-rune" : "projectile-right-middle",
      });
      state = {
        ...state,
        hp: Math.max(0, state.hp - PLAYER_HP.attackDamage),
        player: { ...state.player, hurtUntilMs: atMs + 450 },
        notice: source === "area" ? "受到范围攻击。" : "受到投射物攻击。",
      };
      return true;
    },
    clearTransientFeedback(atMs: number) {
      state = {
        ...state,
        player: {
          ...state.player,
          hurtUntilMs: Math.min(state.player.hurtUntilMs, atMs),
        },
        notice: state.notice.startsWith("受到") ? "" : state.notice,
      };
    },
    resumeTimelinePreview(atMs: number) {
      if (!state.terminal) return;
      state = {
        ...state,
        phase: "intro",
        terminal: undefined,
        paused: false,
        player: {
          ...state.player,
          moveX: 0,
          hurtUntilMs: atMs,
          attackUntilMs: atMs,
        },
        notice: "",
      };
    },
    completeTimeline(atMs: number) {
      end("won", atMs);
    },
    setTimelineMetadata(metadata: {
      seed: string;
      order: string[];
      records: import("./types").TimelineEventRecord[];
    }) {
      telemetry.setTimelineMetadata(metadata);
    },
    tick(elapsedMs: number) {
      if (state.terminal || state.paused) return;
      updatePlayer(elapsedMs);
      previousTickMs = elapsedMs;
      state = {
        ...state,
        elapsedMs,
        impactActive:
          elapsedMs >= (EVENT_CATALOG["boss-landing"].startMs ?? 0) &&
          elapsedMs <
            (EVENT_CATALOG["boss-landing"].startMs ?? 0) +
              (EVENT_CATALOG["boss-landing"].durationMs ?? 0),
        fireActive:
          elapsedMs >= (EVENT_CATALOG["fire-wall"].startMs ?? 0) &&
          elapsedMs <
            (EVENT_CATALOG["ghost-pass"].startMs ?? Number.MAX_SAFE_INTEGER),
        bossCasting:
          state.bossCastUntilMs > elapsedMs ? state.bossCasting : false,
      };
      if (elapsedMs >= 300000) {
        end("timeout", elapsedMs, "run-timeout");
        return;
      }
      if (state.phase === "intro") {
        for (const cue of getIntroCues(elapsedMs))
          if (!shownIntro.has(cue.eventId)) {
            shownIntro.add(cue.eventId);
            emit(cue.eventId, "shown", cue.atMs);
            if (cue.eventId === "boss-landing")
              state = {
                ...state,
                impactActive: true,
                notice: "黑曜石守卫坠入遗迹。",
              };
            if (cue.eventId === "boss-casting")
              state = {
                ...state,
                bossCasting: true,
                bossCastUntilMs:
                  EVENT_CATALOG["fire-wall"].startMs ?? elapsedMs,
                notice: "守卫正在蓄力。",
              };
            if (cue.eventId === "fire-wall")
              state = {
                ...state,
                bossCasting: false,
                fireActive: true,
                notice: "火焰封锁前路。",
              };
            if (cue.eventId === "ghost-pass") {
              state = {
                ...state,
                phase: "explore",
                vision: ENCOUNTER_FLOW.exploration.vision,
                fireActive: false,
                notice: "火焰熄灭。幽灵掠过，视野收窄；向左寻找宝箱。",
              };
              emit("chest-cue", "shown", cue.atMs);
            }
          }
        return;
      }
      if (
        state.phase === "combat" &&
        !state.activeProjectile &&
        !state.activeArea &&
        elapsedMs >= nextTrialAtMs
      ) {
        startProjectile(elapsedMs);
        return;
      }
      if (state.phase === "combat" && state.activeProjectile) {
        const projectile = {
          ...state.activeProjectile,
          x:
            state.activeProjectile.x +
            state.activeProjectile.velocity *
              Math.min(0.1, Math.max(0, (elapsedMs - activeAtMs) / 1000)),
        };
        state = { ...state, activeProjectile: projectile };
        activeAtMs = elapsedMs;
        const invulnerable = elapsedMs < state.player.hurtUntilMs;
        if (
          !invulnerable &&
          Math.abs(projectile.x - state.player.x) < 3 &&
          Math.abs(projectile.y - state.player.y) < 1
        ) {
          emit("player-hit", "hit", elapsedMs, {
            trialIndex: projectile.trialIndex,
            sourceEventId: projectile.eventId,
          });
          projectileIndex++;
          state = {
            ...state,
            hp: Math.max(1, state.hp - 1),
            activeProjectile: undefined,
            player: { ...state.player, hurtUntilMs: elapsedMs + 600 },
            notice: "受到飞行物攻击。",
          };
          nextTrialAtMs = elapsedMs + ENCOUNTER_FLOW.combat.gapAfterTrialMs;
        } else if (projectile.x < -7 || projectile.x > 107) {
          emit("projectile-evaded", "passed", elapsedMs, {
            trialIndex: projectile.trialIndex,
            sourceEventId: projectile.eventId,
          });
          projectileIndex++;
          state = {
            ...state,
            activeProjectile: undefined,
            notice: "飞行物已掠过。",
          };
          nextTrialAtMs = elapsedMs + ENCOUNTER_FLOW.combat.gapAfterTrialMs;
        }
      }
      const activeArea = state.activeArea;
      if (state.phase === "combat" && activeArea) {
        const areaRadius = Math.min(
          activeArea.radius,
          activeArea.radius * ((elapsedMs - activeAtMs) / activeArea.activeMs),
        );
        state = { ...state, areaRadius };
        if (elapsedMs - activeAtMs > activeArea.activeMs) {
          const trial = activeArea;
          const escaped = Math.abs(state.player.x - trial.x) > trial.radius;
          if (escaped)
            emit("area-escaped", "escaped", elapsedMs, {
              trialIndex: trial.trialIndex,
              sourceEventId: "area-rune",
            });
          else
            emit("player-hit", "hit", elapsedMs, {
              trialIndex: trial.trialIndex,
              sourceEventId: "area-rune",
            });
          areaIndex++;
          state = {
            ...state,
            hp: escaped ? state.hp : Math.max(1, state.hp - 1),
            activeArea: undefined,
            areaRadius: 0,
            notice: escaped ? "成功离开符文范围。" : "未能离开符文范围。",
          };
          nextTrialAtMs = elapsedMs + ENCOUNTER_FLOW.combat.gapAfterTrialMs;
        }
      }
    },
    dispatch(input: GameInput) {
      if (state.terminal) return;
      if (input.method !== undefined && input.method !== lastInputMethod) {
        lastInputMethod = input.method;
        emit(input.method === "keyboard" ? "input-keyboard" : "input-gamepad", "used", input.atMs);
      }
      if (input.type === "MOVE") {
        const moveX = Math.max(-1, Math.min(1, input.moveX ?? 0));
        const previousMoveX = state.player.moveX;
        state = {
          ...state,
          player: {
            ...state.player,
            moveX,
            facing: moveX === 0 ? state.player.facing : moveX < 0 ? -1 : 1,
          },
        };
        if (moveX !== previousMoveX) {
          emit(
            moveX === 0 ? "player-move-stop" : "player-move-start",
            moveX === 0 ? "stopped" : moveX < 0 ? "left" : "right",
            input.atMs,
            { playerX: state.player.x, playerY: state.player.y, action: "move" },
          );
        }
        return;
      }
      if (input.type === "JUMP" && state.player.grounded) {
        state = {
          ...state,
          player: { ...state.player, vy: 22, grounded: false },
        };
        emit("player-jump", "jumped", input.atMs, {
          playerX: state.player.x,
          playerY: state.player.y,
          action: "jump",
        });
        return;
      }
      if (input.type === "PAUSE") {
        state = { ...state, paused: true };
        emit("run-paused", "paused", input.atMs);
        return;
      }
      if (input.type === "RESUME") {
        state = { ...state, paused: false };
        emit("run-resumed", "resumed", input.atMs);
        return;
      }
      if (input.type === "ABORT") {
        end("aborted", input.atMs, "run-aborted");
        return;
      }
      if (
        input.type === "INTERACT" &&
        state.phase === "explore" &&
        state.player.x <= ENCOUNTER_FLOW.exploration.interactAtOrBelowX
      ) {
        emit("player-interact", "interacted", input.atMs, {
          playerX: state.player.x,
          playerY: state.player.y,
          action: "interact",
        });
        state = {
          ...state,
          phase: "combat",
          chestOpened: true,
          vision: ENCOUNTER_FLOW.exploration.combatVision,
          notice: "宝箱开启。守卫苏醒，试炼开始。",
        };
        emit("chest-opened", "opened", input.atMs);
        nextTrialAtMs = input.atMs + ENCOUNTER_FLOW.combat.initialDelayMs;
        return;
      }
      if (input.type === "ATTACK") {
        state = {
          ...state,
          player: { ...state.player, attackUntilMs: input.atMs + 320 },
        };
        if (state.phase === "combat" && input.atMs <= state.counterUntilMs) {
          const nextBossHp = Math.max(20, state.bossHp - 20);
          emit("counter-hit", "countered", input.atMs, {
            bossHpBefore: state.bossHp,
            bossHpAfter: nextBossHp,
          });
          state = {
            ...state,
            bossHp: nextBossHp,
            counterUntilMs: 0,
            notice: "反击命中！守卫受到伤害。",
          };
        } else
          state = {
            ...state,
            notice: "普通攻击无法穿透守卫护甲；请在闪避后反击。",
          };
      }
    },
    getState: () => ({ ...state }),
    getTelemetry: () => telemetry,
    getResult: () => state.terminal,
  };
}
