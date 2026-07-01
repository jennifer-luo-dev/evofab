"use client";

import { createContext, useContext, useReducer, ReactNode } from "react";
import type { PipelineStepId } from "@/app/types/job";

interface JobState {
  currentJobId: string | null;
  pipelineStep: PipelineStepId | null;
  jobActive: boolean;
  resultCount: number;
}

type JobAction =
  | { type: "START_JOB"; jobId: string }
  | { type: "SET_STEP"; step: PipelineStepId | null }
  | { type: "COMPLETE_JOB" }
  | { type: "ABORT_JOB" }
  | { type: "SET_RESULT_COUNT"; count: number }
  | { type: "INCREMENT_RESULTS" };

const initialState: JobState = {
  currentJobId: null,
  pipelineStep: null,
  jobActive: false,
  resultCount: 0,
};

function reducer(state: JobState, action: JobAction): JobState {
  switch (action.type) {
    case "START_JOB":
      return {
        ...state,
        currentJobId: action.jobId,
        pipelineStep: "upload",
        jobActive: true,
      };
    case "SET_STEP":
      return { ...state, pipelineStep: action.step };
    case "COMPLETE_JOB":
      return { ...state, jobActive: false, resultCount: state.resultCount + 1 };
    case "ABORT_JOB":
      return { ...state, jobActive: false, pipelineStep: null };
    case "SET_RESULT_COUNT":
      return { ...state, resultCount: action.count };
    case "INCREMENT_RESULTS":
      return { ...state, resultCount: state.resultCount + 1 };
    default:
      return state;
  }
}

interface JobContextValue extends JobState {
  dispatch: React.Dispatch<JobAction>;
}

const JobContext = createContext<JobContextValue | null>(null);

export function JobProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  return (
    <JobContext.Provider value={{ ...state, dispatch }}>
      {children}
    </JobContext.Provider>
  );
}

export function useJob(): JobContextValue {
  const ctx = useContext(JobContext);
  if (!ctx) throw new Error("useJob must be used inside JobProvider");
  return ctx;
}
