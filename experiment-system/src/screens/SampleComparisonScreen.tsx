import { useCallback, useEffect, useRef, useState } from "react";
import { useStudy } from "../app/StudyContext";
import { QuestionField } from "../components/Questionnaire";
import { CalibrationDialog } from "../components/CalibrationDialog";
import type { AnswerValue, ComparisonEventRecord, ResponseSet, StudySession } from "../domain/types";
import { useHardwareHostClient } from "../integration/HardwareHostFrame";
import { playComparisonSample, type ComparisonPlaybackHandle } from "../integration/comparisonPlayer";
import {
  CONDITION_EVENT_IDS,
  EVENT_LABELS,
  EVENT_SAMPLES,
  EVENT_SCREENSHOTS,
  resolvedSampleIdFor,
  type ConditionEventId
} from "../protocol/conditions.v1";
import { COMPARISON_QUESTIONS, comparisonQuestionsForEvent, validateResponses } from "../protocol/questions.v1";

type SlotCondition = "sth" | "bh";
type SlotOrder = { a: SlotCondition; b: SlotCondition };
type ActivePlayback = { eventId: string; slot: "a" | "b"; preparing: boolean };

/** 已存条件键记录 → 界面槽位键回答（恢复会话时反填 UI）。 */
function uiValuesFromRecords(records: Record<string, ComparisonEventRecord>): ResponseSet {
  const values: ResponseSet = {};
  for (const eventId of CONDITION_EVENT_IDS) {
    const record = records[eventId];
    if (record === undefined) continue;
    const aId = resolvedSampleIdFor(record.baseSampleId, record.order.a);
    const bId = resolvedSampleIdFor(record.baseSampleId, record.order.b);
    const aRating = record.ratings[aId];
    const bRating = record.ratings[bId];
    if (aRating !== undefined) values[`${eventId}-a-appropriateness`] = aRating;
    if (bRating !== undefined) values[`${eventId}-b-appropriateness`] = bRating;
    if (record.preference !== null && record.preference !== "none") {
      values[`${eventId}-preference`] = record.preference === aId ? "a" : record.preference === bId ? "b" : "none";
    }
    if (record.reason !== undefined) values[`${eventId}-reason`] = record.reason;
  }
  return values;
}

/** 界面槽位键回答 + 盲态映射 → 条件键记录（评分/偏好按解析后样本 ID 存储）。 */
function recordsFromUiValues(
  records: Record<string, ComparisonEventRecord>,
  orders: Record<string, SlotOrder>,
  uiValues: ResponseSet
): Record<string, ComparisonEventRecord> {
  const next: Record<string, ComparisonEventRecord> = {};
  for (const eventId of CONDITION_EVENT_IDS) {
    const baseSampleId = EVENT_SAMPLES[eventId].baseSampleId;
    const order = records[eventId]?.order ?? orders[eventId]!;
    const aId = resolvedSampleIdFor(baseSampleId, order.a);
    const bId = resolvedSampleIdFor(baseSampleId, order.b);
    const aRating = uiValues[`${eventId}-a-appropriateness`];
    const bRating = uiValues[`${eventId}-b-appropriateness`];
    const preference = uiValues[`${eventId}-preference`];
    const reason = uiValues[`${eventId}-reason`];
    next[eventId] = {
      eventId,
      baseSampleId,
      order,
      ratings: {
        ...(typeof aRating === "number" ? { [aId]: aRating } : {}),
        ...(typeof bRating === "number" ? { [bId]: bRating } : {})
      },
      preference:
        typeof preference !== "string" || preference === "" || preference === "none" ? "none" : preference === "a" ? aId : bId,
      ...(typeof reason === "string" && reason !== "" ? { reason } : {})
    };
  }
  return next;
}

/**
 * 盲态事件级样本对比：每个事件一张游戏截图，样本 A/B 各一个播放键——
 * 播放时按条件游戏的同一两阶段门控（PREPARE → 共同起播点）同时起播触觉
 * 与对应音频，播放中按钮变为结束键，样本播完自动复位可再次播放。
 * A/B 随机映射到 STH/BH（每会话每事件固定并持久化）；评分与偏好按真实
 * 条件（解析后样本 ID）存储，与呈现槽位无关。
 */
export function SampleComparisonScreen() {
  const { session, update, advance } = useStudy();
  const hostClient = useHardwareHostClient();
  const [values, setValues] = useState<ResponseSet>(() => (session === null ? {} : uiValuesFromRecords(session.comparisonResponses)));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [attempted, setAttempted] = useState(false);
  const [playing, setPlaying] = useState<ActivePlayback | null>(null);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [armed, setArmed] = useState(false);
  const [showCalibration, setShowCalibration] = useState(false);

  const playbackRef = useRef<ComparisonPlaybackHandle | null>(null);
  const assignedOrdersRef = useRef<Record<string, SlotOrder>>({});
  const audioRef = useRef(new Map<string, HTMLAudioElement>());
  const secondaryTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  /** 每会话每事件稳定的盲态映射：优先已持久化记录，否则随机一次并记入 ref。 */
  const ensureOrders = useCallback((current: StudySession): Record<string, SlotOrder> => {
    const orders: Record<string, SlotOrder> = {};
    for (const eventId of CONDITION_EVENT_IDS) {
      const existing = current.comparisonResponses[eventId]?.order ?? assignedOrdersRef.current[eventId];
      if (existing !== undefined) {
        orders[eventId] = existing;
        continue;
      }
      const order: SlotOrder = Math.random() < 0.5 ? { a: "sth", b: "bh" } : { a: "bh", b: "sth" };
      assignedOrdersRef.current[eventId] = order;
      orders[eventId] = order;
    }
    return orders;
  }, []);

  // 首次进入时持久化事件骨架（含随机盲态映射）；已持久化则保持原样。
  useEffect(() => {
    if (session === null) return;
    const missing = CONDITION_EVENT_IDS.filter(eventId => session.comparisonResponses[eventId] === undefined);
    if (missing.length === 0) return;
    const orders = ensureOrders(session);
    void update(s => {
      const next = { ...s.comparisonResponses };
      for (const eventId of missing) {
        if (next[eventId] !== undefined) continue;
        next[eventId] = {
          eventId,
          baseSampleId: EVENT_SAMPLES[eventId].baseSampleId,
          order: orders[eventId]!,
          ratings: {},
          preference: null
        };
      }
      return { ...s, comparisonResponses: next };
    });
  }, [session, update, ensureOrders]);

  // 硬件 ARM 状态：初始 GET_STATUS + 订阅后续变化。
  useEffect(() => {
    if (hostClient === null) {
      setArmed(false);
      return;
    }
    let alive = true;
    void hostClient.getStatus().then(result => {
      if (alive && result.ok) setArmed(result.value.armed);
    });
    const off = hostClient.onStatusChanged(status => setArmed(status.armed));
    return () => {
      alive = false;
      off();
    };
  }, [hostClient]);

  const audioFor = useCallback((path: string): HTMLAudioElement => {
    let audio = audioRef.current.get(path);
    if (audio === undefined) {
      audio = new Audio(path);
      audio.preload = "auto";
      audioRef.current.set(path, audio);
    }
    return audio;
  }, []);

  const stopAllAudio = useCallback(() => {
    for (const audio of audioRef.current.values()) {
      audio.pause();
      audio.currentTime = 0;
    }
    for (const timer of secondaryTimersRef.current) clearTimeout(timer);
    secondaryTimersRef.current = [];
  }, []);

  // 离开本步骤（含提交推进）时：停止硬件输出与全部音频。
  useEffect(() => {
    return () => {
      playbackRef.current?.stop();
      playbackRef.current = null;
      stopAllAudio();
    };
  }, [stopAllAudio]);

  const playSample = useCallback(
    (eventId: ConditionEventId, slot: "a" | "b") => {
      if (session === null) return;
      if (hostClient === null) {
        setPlaybackError("硬件连接未建立：触觉样本播放必须连接硬件");
        return;
      }
      if (!armed) {
        setPlaybackError("硬件未 ARM：请操作员在「硬件连接」面板连接并 ARM 后再播放");
        return;
      }
      const order = ensureOrders(session)[eventId]!;
      const sample = EVENT_SAMPLES[eventId];
      const resolvedId = resolvedSampleIdFor(sample.baseSampleId, order[slot]);
      setPlaying({ eventId, slot, preparing: true });
      setPlaybackError(null);
      playbackRef.current = playComparisonSample(hostClient, {
        resolvedSampleId: resolvedId,
        onStarted: () => {
          setPlaying(current =>
            current !== null && current.eventId === eventId && current.slot === slot ? { ...current, preparing: false } : current
          );
          const audio = audioFor(sample.audioPath);
          audio.currentTime = 0;
          void audio.play().catch(() => setPlaybackError("音频播放失败"));
          if (sample.secondaryAudio !== undefined) {
            secondaryTimersRef.current.push(
              setTimeout(() => {
                const impact = audioFor(sample.secondaryAudio!.path);
                impact.currentTime = 0;
                void impact.play().catch(() => undefined);
              }, sample.secondaryAudio.offsetMs)
            );
          }
        },
        onFinished: () => {
          setPlaying(null);
          stopAllAudio();
        },
        onError: message => {
          setPlaying(null);
          setPlaybackError(message);
          stopAllAudio();
        }
      });
    },
    [session, hostClient, armed, ensureOrders, audioFor, stopAllAudio]
  );

  const stopSample = useCallback(() => {
    playbackRef.current?.stop();
    playbackRef.current = null;
    setPlaying(null);
    stopAllAudio();
  }, [stopAllAudio]);

  const setValue = (id: string, value: AnswerValue | undefined) => {
    const next = { ...values };
    if (value === undefined) delete next[id];
    else next[id] = value;
    setValues(next);
    if (attempted) setErrors(validateResponses(COMPARISON_QUESTIONS, next).errors);
  };

  const submit = async () => {
    const result = validateResponses(COMPARISON_QUESTIONS, values);
    setAttempted(true);
    setErrors(result.errors);
    if (!result.valid) return;
    playbackRef.current?.stop();
    playbackRef.current = null;
    stopAllAudio();
    await update(s => ({ ...s, comparisonResponses: recordsFromUiValues(s.comparisonResponses, ensureOrders(s), values) }));
    await advance("comparison");
  };

  if (session === null) return null;

  const dryRun = session.studyMode === "dry-run";
  const incompleteCount = Object.keys(errors).length;

  return (
    <form
      className="comparison-form"
      noValidate
      onSubmit={event => {
        event.preventDefault();
        void submit();
      }}
    >
      <p className="screen-intro">
        请对每个事件比较样本 A 与样本 B。点击样本卡上的播放键可反复试听：触觉样本与对应音频同时播放，播放中可随时点结束键停止。
        两个样本以完全相同的卡片呈现，内部条件映射对参与者保持隐藏。
      </p>
      {attempted && incompleteCount > 0 && (
        <p className="field-error" role="alert">
          仍有 {incompleteCount} 项必答题未完成。请完成每个事件的样本 A 评分、样本 B 评分和偏好选择后再继续。
        </p>
      )}
      <button type="button" className="button button-secondary" aria-label="调整当前硬件输出等级" onClick={() => { stopSample(); setShowCalibration(true); }}>调整输出等级</button>
      {dryRun && <p className="playback-hint">干跑模式无硬件输出，播放键不可用，请直接作答。</p>}
      {!dryRun && !armed && (
        <p className="playback-hint">
          硬件未连接或未 ARM：触觉播放暂不可用。请操作员在右侧「硬件连接」面板连接并 ARM 后，参与者才能播放样本。
        </p>
      )}
      {playbackError !== null && (
        <p className="field-error" role="alert">
          {playbackError}
        </p>
      )}
      {showCalibration && <CalibrationDialog onClose={() => setShowCalibration(false)} />}
      {CONDITION_EVENT_IDS.map(eventId => {
        const questions = comparisonQuestionsForEvent(eventId);
        const ratings = questions.filter(question => question.id.endsWith("-a-appropriateness") || question.id.endsWith("-b-appropriateness"));
        const preference = questions.find(question => question.id.endsWith("-preference"));
        const reason = questions.find(question => question.id.endsWith("-reason"));
        const preferenceValue = preference === undefined ? undefined : values[preference.id];
        const showReason = typeof preferenceValue === "string" && preferenceValue !== "" && preferenceValue !== "none";
        const canPlay = !dryRun && armed && playing === null;
        return (
          <section className="comparison-card" data-testid={`comparison-event-${eventId}`} key={eventId}>
            <h3>{EVENT_LABELS[eventId]}</h3>
            <img
              className="comparison-screenshot"
              src={encodeURI(EVENT_SCREENSHOTS[eventId])}
              alt={`${EVENT_LABELS[eventId]} 游戏画面`}
            />
            <div className="sample-pair">
              {(["a", "b"] as const).map(slot => {
                const isPlayingThis = playing !== null && playing.eventId === eventId && playing.slot === slot;
                return (
                  <div className="sample-card" key={slot}>
                    <button
                      type="button"
                      className={`sample-play${isPlayingThis ? " sample-play--active" : ""}`}
                      disabled={!isPlayingThis && !canPlay}
                      onClick={() => (isPlayingThis ? stopSample() : void playSample(eventId, slot))}
                      title={isPlayingThis ? "结束播放" : "播放样本（触觉 + 音频）"}
                      aria-label={isPlayingThis ? `停止播放样本 ${slot.toUpperCase()}` : `播放样本 ${slot.toUpperCase()}`}
                    >
                      {isPlayingThis && playing !== null ? (playing.preparing ? "…" : "■") : "▶"}
                    </button>
                    <p className="sample-title">样本 {slot.toUpperCase()}</p>
                    <p className="sample-note">触觉样本</p>
                  </div>
                );
              })}
            </div>
            {ratings.map(question => (
              <QuestionField
                key={question.id}
                question={question}
                value={values[question.id]}
                onChange={value => setValue(question.id, value)}
                error={errors[question.id]}
              />
            ))}
            {preference !== undefined && (
              <QuestionField
                question={preference}
                value={values[preference.id]}
                onChange={value => {
                  // 单次 state 更新：选择"无偏好"时同时清掉理由（避免两次更新互相覆盖）。
                  const next: ResponseSet = { ...values };
                  if (value === undefined) delete next[preference.id];
                  else next[preference.id] = value;
                  if (value !== "a" && value !== "b" && reason !== undefined) delete next[reason.id];
                  setValues(next);
                  if (attempted) setErrors(validateResponses(COMPARISON_QUESTIONS, next).errors);
                }}
                error={errors[preference.id]}
              />
            )}
            {showReason && reason !== undefined && (
              <QuestionField
                question={reason}
                value={values[reason.id]}
                onChange={value => setValue(reason.id, value)}
                error={errors[reason.id]}
              />
            )}
          </section>
        );
      })}
      <button type="submit" className="button button-primary">
        继续
      </button>
    </form>
  );
}
