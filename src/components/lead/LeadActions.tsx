"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, Gauge, Ban } from "lucide-react";
import { ActionButton } from "@/components/ActionButton";
import {
  qualifyLeadAction,
  runWebsiteAnalysisAction,
  changeStageAction,
  overrideActionAction,
  markUnqualifiedAction,
} from "@/lib/actions";
import { PIPELINE_STAGES, NEXT_ACTIONS, type Lead, type PipelineStage, type NextAction } from "@/lib/types";

export function LeadActions({ lead, hasFindings }: { lead: Lead; hasFindings: boolean }) {
  const router = useRouter();
  const [, start] = useTransition();
  const refresh = () => router.refresh();

  return (
    <div className="flex flex-wrap items-center gap-2">
      <ActionButton variant="secondary" onRun={() => qualifyLeadAction(lead.id).then(refresh)}>
        <Gauge size={15} /> {lead.leadScore == null ? "Run qualification" : "Re-qualify"}
      </ActionButton>
      <ActionButton variant="primary" onRun={() => runWebsiteAnalysisAction(lead.id).then(refresh)}>
        <Sparkles size={15} /> {hasFindings ? "Re-run website analysis" : "Run website analysis"}
      </ActionButton>

      <div className="ml-auto flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 text-xs text-chalk-500">
          Stage
          <select
            defaultValue={lead.pipelineStage}
            onChange={(e) => start(() => void changeStageAction(lead.id, e.target.value as PipelineStage).then(refresh))}
            className="input !w-auto !py-1 text-xs"
          >
            {PIPELINE_STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-xs text-chalk-500">
          Action
          <select
            value={lead.recommendedAction ?? ""}
            onChange={(e) => start(() => void overrideActionAction(lead.id, e.target.value as NextAction).then(refresh))}
            className="input !w-auto !py-1 text-xs"
          >
            <option value="" disabled>Set action</option>
            {NEXT_ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
        <ActionButton variant="danger" confirm="Mark this lead unqualified?" onRun={() => markUnqualifiedAction(lead.id).then(refresh)}>
          <Ban size={14} /> Unqualified
        </ActionButton>
      </div>
    </div>
  );
}
