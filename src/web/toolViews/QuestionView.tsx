/**
 * `ask_user_question` — questions, options and the recorded answers.
 *
 * Read-only by design: the answers can only come from the terminal dialog, there
 * is no API to submit one, and this batch adds no answering path (see
 * `docs/chat-compaction-todo-askuser-plan.md` §3.1). The questions and options
 * are rendered from the call's own arguments, so the card is already useful
 * before the answers are written to the session.
 *
 * Answers are attached to a question by `questionIndex`, and by the answer's own
 * `question` text when no index was reported. An answer that matches neither is
 * listed separately instead of being attached to a question it may not belong
 * to.
 */

import type { ChatQuestionAnswer } from "../../shared/protocol";
import { parseAskedQuestions, type AskedQuestion } from "./toolText";
import { ViewMeta, ViewNote, type ToolViewProps } from "./common";

export function QuestionView({ item, fallback }: ToolViewProps) {
  const questions = parseAskedQuestions(item.args);
  const recorded = item.display?.question;
  if (!questions && !recorded) return <>{fallback}</>;

  const answers = recorded?.answers ?? [];
  const remaining = new Set(answers);
  const list = (questions ?? []).map((question, index) => {
    const matched = matchAnswers(question, index, answers);
    for (const answer of matched) remaining.delete(answer);
    return { question, matched };
  });

  return (
    <div className="tool-view question-view">
      <ViewMeta>
        <ViewNote>{`${list.length} 个问题`}</ViewNote>
        {recorded?.cancelled && <ViewNote>用户取消了这次询问</ViewNote>}
        {recorded && !recorded.cancelled && answers.length === 0 && (
          <ViewNote>未记录到回答</ViewNote>
        )}
      </ViewMeta>
      {list.map((entry, index) => (
        <QuestionCard key={index} question={entry.question} answers={entry.matched} />
      ))}
      {remaining.size > 0 && (
        <div className="question-item">
          <div className="question-text">其他回答</div>
          <div className="answer-list">
            {Array.from(remaining).map((answer, index) => (
              <AnswerLine key={index} answer={answer} />
            ))}
          </div>
        </div>
      )}
      {recorded?.globalNote && <ViewNote>{recorded.globalNote}</ViewNote>}
    </div>
  );
}

function QuestionCard({
  question,
  answers,
}: {
  question: AskedQuestion;
  answers: ChatQuestionAnswer[];
}) {
  const chosen = chosenLabels(answers);
  return (
    <div className="question-item">
      <div className="question-head">
        {question.header && <span className="question-header">{question.header}</span>}
        {question.multiSelect && <span className="question-multi">可多选</span>}
      </div>
      {question.question && <div className="question-text">{question.question}</div>}
      {question.options.length > 0 && (
        <ul className="question-options">
          {question.options.map((option, index) => (
            <li
              className={`question-option ${chosen.has(option.label) ? "question-option-chosen" : ""}`}
              key={index}
            >
              <span className="question-option-label">{option.label}</span>
              {option.description && (
                <span className="question-option-description">{option.description}</span>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="answer-list">
        {answers.length ? (
          answers.map((answer, index) => <AnswerLine key={index} answer={answer} />)
        ) : (
          <ViewNote>没有回答</ViewNote>
        )}
      </div>
    </div>
  );
}

function AnswerLine({ answer }: { answer: ChatQuestionAnswer }) {
  const label = answerLabel(answer);
  return (
    <div className="answer-line">
      <span className="answer-kind">{label.kind}</span>
      <span className="answer-value">{label.value}</span>
    </div>
  );
}

/**
 * Wording for one answer. `option` / `custom` / `multi` are the kinds the
 * extension reports; an unknown kind is shown with a neutral label so its answer
 * is still readable.
 */
function answerLabel(answer: ChatQuestionAnswer): { kind: string; value: string } {
  if (answer.kind === "custom") {
    return { kind: "自定义回答", value: answer.answer ?? "" };
  }
  if (answer.kind === "multi") {
    const selected = answer.selected?.length
      ? answer.selected.join("、")
      : (answer.answer ?? "");
    return { kind: "多选回答", value: selected };
  }
  if (answer.kind === "option") {
    return { kind: "已选择", value: answer.answer ?? "" };
  }
  return { kind: "回答", value: answer.answer ?? answer.selected?.join("、") ?? "" };
}

/** Labels the answers say were chosen, used to mark the option rows. */
function chosenLabels(answers: ChatQuestionAnswer[]): Set<string> {
  const chosen = new Set<string>();
  for (const answer of answers) {
    if (answer.answer) chosen.add(answer.answer);
    for (const label of answer.selected ?? []) chosen.add(label);
  }
  return chosen;
}

function matchAnswers(
  question: AskedQuestion,
  index: number,
  answers: ChatQuestionAnswer[],
): ChatQuestionAnswer[] {
  const byIndex = answers.filter((answer) => answer.questionIndex === index);
  if (byIndex.length) return byIndex;
  if (!question.question) return [];
  return answers.filter((answer) => answer.question === question.question);
}
