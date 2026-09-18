/**
 * `todo` — what this one call changed.
 *
 * The card deliberately does not repeat the composer's status bar: `details`
 * carries the complete task list, and showing it here again would be a second,
 * redundant copy of the same state. It shows only the action and the fields that
 * describe this call (`details.params`, with the call's own arguments as the
 * fallback), or the raw Arguments/Result detail when there is nothing to report.
 */

import { TODO_ACTIONS } from "../toolCatalog";
import { todoChange, todoStatusLabel, type TodoChange } from "./toolText";
import { ViewMeta, ViewNote, type ToolViewProps } from "./common";

export function TodoView({ item, fallback }: ToolViewProps) {
  const change = todoChange(item.display?.todo, item.args);
  const rows = changeRows(change);
  if (!change.action && !rows.length) return <>{fallback}</>;

  const action = todoActionWord(change.action);

  return (
    <div className="tool-view todo-view">
      <ViewMeta>
        <ViewNote>{action ?? "本次调用"}</ViewNote>
      </ViewMeta>
      {rows.length ? (
        <div className="change-list">
          {rows.map((row) => (
            <div className="change-row" key={row.key}>
              <span className="change-key">{row.key}</span>
              <span className="change-value">{row.value}</span>
            </div>
          ))}
        </div>
      ) : (
        <ViewNote>这次调用没有带参数</ViewNote>
      )}
    </div>
  );
}

/**
 * Action word for the card header.
 *
 * The lookup is own-property only: `action` can come from `details.action`, and
 * a value like `constructor` would otherwise return an inherited member (a
 * function) that React refuses to render as a child. An unknown action is shown
 * verbatim — the raw word is still a fact about the call.
 */
function todoActionWord(action: string | undefined): string | undefined {
  if (!action) return undefined;
  return Object.hasOwn(TODO_ACTIONS, action) ? TODO_ACTIONS[action] : action;
}

function changeRows(change: TodoChange): Array<{ key: string; value: string }> {
  const rows: Array<{ key: string; value: string }> = [];
  if (change.taskId !== undefined) {
    rows.push({ key: "任务", value: `#${change.taskId}` });
  }
  if (change.subject !== undefined) {
    rows.push({ key: "标题", value: change.subject });
  }
  if (change.status !== undefined) {
    rows.push({
      key: "状态",
      value:
        change.activeForm === undefined
          ? todoStatusLabel(change.status)
          : `${todoStatusLabel(change.status)}（${change.activeForm}）`,
    });
  } else if (change.activeForm !== undefined) {
    rows.push({ key: "进行时", value: change.activeForm });
  }
  if (change.description !== undefined) {
    rows.push({ key: "说明", value: change.description });
  }
  if (change.blockedBy?.length) {
    rows.push({
      key: "依赖",
      value: change.blockedBy.map((id) => `#${id}`).join("、"),
    });
  }
  return rows;
}
