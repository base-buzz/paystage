export type {
  AcceptOption,
  PaymentRequest,
  Decision,
  AcceptStatus,
  AcceptResult,
  EvaluateResult,
} from "./evaluate.js";

/** @deprecated alias */
export type PaymentRequired = import("./evaluate.js").PaymentRequest;
export type PaymentAccept = import("./evaluate.js").AcceptOption;
export type EvaluationResult = import("./evaluate.js").EvaluateResult;
export type EvaluationDecision = import("./evaluate.js").Decision;
export type AcceptEvaluation = import("./evaluate.js").AcceptResult;
