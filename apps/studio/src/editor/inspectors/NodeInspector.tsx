/**
 * 고른 노드의 설정 — 노드 종류마다 그 종류의 설정 화면(같은 폴더의 *Inspector.tsx)으로 보낸다.
 *
 * ☆웹페이지 노드의 동작은 M4부터 **레코더가 채운다.** 여기 손 편집은 레코더가 만든 것을 다듬거나,
 *  레코더가 못 잡는 동작(기다리기 등)을 더하는 자리다.
 */
import {
  type ApprovalNode, type CheckNode, type ConditionNode, type CustomNode, type Flow, type FlowNode, type ExtensionNode, type FileWriteNode, type FileReadNode, type FlowCallNode, type HttpNode, type TransformNode, type ProbeFinding, type WebNode, type ZipNode,
} from "@flowsmith/core";
import { FileWriteInspector } from "./FileWriteInspector.tsx";
import { ZipInspector } from "./ZipInspector.tsx";
import { FileReadInspector } from "./FileReadInspector.tsx";
import { FlowCallInspector } from "./FlowCallInspector.tsx";
import { HttpInspector } from "./HttpInspector.tsx";
import { TransformInspector } from "./TransformInspector.tsx";
import { ApprovalInspector } from "./ApprovalInspector.tsx";
import { CheckInspector } from "./CheckInspector.tsx";

import { WebInspector } from "./WebInspector.tsx";
import { ConditionInspector } from "./ConditionInspector.tsx";
import { CustomInspector } from "./CustomInspector.tsx";
import { ExtensionInspector } from "./ExtensionInspector.tsx";

type Update<T> = (fn: (n: T) => T) => void;

/** 노드 서랍의 「설정」 본문 — 이름과 지우기는 서랍 머리에 있다 */
/** sample — 이 노드가 받을 입력(마지막 실행에서) · 미리 보기에 쓴다 */
export function NodeSettings({ flow, node, update, findings = [], onRepick, sample = null, onSplitAt }: { flow: Flow; node: FlowNode; update: Update<FlowNode>; findings?: ProbeFinding[]; onRepick?: (actionId: string) => void; sample?: Record<string, unknown> | null; onSplitAt?: (i: number) => void }) {
  return (
    <div className="stack">
      {node.type === "web" && <WebInspector flow={flow} node={node} update={update as Update<WebNode>} findings={findings} {...(onRepick ? { onRepick } : {})} {...(onSplitAt ? { onSplitAt } : {})} />}
      {node.type === "condition" && <ConditionInspector flow={flow} node={node} update={update as Update<ConditionNode>} />}
      {node.type === "custom" && <CustomInspector node={node} update={update as Update<CustomNode>} />}
      {node.type === "extension" && <ExtensionInspector flow={flow} node={node} update={update as Update<ExtensionNode>} />}
      {node.type === "fileRead" && <FileReadInspector flow={flow} node={node} update={update as Update<FileReadNode>} />}
      {node.type === "flowCall" && <FlowCallInspector flow={flow} node={node} update={update as Update<FlowCallNode>} />}
      {node.type === "transform" && <TransformInspector flow={flow} node={node} update={update as Update<TransformNode>} sample={sample} />}
      {node.type === "http" && <HttpInspector flow={flow} node={node} update={update as Update<HttpNode>} />}
      {node.type === "check" && <CheckInspector flow={flow} node={node} update={update as Update<CheckNode>} />}
      {node.type === "approval" && <ApprovalInspector flow={flow} node={node} update={update as Update<ApprovalNode>} />}
      {node.type === "fileWrite" && <FileWriteInspector flow={flow} node={node} update={update as Update<FileWriteNode>} />}
      {node.type === "zip" && <ZipInspector flow={flow} node={node} update={update as Update<ZipNode>} />}
    </div>
  );
}

