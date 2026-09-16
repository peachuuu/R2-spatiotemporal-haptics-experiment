import { useState } from "react";
import type { AnswerValue, ResponseSet } from "../domain/types";
import { validateResponses } from "../protocol/questions.v1";
import type { Question } from "../protocol/questions.v1";

export { validateResponses };

type FieldProps = {
  question: Question;
  value: AnswerValue | undefined;
  onChange: (value: AnswerValue | undefined) => void;
  error?: string;
};

/** Renders a single configured question with its native, accessible input. */
export function QuestionField({ question, value, onChange, error }: FieldProps) {
  const describedBy = error !== undefined ? `${question.id}-error` : undefined;

  switch (question.response.kind) {
    case "likert": {
      const { min, max, anchors } = question.response;
      const options = Array.from({ length: max - min + 1 }, (_, index) => min + index);
      return (
        <fieldset className={error !== undefined ? "field-group field-group-error" : "field-group"}>
          <legend className={question.required ? "required-marker" : undefined}>{question.prompt}</legend>
          <div className="radio-grid">
            {options.map(option => (
              <label key={option} className="radio-cell">
                <input
                  type="radio"
                  name={question.id}
                  value={option}
                  checked={value === option}
                  onChange={() => onChange(option)}
                  aria-describedby={describedBy}
                />
                <span className="radio-value">{option}</span>
                {anchors[option] !== undefined && <span className="radio-anchor">{anchors[option]}</span>}
              </label>
            ))}
          </div>
          {error !== undefined && (
            <p className="field-error" id={`${question.id}-error`}>
              {error}
            </p>
          )}
        </fieldset>
      );
    }
    case "choice":
      return (
        <fieldset className={error !== undefined ? "field-group field-group-error" : "field-group"}>
          <legend className={question.required ? "required-marker" : undefined}>{question.prompt}</legend>
          {question.response.options.map(option => (
            <label key={option.value} className="radio-row">
              <input
                type="radio"
                name={question.id}
                value={option.value}
                checked={value === option.value}
                onChange={() => onChange(option.value)}
                aria-describedby={describedBy}
              />
              {option.label}
            </label>
          ))}
          {error !== undefined && (
            <p className="field-error" id={`${question.id}-error`}>
              {error}
            </p>
          )}
        </fieldset>
      );
    case "text": {
      const text = typeof value === "string" ? value : "";
      return (
        <label className="field">
          <span className={question.required ? "field-label required-marker" : "field-label"}>{question.prompt}</span>
          <textarea
            id={question.id}
            rows={3}
            maxLength={question.response.maxLength}
            value={text}
            onChange={event => onChange(event.target.value)}
            aria-describedby={describedBy}
          />
          <span className="char-counter">
            {text.length} / {question.response.maxLength}
          </span>
          {error !== undefined && (
            <span className="field-error" id={`${question.id}-error`}>
              {error}
            </span>
          )}
        </label>
      );
    }
    case "boolean":
      return (
        <label className="check-row">
          <input type="checkbox" checked={value === true} onChange={event => onChange(event.target.checked)} />
          {question.prompt}
          {error !== undefined && (
            <span className="field-error" id={`${question.id}-error`}>
              {error}
            </span>
          )}
        </label>
      );
  }
}

type Props = {
  questions: readonly Question[];
  initialValues: ResponseSet;
  onValidSubmit: (values: ResponseSet) => void;
  submitLabel?: string;
};

/** 配置驱动的表单；任何必答题存在错误时阻止提交。 */
export function Questionnaire({ questions, initialValues, onValidSubmit, submitLabel = "继续" }: Props) {
  const [values, setValues] = useState<ResponseSet>({ ...initialValues });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitAttempted, setSubmitAttempted] = useState(false);

  const setValue = (id: string, value: AnswerValue | undefined) => {
    const next = { ...values };
    if (value === undefined) delete next[id];
    else next[id] = value;
    setValues(next);
    if (submitAttempted) setErrors(validateResponses(questions, next).errors);
  };

  const submit = () => {
    const result = validateResponses(questions, values);
    setSubmitAttempted(true);
    setErrors(result.errors);
    if (result.valid) onValidSubmit(values);
  };

  return (
    <form
      className="questionnaire"
      noValidate
      onSubmit={event => {
        event.preventDefault();
        submit();
      }}
    >
      {questions.map(question => (
        <QuestionField
          key={question.id}
          question={question}
          value={values[question.id]}
          onChange={value => setValue(question.id, value)}
          error={errors[question.id]}
        />
      ))}
      <button type="submit" className="button button-primary">
        {submitLabel}
      </button>
    </form>
  );
}
