import { useState } from "react";
import type { FormEvent } from "react";
import { useStudy } from "../app/StudyContext";
import { GENDER_OPTIONS, HAPTIC_EXPERIENCE_OPTIONS } from "../domain/types";
import type { StudyMode } from "../domain/types";

type FieldErrors = Partial<Record<"code" | "nickname" | "age" | "profile", string>>;

export function BasicInfoScreen() {
  const { session, start, update, advance } = useStudy();
  const [code, setCode] = useState(session?.participantCode === "DRAFT" ? "" : (session?.participantCode ?? ""));
  const [nickname, setNickname] = useState(session?.participantProfile.nickname ?? "");
  const [age, setAge] = useState(session?.participantProfile.age ? String(session.participantProfile.age) : "");
  const [gender, setGender] = useState<string | undefined>(session?.participantProfile.gender || undefined);
  const [hapticExperience, setHapticExperience] = useState<string | undefined>(session?.participantProfile.hapticExperience || undefined);
  const [mode, setMode] = useState<StudyMode>(session?.studyMode ?? "dry-run");
  const [errors, setErrors] = useState<FieldErrors>({});

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const nextErrors: FieldErrors = {};
    if (code.trim() === "") nextErrors.code = "请填写参与者编号。";
    if (nickname.trim() === "") nextErrors.nickname = "请填写昵称。";
    const ageNumber = Number(age);
    if (age.trim() === "" || !Number.isFinite(ageNumber) || ageNumber < 1 || ageNumber > 120) {
      nextErrors.age = "请填写有效年龄（1–120 的数字）。";
    }
    if (gender === undefined || hapticExperience === undefined) {
      nextErrors.profile = "请选择性别与电触觉/可穿戴触觉经验。";
    }
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }
    const input = {
      participantCode: code.trim(),
      studyMode: mode,
      profile: { nickname: nickname.trim(), age: ageNumber, gender: gender!, hapticExperience: hapticExperience! }
    };
    if (session === null || session.participantCode === "DRAFT") {
      // New or draft sessions consume exactly one balanced allocation.
      await start(input);
    } else {
      // Revisiting an allocated session keeps its stored assignment untouched.
      await update(current => ({ ...current, ...input, participantProfile: input.profile }));
    }
    await advance("basic-info");
  };

  return (
    <form className="screen-form" noValidate onSubmit={event => void submit(event)}>
      <p className="screen-intro">
        请输入参与者的基础信息（不含任何直接身份信息）并选择研究模式。条件顺序由系统随机分配，操作员无需也不得手动选择。
      </p>
      <label className="field">
        <span className="field-label">参与者编号</span>
        <input
          type="text"
          value={code}
          onChange={event => setCode(event.target.value)}
          autoComplete="off"
          spellCheck={false}
          aria-describedby={errors.code !== undefined ? "code-error" : undefined}
        />
        <span className="field-hint">不透明编号，任意字符均可，无长度限制。</span>
        {errors.code !== undefined && (
          <span className="field-error" id="code-error">
            {errors.code}
          </span>
        )}
      </label>
      <label className="field">
        <span className="field-label">昵称</span>
        <input
          type="text"
          value={nickname}
          onChange={event => setNickname(event.target.value)}
          autoComplete="off"
          aria-describedby={errors.nickname !== undefined ? "nickname-error" : undefined}
        />
        <span className="field-hint">不透明别名，任意字符均可，无长度限制。</span>
        {errors.nickname !== undefined && (
          <span className="field-error" id="nickname-error">
            {errors.nickname}
          </span>
        )}
      </label>
      <label className="field">
        <span className="field-label">参与者年龄</span>
        <input
          type="number"
          min={1}
          max={120}
          value={age}
          onChange={event => setAge(event.target.value)}
          inputMode="numeric"
          aria-describedby={errors.age !== undefined ? "age-error" : undefined}
        />
        <span className="field-hint">只能输入数字（1–120）。</span>
        {errors.age !== undefined && (
          <span className="field-error" id="age-error">
            {errors.age}
          </span>
        )}
      </label>
      <fieldset className="field-group">
        <legend>性别</legend>
        {GENDER_OPTIONS.map(option => (
          <label key={option.value} className="radio-row">
            <input
              type="radio"
              name="gender"
              value={option.value}
              checked={gender === option.value}
              onChange={() => setGender(option.value)}
            />
            {option.label}
          </label>
        ))}
      </fieldset>
      <fieldset className="field-group">
        <legend>电触觉/可穿戴触觉经验</legend>
        {HAPTIC_EXPERIENCE_OPTIONS.map(option => (
          <label key={option.value} className="radio-row">
            <input
              type="radio"
              name="haptic-experience"
              value={option.value}
              checked={hapticExperience === option.value}
              onChange={() => setHapticExperience(option.value)}
            />
            {option.label}
          </label>
        ))}
        {errors.profile !== undefined && <p className="field-error">{errors.profile}</p>}
      </fieldset>
      <fieldset className="field-group">
        <legend>研究模式</legend>
        <label className="radio-row">
          <input type="radio" name="mode" value="dry-run" checked={mode === "dry-run"} onChange={() => setMode("dry-run")} />
          干跑（仅模拟）
        </label>
        <label className="radio-row">
          <input
            type="radio"
            name="mode"
            value="production"
            checked={mode === "production"}
            onChange={() => setMode("production")}
          />
          生产
        </label>
      </fieldset>
      <button type="submit" className="button button-primary">
        继续
      </button>
    </form>
  );
}
