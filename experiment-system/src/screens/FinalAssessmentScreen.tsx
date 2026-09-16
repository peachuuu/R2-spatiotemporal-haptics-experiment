import { useCallback, useEffect, useRef, useState } from "react";
import { useStudy } from "../app/StudyContext";
import { Questionnaire } from "../components/Questionnaire";
import { CalibrationDialog } from "../components/CalibrationDialog";
import { conditionAt, conditionMarker } from "../domain/session";
import type { ConditionId, ResponseSet } from "../domain/types";
import { useHardwareHostClient } from "../integration/HardwareHostFrame";
import { playComparisonSample, type ComparisonPlaybackHandle } from "../integration/comparisonPlayer";
import { EVENT_SAMPLES, resolvedSampleIdFor } from "../protocol/conditions.v1";
import { finalQuestions } from "../protocol/questions.v1";

type ActivePlayback = { display: "A" | "B"; preparing: boolean };

/** 最终评估：回放两种条件对应的真实 G08 雨声触觉样本，再完成总体评价。 */
export function FinalAssessmentScreen() {
  const { session, update, advance } = useStudy();
  const hostClient = useHardwareHostClient();
  const [armed, setArmed] = useState(false);
  const [playing, setPlaying] = useState<ActivePlayback | null>(null);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [showCalibration, setShowCalibration] = useState(false);
  const playbackRef = useRef<ComparisonPlaybackHandle | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

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

  const stopPlayback = useCallback(() => {
    playbackRef.current?.stop();
    playbackRef.current = null;
    if (audioRef.current !== null) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    setPlaying(null);
  }, []);

  /** 自然播完：设备已自动回到 ARMED_IDLE，只清本地状态，不 STOP、保持 ARM。 */
  const finishPlayback = useCallback(() => {
    playbackRef.current = null;
    if (audioRef.current !== null) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    setPlaying(null);
  }, []);

  useEffect(() => () => stopPlayback(), [stopPlayback]);

  const playRain = useCallback((display: "A" | "B", conditionId: ConditionId) => {
    if (session === null) return;
    if (hostClient === null) {
      setPlaybackError("硬件连接未建立：触觉样本播放必须连接硬件");
      return;
    }
    if (!armed) {
      setPlaybackError("硬件未 ARM：请操作员在「硬件连接」面板连接并 ARM 后再播放");
      return;
    }
    const rain = EVENT_SAMPLES["event-08"];
    const variant = conditionId === "spatiotemporal" ? "sth" : "bh";
    setPlaybackError(null);
    setPlaying({ display, preparing: true });
    playbackRef.current = playComparisonSample(hostClient, {
      resolvedSampleId: resolvedSampleIdFor(rain.baseSampleId, variant),
      onStarted: () => {
        setPlaying(current => current !== null && current.display === display ? { ...current, preparing: false } : current);
        if (audioRef.current === null) audioRef.current = new Audio(rain.audioPath);
        audioRef.current.currentTime = 0;
        void audioRef.current.play().catch(() => setPlaybackError("雨声音频播放失败"));
      },
      onFinished: () => finishPlayback(),
      onError: message => {
        setPlaybackError(message);
        stopPlayback();
      }
    });
  }, [armed, hostClient, session, stopPlayback, finishPlayback]);

  if (session === null) return null;

  const dryRun = session.studyMode === "dry-run";
  const rainConditions = ([0, 1] as const).map(index => {
    const conditionId = conditionAt(session, index);
    return { display: index === 0 ? "A" as const : "B" as const, conditionId, marker: conditionMarker(conditionId) };
  });

  const submit = async (values: ResponseSet) => {
    await update(s => ({ ...s, finalResponses: values }));
    await advance("final");
  };

  return (
    <div>
      <h3>最终评估</h3>
      <p className="screen-intro">请结合刚才两个条件的整体游戏体验回答以下问题。</p>
      <p className="screen-intro">可再次播放两种条件的雨声触觉样本；触觉与雨声在同一共同起播点开始。</p>
      <button type="button" className="button button-secondary" aria-label="调整当前硬件输出等级" onClick={() => { stopPlayback(); setShowCalibration(true); }}>调整输出等级</button>
      {dryRun && <p className="playback-hint">干跑模式无硬件输出，播放键不可用，请直接作答。</p>}
      {!dryRun && !armed && <p className="playback-hint">硬件未连接或未 ARM：请在右侧「硬件连接」面板连接并 ARM 后播放。</p>}
      {playbackError !== null && <p className="field-error" role="alert">{playbackError}</p>}
      <div className="sample-pair">
        {rainConditions.map(({ display, conditionId, marker }) => {
          const isPlaying = playing?.display === display;
          const canPlay = !dryRun && armed && playing === null;
          const state = isPlaying ? (playing?.preparing ? "准备中…" : "播放中：雨声 + 触觉") : "可播放：雨声 + 触觉";
          return <div className="sample-card" key={display}>
            <button
              type="button"
              className={`sample-play${isPlaying ? " sample-play--active" : ""}`}
              disabled={!isPlaying && !canPlay}
              onClick={() => isPlaying ? stopPlayback() : playRain(display, conditionId)}
              title={isPlaying ? "结束播放" : "播放下雨触觉与音频"}
              aria-label={isPlaying ? `停止播放条件 ${display} 的下雨触觉与音频` : `播放条件 ${display} 的下雨触觉与音频`}
            >
              {isPlaying ? (playing?.preparing ? "…" : "■") : "▶"}
            </button>
            <p className="sample-title">触觉条件 {display} {marker}</p>
            <p className="sample-note">{state}</p>
          </div>;
        })}
      </div>
      <Questionnaire questions={finalQuestions()} initialValues={session.finalResponses} onValidSubmit={values => void submit(values)} />
      {showCalibration && <CalibrationDialog onClose={() => setShowCalibration(false)} />}
    </div>
  );
}
