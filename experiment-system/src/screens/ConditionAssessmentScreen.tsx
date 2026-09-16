import { useEffect, useState } from "react";
import { useStudy } from "../app/StudyContext";
import { Questionnaire } from "../components/Questionnaire";
import { conditionAt } from "../domain/session";
import type { ResponseSet } from "../domain/types";
import type { Question } from "../protocol/questions.v1";
import {
  CONDITION_QUESTIONNAIRE_INTRO,
  ELECTRO_QUESTIONS,
  HXI_QUESTIONS_BY_ID,
  PXI_QUESTIONS_BY_ID,
  shuffledHxiOrder,
  shuffledPxiOrder
} from "../protocol/questions.v1";

export function ConditionAssessmentScreen({ conditionIndex }: { conditionIndex: 0 | 1 }) {
  const { session, update, advance } = useStudy();

  // HXI 20 题随机呈现顺序：每条件首次进入时生成一次并持久化到会话，
  // 保存退出后恢复仍用同一顺序；两道电刺激题固定按原顺序跟在完整量表之后。
  const [hxiOrder] = useState<string[]>(() => {
    if (session === null) return [];
    const conditionId = conditionAt(session, conditionIndex);
    return session.questionOrders?.[conditionId] ?? shuffledHxiOrder();
  });

  // PXI 节选 6 题随机呈现顺序（同维度题项不相邻），持久化规则同 HXI。
  const [pxiOrder] = useState<string[]>(() => {
    if (session === null) return [];
    const conditionId = conditionAt(session, conditionIndex);
    return session.pxiQuestionOrders?.[conditionId] ?? shuffledPxiOrder();
  });

  useEffect(() => {
    if (session === null) return;
    const conditionId = conditionAt(session, conditionIndex);
    const hxiMissing = session.questionOrders?.[conditionId] === undefined;
    const pxiMissing = session.pxiQuestionOrders?.[conditionId] === undefined;
    if (!hxiMissing && !pxiMissing) return;
    void update(s => ({
      ...s,
      ...(hxiMissing ? { questionOrders: { ...s.questionOrders, [conditionId]: hxiOrder } } : {}),
      ...(pxiMissing ? { pxiQuestionOrders: { ...s.pxiQuestionOrders, [conditionId]: pxiOrder } } : {})
    }));
    // 仅在首次进入该条件问卷时落盘一次。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (session === null) return null;

  const conditionId = conditionAt(session, conditionIndex);
  const stepId = conditionIndex === 0 ? "assessment-1" : "assessment-2";

  // 呈现顺序：HXI 打乱 20 题 → PXI 打乱 6 题 → 电刺激舒适度/疼痛两题。
  const questions: readonly Question[] = [
    ...hxiOrder.map(id => HXI_QUESTIONS_BY_ID[id]).filter((q): q is Question => q !== undefined),
    ...pxiOrder.map(id => PXI_QUESTIONS_BY_ID[id]).filter((q): q is Question => q !== undefined),
    ...ELECTRO_QUESTIONS
  ];

  const submit = async (values: ResponseSet) => {
    await update(s => ({
      ...s,
      conditionResponses: { ...s.conditionResponses, [conditionId]: values }
    }));
    await advance(stepId);
  };

  return (
    <div>
      <h3>条件后问卷</h3>
      <p className="screen-intro">{CONDITION_QUESTIONNAIRE_INTRO}</p>
      <Questionnaire
        questions={questions}
        initialValues={session.conditionResponses[conditionId] ?? {}}
        onValidSubmit={values => void submit(values)}
      />
    </div>
  );
}
