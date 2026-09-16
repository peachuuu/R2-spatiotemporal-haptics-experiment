"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { GameState } from "../game/GameEngine";
import {
  BOSS_X_PERCENT,
  G02_ASSETS,
  G02_RUBBLE_PARTICLES,
  G03_ASSETS,
  G03_TIMING,
  G04_ASSETS,
  G04_TIMING,
  G05_ASSETS,
  G05_TIMING,
  G07_ASSETS,
  G08_ASSETS,
  G09_ASSETS,
  G09_TIMING,
  G11_ASSETS,
  G12_ASSETS,
  G12_TIMING,
  getAreaExpansionProgress,
  getBossAttackCount,
  getBossHpAfterAttacks,
  getG02Phase,
  getG03Phase,
  getG04Phase,
  getProjectileX,
  isPlayerWithinChestInteraction,
  type TimelineEvent,
} from "../game/eventTimeline";
import { getVisionRadius, VISION_TUNING } from "../game/visualTuning";
import { G02Audio } from "./G02Audio";
import { G03Audio } from "./G03Audio";
import { G04Audio } from "./G04Audio";
import { G05Audio } from "./G05Audio";
import { G09Audio } from "./G09Audio";
import { RainAudio } from "./RainAudio";
import { ProjectileAudio } from "./ProjectileAudio";
import { G12Audio } from "./G12Audio";
import { AreaAudio } from "./AreaAudio";

export function GameViewport({
  state,
  onInteract,
  activeEvent,
  eventElapsedMs = 0,
  hapticGateHeld = false,
  eventPrompt = "",
  showEndOverlay = true,
}: {
  state: GameState;
  onInteract: () => void;
  activeEvent?: TimelineEvent;
  eventElapsedMs?: number;
  /** STH/BH 正在 PREPARE 时，阻止同一 cue 边界的音画抢跑。 */
  hapticGateHeld?: boolean;
  eventPrompt?: string;
  /** Embedded experiment runs hide the terminal status overlay; the R2 parent owns the transition. */
  showEndOverlay?: boolean;
}) {
  const id = activeEvent?.id ?? "";
  const isProjectile = activeEvent?.kind === "projectile";
  const isArea = activeEvent?.kind === "area";
  const fromLeft = activeEvent?.parameters.direction === "left";
  const projectileX = activeEvent
    ? getProjectileX(activeEvent, eventElapsedMs)
    : -5;
  const areaProgress = activeEvent
    ? getAreaExpansionProgress(activeEvent, eventElapsedMs)
    : 0;
  const areaCenter =
    activeEvent?.kind === "area"
      ? Number(
          activeEvent.parameters.center ?? activeEvent.parameters.anchorX ?? 50,
        )
      : state.player.x;
  const ordinal = Number(activeEvent?.parameters.stageOrdinal ?? 0);
  const isG02 = id === "G02";
  const g02Phase = isG02 ? getG02Phase(eventElapsedMs) : undefined;
  const isG03 = id === "G03";
  const g03Phase = isG03 ? getG03Phase(eventElapsedMs) : undefined;
  const isG04 = id === "G04";
  const g04Phase = isG04 ? getG04Phase(eventElapsedMs) : undefined;
  const hasVisionMask =
    id === "G04" ||
    id === "G05" ||
    id === "G06" ||
    id.startsWith("G07-") ||
    id === "G08";
  const g03CastFrame = eventElapsedMs < G03_TIMING.castFrame2AtMs ? 1 : 2;
  const burnElapsedMs = Math.max(0, eventElapsedMs - G03_TIMING.castEndMs);
  const g03FireFrame = (Math.floor(burnElapsedMs / 150) % 6) + 1;
  const showG02Boss = isG02 && !["hero-fall", "pause"].includes(g02Phase ?? "");
  const showG02Rubble =
    isG02 &&
    ["rubble-rise", "rubble-hold", "rubble-fade"].includes(g02Phase ?? "");
  const showG02Impact =
    isG02 &&
    ["impact", "rubble-rise", "rubble-hold", "rubble-fade"].includes(
      g02Phase ?? "",
    );
  const bossHp = getBossHpAfterAttacks(getBossAttackCount(activeEvent));
  const visionPercent = getVisionRadius(activeEvent, eventElapsedMs);
  const visionYPercent = Math.max(18, Math.min(74, 74 - state.player.y * 3.4));
  const isChestSearch = activeEvent?.kind === "chest-discovery";
  const chestX = Number(
    activeEvent?.parameters.chestX ?? (id === "G05" ? 17 : 83),
  );
  const chestCueStartMs = Number(
    activeEvent?.parameters.cueStartMs ??
      (id === "G05" ? G05_TIMING.cueStartMs : G09_TIMING.taskStartMs),
  );
  const showChestCue = isChestSearch && eventElapsedMs >= chestCueStartMs;
  const nearChest =
    showChestCue && isPlayerWithinChestInteraction(state.player.x, chestX);
  const showG06ReturnGlow =
    id.startsWith("G07-") && ordinal === 1 && eventElapsedMs < 1200;
  const bossLeft = `${BOSS_X_PERCENT}%`;
  const hitNotice =
    state.elapsedMs < state.player.hurtUntilMs ? state.notice : "";
  const bottomNotice = hitNotice || eventPrompt;
  const heroMotion = !state.player.grounded
    ? "jump"
    : state.elapsedMs < state.player.hurtUntilMs
      ? "hurt"
      : Math.abs(state.player.vx) > 1
        ? "run"
        : "idle";
  const impactAtMs = Number(
    activeEvent?.parameters.impactAtMs ?? Number.POSITIVE_INFINITY,
  );
  const showAreaImpact =
    isArea && eventElapsedMs >= impactAtMs && eventElapsedMs < impactAtMs + 180;
  const previousPlayerHp = useRef(state.hp);
  const previousBossHp = useRef(bossHp);
  const [playerHpAlert, setPlayerHpAlert] = useState("");
  const [bossHpAlert, setBossHpAlert] = useState("");
  useEffect(() => {
    const delta = state.hp - previousPlayerHp.current;
    previousPlayerHp.current = state.hp;
    if (!delta) return;
    setPlayerHpAlert(`玩家 HP ${delta > 0 ? "+" : ""}${delta}%`);
    const timer = window.setTimeout(() => setPlayerHpAlert(""), 1200);
    return () => window.clearTimeout(timer);
  }, [state.hp]);
  useEffect(() => {
    const delta = bossHp - previousBossHp.current;
    previousBossHp.current = bossHp;
    if (!delta) return;
    setBossHpAlert(`守卫 HP ${delta > 0 ? "+" : ""}${Math.round(delta)}%`);
    const timer = window.setTimeout(() => setBossHpAlert(""), 1200);
    return () => window.clearTimeout(timer);
  }, [bossHp]);
  return (
    <section className="game-wrap" aria-label="可体验的横版像素动作游戏">
      <div
        className={`world ${g02Phase === "impact" ? "impact-shake" : ""}`}
        data-g02-phase={g02Phase}
        data-g03-phase={g03Phase}
        data-g04-phase={g04Phase}
      >
        <div className="sky" />
        <div className="mountains" />
        <div className="ruins" />
        <div
          className="ground"
          style={{
            backgroundImage: "url('/assets/ground-platform-v3.png')",
            backgroundSize: "100% 100%",
          }}
        />
        <div className="hud">
          <div className="portrait">◉</div>
          <div className="bars">
            <label>
              HP{" "}
              <i>
                <em style={{ width: `${state.hp}%` }} />
              </i>{" "}
              {state.hp}%
            </label>
            <label>
              守卫{" "}
              <i className="bossbar">
                <em style={{ width: `${bossHp}%` }} />
              </i>
            </label>
          </div>
          <div className="timer">{Math.floor(eventElapsedMs / 1000)}s</div>
        </div>
        {(playerHpAlert || bossHpAlert) && (
          <div className="hp-change-stack" role="status">
            {playerHpAlert && (
              <b className="player-hp-change">{playerHpAlert}</b>
            )}
            {bossHpAlert && <b className="boss-hp-change">{bossHpAlert}</b>}
          </div>
        )}
        {hasVisionMask && (
          <div
            className="fog"
            style={
              {
                "--p": `${state.player.x}%`,
                "--py": `${visionYPercent}%`,
                "--vision": `${visionPercent}%`,
                "--fog-feather": `${VISION_TUNING.featherPercent}%`,
                "--fog-feather-opacity": VISION_TUNING.featherOpacity,
                "--fog-outer-opacity": VISION_TUNING.outerOpacity,
              } as CSSProperties
            }
          />
        )}
        {activeEvent?.parameters.weather === "rain" && (
          <div className="rain-layer active" aria-hidden="true">
            {Array.from({ length: 72 }, (_, index) => (
              <i
                key={index}
                style={
                  {
                    "--rain-x": `${(index * 37 + 11) % 103}%`,
                    "--rain-delay": `${-((index * 19) % 170) / 100}s`,
                    "--rain-duration": `${0.66 + (index % 7) * 0.065}s`,
                    "--rain-length": `${12 + (index % 6) * 4}px`,
                    "--rain-opacity": 0.28 + (index % 5) * 0.085,
                    "--rain-drift": `${10 + (index % 4) * 4}px`,
                    "--rain-width": `${index % 9 === 0 ? 2 : 1}px`,
                  } as CSSProperties
                }
              />
            ))}
          </div>
        )}
        {(!isG02 || showG02Boss) && (
          <div
            className={`boss ${isG02 ? `g02-boss ${g02Phase === "boss-fall" ? "g02-boss-fall" : g02Phase === "impact" ? "g02-boss-impact" : ""}` : ""} ${g03Phase === "casting" || isProjectile || isArea ? "casting" : ""} ${id === "G08" ? "boss-shake" : ""} ${id === "G12" ? "g12-boss-fall" : ""}`}
            style={{ bottom: isG02 ? "17%" : "18%", left: bossLeft }}
          >
            {g03Phase === "casting" ? (
              <span className={`g03-boss-sprite frame-${g03CastFrame}`}>
                <img
                  src={G03_ASSETS.bossFrames[g03CastFrame - 1]}
                  alt="黑曜石守卫施法"
                  onLoad={(event) =>
                    event.currentTarget.parentElement?.classList.add("has-art")
                  }
                  onError={(event) => {
                    event.currentTarget.hidden = true;
                  }}
                />
              </span>
            ) : (
              <img src="/assets/boss-pixel.png" alt="黑曜石守卫" />
            )}
          </div>
        )}
        {showG02Impact && (
          <>
            <img
              className="g02-impact-dust"
              src={G02_ASSETS.impactDust}
              alt=""
              aria-hidden="true"
            />
            <div className="g02-dust-motes" aria-hidden="true">
              {Array.from({ length: 14 }, (_, index) => (
                <i
                  key={index}
                  style={
                    {
                      "--mote-x": `${8 + ((index * 31) % 85)}%`,
                      "--mote-y": `${(index * 13) % 44}%`,
                      "--mote-size": `${2 + (index % 4)}px`,
                      "--mote-delay": `${(index * 43) % 260}ms`,
                      "--mote-duration": `${900 + ((index * 97) % 650)}ms`,
                      "--mote-drift": `${(index % 2 ? 1 : -1) * (8 + (index % 5))}px`,
                    } as CSSProperties
                  }
                />
              ))}
            </div>
          </>
        )}
        {showG02Rubble && (
          <div className={`g02-rubble-field ${g02Phase}`} aria-hidden="true">
            {G02_RUBBLE_PARTICLES.map((particle) => (
              <span
                key={particle.id}
                className="g02-rubble-piece"
                style={
                  {
                    "--start-x": `${particle.startX}%`,
                    "--start-y": `${particle.startY}%`,
                    "--target-x": `${particle.targetX}%`,
                    "--target-y": `${particle.targetY}%`,
                    "--rock-size": `${particle.size}px`,
                    "--rock-rotation": `${particle.rotation}deg`,
                    "--rock-drift": `${particle.driftX}%`,
                    "--rock-drift-mid": `${particle.driftMidX}%`,
                    "--rock-fall": `${particle.fallY}%`,
                    "--rock-delay": `${particle.delayMs}ms`,
                    "--rock-duration": `${particle.durationMs}ms`,
                    "--rock-layer": particle.layer,
                  } as CSSProperties
                }
              >
                <img
                  src={particle.asset}
                  alt=""
                  onLoad={(event) =>
                    event.currentTarget.parentElement?.classList.add("has-art")
                  }
                  onError={(event) => {
                    event.currentTarget.hidden = true;
                  }}
                />
              </span>
            ))}
          </div>
        )}
        {g03Phase === "burning" && (
          <div className="g03-fire-stage" aria-hidden="true">
            {(["left", "right"] as const).map((side) => (
              <span key={side} className={`g03-fire-bank ${side}`}>
                <span className={`g03-fire-sprite frame-${g03FireFrame}`}>
                  <img
                    src={G03_ASSETS.fireFrames[g03FireFrame - 1]}
                    alt=""
                    onLoad={(event) =>
                      event.currentTarget.parentElement?.classList.add(
                        "has-art",
                      )
                    }
                    onError={(event) => {
                      event.currentTarget.hidden = true;
                    }}
                  />
                </span>
              </span>
            ))}
          </div>
        )}
        {g04Phase === "ghost-pass" && (
          <div className="g04-ghost-track" aria-hidden="true">
            <img className="g04-ghost" src={G04_ASSETS.ghost} alt="" />
          </div>
        )}
        {showChestCue && (
          <>
            <span
              className="chest-hint g05-cue"
              style={{ left: `${chestX}%` }}
            />
            <button
              className={`chest ${id === "G05" ? "g05-chest" : "g09-chest"}`}
              style={{ left: `${chestX}%` }}
              onClick={onInteract}
              aria-label="开启符文宝箱"
            >
              <img
                src={id === "G05" ? G05_ASSETS.chest : G09_ASSETS.chest}
                alt="符文宝箱"
              />
              {nearChest && (
                <small className="g05-interact-copy">
                  按O交互 打开宝箱
                </small>
              )}
            </button>
          </>
        )}
        {isProjectile && (
          <img
            className={`fireball timeline-projectile ${fromLeft ? "from-left" : "from-right"}`}
            data-speed={String(activeEvent?.parameters.speed ?? "slow")}
            src={
              id.startsWith("G11-")
                ? G11_ASSETS.projectile
                : G07_ASSETS.projectile
            }
            alt="魔法飞行物"
            style={{ left: `${projectileX}%`, bottom: "22%" }}
          />
        )}
        {isArea && (
          <>
            <div
              className="area-target-marker"
              style={{ left: `${areaCenter}%` }}
              aria-hidden="true"
            />
            <div
              className={`danger-ring timeline-area ${activeEvent?.parameters.speed === "fast" ? "fast" : "slow"}`}
              data-half-width={String(activeEvent?.parameters.halfWidth ?? 20)}
              data-target-mode={String(
                activeEvent?.parameters.targetMode ?? "fixed",
              )}
              style={
                {
                  left: `${areaCenter}%`,
                  "--area-width": `${Number(activeEvent?.parameters.halfWidth ?? 20) * 2}%`,
                  "--area-progress": areaProgress,
                } as CSSProperties
              }
              aria-label="以固定锚点为中心横向扩张的危险区域"
            >
              <i />
              <b />
            </div>
          </>
        )}
        {showAreaImpact && (
          <div
            className="area-impact-flash"
            style={{
              left: `${areaCenter}%`,
              width: `${Number(activeEvent?.parameters.halfWidth ?? 20) * 2}%`,
            }}
            aria-hidden="true"
          />
        )}
        {showG06ReturnGlow && (
          <div className="g06-return-glow" aria-hidden="true" />
        )}
        {id === "G12" && (
          <>
            <G12Audio
              src={G12_ASSETS.audio}
              startDelayMs={G12_TIMING.bossDefeatMs}
              eventElapsedMs={eventElapsedMs}
              hapticGateHeld={hapticGateHeld}
            />
            {eventElapsedMs >= G12_TIMING.bossDefeatMs && (
              <div className="g12-fireworks" aria-hidden="true">
                <i className="g12-rocket" />
                {[
                  ["12%", "19%", "#ffc96d", "1s"],
                  ["28%", "33%", "#ff9e8e", "1s"],
                  ["39%", "16%", "#aeeaff", "1.18s"],
                  ["52%", "35%", "#8ed8ff", "1.18s"],
                  ["63%", "18%", "#d6a0ff", "2s"],
                  ["73%", "36%", "#c99aff", "2s"],
                  ["84%", "22%", "#ff91cb", "3s"],
                  ["91%", "40%", "#ffca7e", "3s"],
                  ["47%", "25%", "#e8b0ff", "3s"],
                ].map(([left, top, color, delay], index) => (
                  <i
                    key={index}
                    className="g12-burst"
                    style={
                      {
                        "--firework-left": left,
                        "--firework-top": top,
                        "--firework-color": color,
                        "--firework-delay": delay,
                      } as CSSProperties
                    }
                  />
                ))}
                {Array.from({ length: 26 }, (_, index) => (
                  <i
                    key={`fall-${index}`}
                    className="g12-fall"
                    style={
                      {
                        "--fall-left": `${8 + ((index * 29) % 87)}%`,
                        "--fall-top": `${18 + ((index * 17) % 30)}%`,
                        "--fall-delay": `${4 + (index % 5) * 0.09}s`,
                        "--fall-drift": `${((index % 6) - 3) * 9}px`,
                      } as CSSProperties
                    }
                  />
                ))}
              </div>
            )}
          </>
        )}
        <div
          className={`hero-anchor ${heroMotion} ${g02Phase === "hero-fall" ? "g02-hero-fall" : ""} ${g03Phase === "burning" ? "g03-burning" : ""}`}
          style={{
            left: `${state.player.x}%`,
            bottom: `${17.8 + state.player.y * 3.4}%`,
            transform: `translate3d(-50%, 0, 0) scaleX(${state.player.facing})`,
          }}
        >
          <img
            className={`hero-sprite ${heroMotion}`}
            src="/assets/hero-pixel.png"
            alt="冒险者主角"
          />
          {g03Phase === "burning" && (
            <span className="g03-hero-embers" aria-hidden="true">
              {Array.from({ length: 8 }, (_, index) => (
                <i
                  key={index}
                  style={
                    {
                      "--ember-x": `${12 + index * 11}%`,
                      "--ember-bottom": `${4 + (index % 3) * 12}%`,
                      "--ember-duration": `${0.62 + index * 0.035}s`,
                      "--ember-delay": `${index * -0.09}s`,
                      "--ember-drift": `${index % 2 ? 5 : -4}px`,
                    } as CSSProperties
                  }
                />
              ))}
            </span>
          )}
          {state.elapsedMs < state.player.attackUntilMs && (
            <span className="slash" />
          )}
        </div>
        {bottomNotice && (
          <div
            className={`notice ${hitNotice ? "hit-notice" : "event-explanation in-game"}`}
            role="status"
          >
            {bottomNotice}
          </div>
        )}
        {isG02 && <G02Audio eventElapsedMs={eventElapsedMs} hapticGateHeld={hapticGateHeld} />}
        {isG03 && <G03Audio eventElapsedMs={eventElapsedMs} hapticGateHeld={hapticGateHeld} />}
        {isG04 && <G04Audio eventElapsedMs={eventElapsedMs} hapticGateHeld={hapticGateHeld} />}
        {isChestSearch && id !== "G09" && <G05Audio eventElapsedMs={eventElapsedMs} hapticGateHeld={hapticGateHeld} audioStartMs={Number(activeEvent?.parameters.audioStartMs ?? G05_TIMING.audioStartMs)} />}
        {id === "G09" && <G09Audio eventElapsedMs={eventElapsedMs} hapticGateHeld={hapticGateHeld} />}
        {id === "G08" && <RainAudio src={G08_ASSETS.rainAudio} hapticGateHeld={hapticGateHeld} />}
        {isProjectile && (
          <ProjectileAudio
            event={activeEvent!}
            src={
              id.startsWith("G11-")
                ? activeEvent?.parameters.speed === "fast"
                  ? G11_ASSETS.projectileFastAudio
                  : G11_ASSETS.projectileSlowAudio
                : activeEvent?.parameters.speed === "fast"
                  ? G07_ASSETS.projectileFastAudio
                  : G07_ASSETS.projectileSlowAudio
            }
            hapticGateHeld={hapticGateHeld}
          />
        )}
        {isArea && (
          <AreaAudio
            event={activeEvent!}
            eventElapsedMs={eventElapsedMs}
            expansionSrc={
              activeEvent?.parameters.speed === "fast"
                ? G07_ASSETS.areaFastAudio
                : G07_ASSETS.areaSlowAudio
            }
            impactSrc={G07_ASSETS.areaImpactAudio}
            hapticGateHeld={hapticGateHeld}
          />
        )}
        {state.paused && <div className="pause-overlay">已暂停</div>}
        {state.terminal && showEndOverlay && (
          <div className="pause-overlay">本轮结束：{state.terminal.status}</div>
        )}
      </div>
    </section>
  );
}
