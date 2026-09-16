import { useStudy } from "../app/StudyContext";
import { Questionnaire } from "../components/Questionnaire";
import type { ResponseSet } from "../domain/types";
import { interviewQuestions } from "../protocol/questions.v1";

/** 试验后访谈：五道开放题，全部选填。 */
export function InterviewScreen() {
  const { session, update, advance } = useStudy();
  if (session === null) return null;

  const submit = async (values: ResponseSet) => {
    await update(s => ({ ...s, interviewResponses: values }));
    await advance("interview");
  };

  return (
    <div>
      <h3>试验后访谈</h3>
      <p className="screen-intro">请简要回答以下问题（选填）。</p>
      <Questionnaire questions={interviewQuestions()} initialValues={session.interviewResponses} onValidSubmit={values => void submit(values)} />
    </div>
  );
}
