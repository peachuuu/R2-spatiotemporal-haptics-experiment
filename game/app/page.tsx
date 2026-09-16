/* eslint-disable */
"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { StudyEntry } from "./components/StudyEntry";

type Condition = "NH" | "BH" | "STH";
type Phase = "intro" | "explore" | "combat" | "victory" | "defeat";
type Projectile = {
  id: number;
  x: number;
  y: number;
  vx: number;
  hit: boolean;
};
type Player = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: 1 | -1;
  dashUntil: number;
  hurtUntil: number;
  attackUntil: number;
  grounded: boolean;
};
const initialPlayer: Player = {
  x: 51,
  y: 0,
  vx: 0,
  vy: 0,
  facing: 1,
  dashUntil: 0,
  hurtUntil: 0,
  attackUntil: 0,
  grounded: true,
};
const projectilePatterns = [
  { x: 106, y: 0.8, vx: -16, label: "right low" },
  { x: -6, y: 0.8, vx: 16, label: "left low" },
  { x: 106, y: 1.25, vx: -20, label: "right middle" },
  { x: -6, y: 1.25, vx: 20, label: "left middle" },
  { x: 106, y: 1.65, vx: -17, label: "right high" },
  { x: -6, y: 1.65, vx: 17, label: "left high" },
];

function LegacyHome() {
  const [condition, setCondition] = useState<Condition>("STH");
  const [running, setRunning] = useState(false);
  const [phase, setPhase] = useState<Phase>("intro");
  const [view, setView] = useState(initialPlayer);
  const [hp, setHp] = useState(5);
  const [bossHp, setBossHp] = useState(100);
  const [chestOpen, setChestOpen] = useState(false);
  const [shots, setShots] = useState<Projectile[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [notice, setNotice] = useState(
    "Press Start to enter the Moonlit Ruins",
  );
  const [vision, setVision] = useState(80);
  const [rangeActive, setRangeActive] = useState(false);
  const [rangePoint, setRangePoint] = useState(50);
  const [impactActive, setImpactActive] = useState(false);
  const [bossCasting, setBossCasting] = useState(false);
  const [fireActive, setFireActive] = useState(false);
  const player = useRef<Player>({ ...initialPlayer });
  const pressed = useRef<Record<string, boolean>>({});
  const shotsRef = useRef<Projectile[]>([]);
  const startAt = useRef(0);
  const nextAttack = useRef(0);
  const counterUntil = useRef(0);
  const rangeUntil = useRef(0);
  const id = useRef(0);
  const bossCastUntil = useRef(0);
  const attackIndex = useRef(0);
  const fireShown = useRef(false);
  const impactShown = useRef(false);
  const render = useCallback(() => setView({ ...player.current }), []);
  const start = () => {
    player.current = { ...initialPlayer };
    setView({ ...initialPlayer });
    setHp(5);
    setBossHp(100);
    setChestOpen(false);
    setShots([]);
    shotsRef.current = [];
    setPhase("intro");
    setElapsed(0);
    setVision(80);
    setRangeActive(false);
    setImpactActive(false);
    setBossCasting(false);
    setFireActive(false);
    nextAttack.current = 0;
    counterUntil.current = 0;
    rangeUntil.current = 0;
    attackIndex.current = 0;
    fireShown.current = false;
    impactShown.current = false;
    startAt.current = performance.now();
    setRunning(true);
    setNotice("守卫从天而降，碎石向四周散开……");
  };
  const jump = useCallback(() => {
    if (!running) return;
    const p = player.current;
    if (p.grounded) {
      p.vy = 22;
      p.grounded = false;
      setNotice("跳跃：可越过直线飞行物");
    }
  }, [running]);
  const dash = useCallback(() => {
    if (!running) return;
    const p = player.current;
    p.dashUntil = performance.now() + 330;
    p.vx = p.facing * 42;
    setNotice("冲刺：短暂无敌");
  }, [running]);
  const interact = useCallback(() => {
    if (!running) return;
    const p = player.current;
    if (phase === "explore" && !chestOpen && p.x < 28) {
      setChestOpen(true);
      setPhase("combat");
      setVision(18);
      nextAttack.current = performance.now() + 1200;
      setNotice("宝箱开启；视野扩大，但仍保持受限。守卫开始施法。");
    }
  }, [running, phase, chestOpen]);
  const attack = useCallback(() => {
    if (!running) return;
    const p = player.current;
    p.attackUntil = performance.now() + 320;
    if (phase === "combat" && performance.now() < counterUntil.current)
      setBossHp((v) => {
        const n = Math.max(0, v - 20);
        if (n === 0) {
          setPhase("victory");
          setNotice("遗迹守卫被击败！");
        } else setNotice("反击命中守卫！");
        return n;
      });
    render();
  }, [running, phase, render]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      pressed.current[k] = true;
      if ([" ", "arrowup", "w"].includes(k)) {
        e.preventDefault();
        jump();
      }
      if (k === "shift") dash();
      if (k === "e") interact();
      if (k === "j") attack();
    };
    const up = (e: KeyboardEvent) => {
      pressed.current[e.key.toLowerCase()] = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [jump, dash, interact, attack]);

  useEffect(() => {
    if (!running) return;
    let raf = 0;
    let last = performance.now();
    let lastUi = 0;
    const loop = (now: number) => {
      const dt = Math.min(0.035, (now - last) / 1000);
      last = now;
      const p = player.current;
      const sec = (now - startAt.current) / 1000;
      if (now - lastUi > 90) {
        setElapsed(sec);
        lastUi = now;
      }
      if (phase === "intro" && sec > 2.18 && !fireShown.current) {
        fireShown.current = true;
        setBossCasting(true);
        setNotice("守卫举起法杖，开始积蓄火焰魔法……");
        window.setTimeout(() => {
          setFireActive(true);
          setNotice("守卫施法完成：烈焰正在遗迹空间中爆发。");
        }, 1000);
        window.setTimeout(() => setBossCasting(false), 3550);
        window.setTimeout(() => setFireActive(false), 5000);
      }
      if (phase === "intro" && sec > 0.7 && !impactShown.current) {
        impactShown.current = true;
        setImpactActive(true);
        window.setTimeout(() => setImpactActive(false), 1350);
      }
      if (phase === "intro" && sec > 8.0) {
        setPhase("explore");
        setNotice("火焰熄灭。幽灵掠过，视野逐步收窄。向左寻找微弱的宝箱提示。");
      }
      const gp = navigator.getGamepads?.()[0];
      const axis = gp?.axes?.[0] ?? 0;
      const left =
        pressed.current.a || pressed.current.arrowleft || axis < -0.28;
      const right =
        pressed.current.d || pressed.current.arrowright || axis > 0.28;
      const dir = (right ? 1 : 0) - (left ? 1 : 0);
      if (dir) p.facing = dir as 1 | -1;
      const speed = now < p.dashUntil ? 31 : 17;
      const targetVx = dir * speed;
      p.vx += (targetVx - p.vx) * Math.min(1, dt * (dir ? 16 : 12));
      if (!dir) p.vx *= Math.exp(-dt * 7);
      p.x = Math.max(4, Math.min(96, p.x + p.vx * dt));
      if (gp?.buttons?.[0]?.pressed && p.grounded) jump();
      if (gp?.buttons?.[1]?.pressed) dash();
      if (gp?.buttons?.[2]?.pressed) attack();
      if (gp?.buttons?.[3]?.pressed) interact();
      p.vy -= 50 * dt;
      p.y += p.vy * dt;
      if (p.y <= 0) {
        p.y = 0;
        p.vy = 0;
        p.grounded = true;
      }
      const desiredVision =
        phase === "explore" && !chestOpen ? 11 : phase === "combat" ? 18 : 80;
      setVision((v) => v + (desiredVision - v) * Math.min(1, dt * 1.6));
      if (phase === "combat" && now >= nextAttack.current) {
        const step = attackIndex.current++ % 10;
        const isRange = step >= 6;
        bossCastUntil.current = now + (isRange ? 1900 : 650);
        setBossCasting(true);
        window.setTimeout(() => setBossCasting(false), isRange ? 1100 : 550);
        if (isRange) {
          const point = [24, 38, 63, 77][step - 6];
          setRangePoint(point);
          rangeUntil.current = now + 1800;
          setRangeActive(true);
          nextAttack.current = Infinity;
          setNotice(
            "Runic range attack expands evenly. Leave the visible rune area.",
          );
          window.setTimeout(() => {
            const q = player.current;
            if (
              Math.abs(q.x - point) < 20 &&
              performance.now() > q.dashUntil &&
              performance.now() > q.hurtUntil
            ) {
              q.hurtUntil = performance.now() + 850;
              setHp((h) => Math.max(0, h - 1));
              setNotice("Hit inside the runic range.");
            }
          }, 1800);
          window.setTimeout(() => {
            setRangeActive(false);
            nextAttack.current = performance.now() + 750;
          }, 1840);
        } else {
          const pattern = projectilePatterns[step];
          const shot = {
            id: id.current++,
            x: pattern.x,
            y: pattern.y,
            vx: pattern.vx,
            hit: false,
          };
          shotsRef.current = [shot];
          setShots(shotsRef.current);
          setNotice(
            `Fixed straight route: ${pattern.label}. Move, jump, or dash to evade.`,
          );
          nextAttack.current = Infinity;
        }
      }
      const updated = shotsRef.current
        .map((s) => ({ ...s, x: s.x + s.vx * dt }))
        .filter((s) => s.x > -7 && s.x < 107);
      for (const s of updated) {
        const inRenderedBody =
          Math.abs(s.x - p.x) < 3.1 && Math.abs(s.y - (p.y + 1)) < 0.95;
        if (
          !s.hit &&
          inRenderedBody &&
          now > p.dashUntil &&
          now > p.hurtUntil
        ) {
          s.hit = true;
          p.hurtUntil = now + 820;
          setHp((h) => Math.max(0, h - 1));
          setNotice("Projectile hit.");
        }
        if (
          !s.hit &&
          ((s.vx < 0 && s.x < p.x - 3.1) || (s.vx > 0 && s.x > p.x + 3.1))
        ) {
          s.hit = true;
          counterUntil.current = now + 1200;
          setNotice("Evaded. Press J / gamepad X to counterattack.");
        }
      }
      shotsRef.current = updated;
      setShots(updated);
      if (
        phase === "combat" &&
        updated.length === 0 &&
        nextAttack.current === Infinity
      )
        nextAttack.current = now + 750;
      if (hp <= 0) {
        setPhase("defeat");
        setRunning(false);
        setNotice("你被守卫击败。重新开始可再次体验。");
      }
      render();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [running, phase, chestOpen, hp, jump, dash, attack, interact, render]);

  const ghostPhase = phase === "explore" && !chestOpen;
  const now = performance.now();
  const isHurt = now < view.hurtUntil;
  const isDash = now < view.dashUntil;
  const isAttack = now < view.attackUntil;
  const moving = Math.abs(view.vx) > 1.5 && view.grounded;
  return (
    <main className="pixel-app">
      <header>
        <div>
          <p>R2 · PIXEL ACTION PROTOTYPE</p>
          <h1>
            月萤遗迹 <small>Spirit Ruins</small>
          </h1>
        </div>
        <div className="condition">
          触觉 <b>{condition}</b>
          {(["NH", "BH", "STH"] as Condition[]).map((c) => (
            <button key={c} disabled={running} onClick={() => setCondition(c)}>
              {c}
            </button>
          ))}
        </div>
      </header>
      <section className="game-wrap" aria-label="可体验的横版像素动作游戏">
        <style>{`@keyframes rubbleFrames{0%,24%{background-position:0 0}25%,49%{background-position:100% 0}50%,74%{background-position:0 100%}75%,100%{background-position:100% 100%}}@keyframes dangerRuneFrames{0%,45%{background-position:0 100%}46%,100%{background-position:100% 100%}}.danger-ring:after{display:none!important}`}</style>
        <div className={`world ${impactActive ? "impact-shake" : ""}`}>
          <div className="sky" />
          <div className="mountains" />
          <div className="ruins" />
          <div className="rain-layer" />
          <div
            className="ground"
            style={{
              backgroundImage: "url('/assets/ground-platform-v3.png')",
              backgroundSize: "100% 100%",
              backgroundPosition: "center top",
            }}
          />
          <div
            className="fog on"
            style={
              { "--p": `${view.x}%`, "--vision": `${vision}%` } as CSSProperties
            }
          />
          <div className="hud">
            <div className="portrait">◉</div>
            <div className="bars">
              <label>
                HP{" "}
                <i>
                  <em style={{ width: `${hp * 20}%` }} />
                </i>{" "}
                {hp}/5
              </label>
              <label>
                守卫{" "}
                <i className="bossbar">
                  <em style={{ width: `${bossHp}%` }} />
                </i>
              </label>
            </div>
            <div className="timer">
              {Math.floor(elapsed)}s<br />
              <small>
                {phase === "explore"
                  ? "探索"
                  : phase === "combat"
                    ? "战斗"
                    : phase === "victory"
                      ? "胜利"
                      : "序章"}
              </small>
            </div>
          </div>
          {running && (
            <div
              className={`boss ${phase === "intro" ? "landing" : ""} ${bossCasting ? "casting" : ""} ${phase === "victory" ? "down" : ""}`}
              style={{ bottom: "18%" }}
            >
              {bossCasting ? (
                <div
                  className="boss-cast-sprite"
                  role="img"
                  aria-label="黑曜石守卫施法"
                />
              ) : (
                <img src="/assets/boss-pixel.png" alt="黑曜石守卫" />
              )}
              {bossCasting && <i className="cast-orb" />}
            </div>
          )}
          {ghostPhase && (
            <div className="ghosts">
              {[0, 1, 2, 3].map((n) => (
                <img
                  key={n}
                  src="/assets/ghost-pixel.png"
                  alt=""
                  style={{
                    animationDelay: `${n * 0.65}s`,
                    top: `${28 + (n % 2) * 12}%`,
                  }}
                />
              ))}
            </div>
          )}
          {impactActive && (
            <div
              className="impact-rubble"
              style={{
                left: "80%",
                bottom: "20.8%",
                backgroundImage: "url('/assets/rubble-burst-v2.png')",
              }}
              aria-hidden="true"
            />
          )}
          {fireActive && (
            <div className="flame-wall">
              {Array.from({ length: 12 }, (_, i) => (
                <b key={i} style={{ animationDelay: `${i * 0.11}s` }} />
              ))}
            </div>
          )}
          {phase === "explore" && !chestOpen && (
            <>
              <span
                className="chest-hint"
                style={{ left: "17%" }}
                aria-hidden="true"
              />
              <button
                className="chest"
                style={{ left: "17%" }}
                onClick={interact}
                aria-label="开启宝箱"
              >
                <img src="/assets/chest-pixel.png" alt="符文宝箱" />
                <small>靠近后 E / 手柄 Y</small>
              </button>
            </>
          )}
          {rangeActive && (
            <div
              className="danger-ring"
              style={{
                left: `${rangePoint}%`,
                width: 74,
                height: 50,
                border: 0,
                boxShadow: "none",
                backgroundImage: "url('/assets/vfx-atlas.png')",
                backgroundSize: "200% 200%",
                backgroundPosition: "0 100%",
                animation: "ringExpand 1.8s linear forwards",
              }}
              aria-label="即将扩散的范围危险区"
            />
          )}
          {phase === "victory" && (
            <div className="victory-particles">
              ✦　✧　✦
              <br />
              　✧　✦　✧
            </div>
          )}
          {shots.map((s) => (
            <img
              key={s.id}
              className="fireball"
              src="/assets/fireball-pixel.png"
              alt="魔法飞行物"
              style={{
                left: `${s.x}%`,
                bottom: `${17 + s.y * 3.4}%`,
                zIndex: 5,
              }}
            />
          ))}
          <div
            className={`hero-anchor ${isHurt ? "hurt" : ""} ${isDash ? "dash" : ""} ${isAttack ? "attack" : ""}`}
            style={{
              left: `${view.x}%`,
              bottom: `${18 + view.y * 3.4}%`,
              transform: `translate3d(-50%,0,0) scaleX(${view.facing})`,
            }}
          >
            <img
              className={`hero-sprite ${moving ? "run" : "idle"} ${!view.grounded ? "jump" : ""}`}
              src="/assets/hero-pixel.png"
              alt="冒险者主角"
            />
            <span className="slash">✦</span>
          </div>
          <div className="notice">{notice}</div>
        </div>
        <div className="controls">
          <div>
            <b>键盘</b> A/D 或 ←/→ 移动　Space 跳跃　Shift 冲刺　J 攻击　E 交互
          </div>
          <div>
            <b>手柄</b> 左摇杆移动　A 跳跃　B 冲刺　X 攻击　Y 交互
          </div>
        </div>
      </section>
      <section className="actions">
        <button className="start" onClick={start}>
          {running ? "游戏进行中" : "开始游戏"}
        </button>
        <button onClick={jump}>跳跃</button>
        <button onClick={dash}>冲刺</button>
        <button onClick={attack}>攻击</button>
        <button onClick={interact}>交互</button>
        <p>
          飞行物采用更小的实体命中盒与固定直线轨迹；范围攻击仅在施法窗口内出现并扩散。正式实验可由同一事件管理器派发
          NH / BH / STH 触觉命令。
        </p>
      </section>
    </main>
  );
}

export default function Home() {
  return <StudyEntry />;
}
