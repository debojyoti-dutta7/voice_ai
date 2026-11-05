// Recruitment screening tool handlers. Each writes straight into the call record,
// so a call that drops mid-questionnaire keeps everything answered up to that point.
import * as store from "./store.js";

const ok = (extra = {}) => ({ recorded: true, ...extra });

export const handlers = {
  record_answer({ field, value, spoken, status }, ctx) {
    if (!ctx?.callId) return ok();
    store.recordAnswer(ctx.callId, { field, value, spoken, status });
    // Salary and the home minimum must be read back before they count as final.
    const needsConfirmation = field === "current_salary" || field === "home_min_salary";
    return ok({
      field,
      next: needsConfirmation && status === "answered"
        ? "Read the amount back to the candidate and ask them to confirm before moving on."
        : undefined,
    });
  },

  record_experience({ category, item, years, months, status, spoken }, ctx) {
    if (!ctx?.callId) return ok();
    store.recordExperience(ctx.callId, { category, item, years, months, status, spoken });
    return ok({ item });
  },

  record_operator(args, ctx) {
    if (!ctx?.callId) return ok();
    store.recordOperator(ctx.callId, args);
    return ok({
      operator: args.operator,
      next: "Ask whether there is another operator, until they confirm there are none.",
    });
  },

  record_preferred_location(args, ctx) {
    if (!ctx?.callId) return ok();
    store.recordLocation(ctx.callId, args);
    return ok({
      location: args.location,
      next: args.min_salary_inr == null
        ? "Ask the minimum monthly take-home they would need for this location."
        : undefined,
    });
  },

  schedule_callback({ when }, ctx) {
    if (ctx?.callId) {
      store.updateCall(ctx.callId, { callbackAt: when, outcome: "callback" });
    }
    if (ctx?.leadId) store.updateLead(ctx.leadId, { status: "pending", callbackAt: when });
    console.log("[callback]", when);
    return ok({ when, next: "Thank them and end the call." });
  },

  set_call_outcome({ outcome, interest, reason }, ctx) {
    if (ctx?.callId) {
      store.updateCall(ctx.callId, {
        outcome,
        interest: interest || null,
        reason: reason || null,
      });
    }
    if (ctx?.leadId && outcome && outcome !== "callback") {
      store.updateLead(ctx.leadId, { status: "done" });
    }
    return ok({ outcome });
  },

  remove_from_list({ reason }, ctx) {
    if (ctx?.callId) {
      store.updateCall(ctx.callId, { outcome: "dnc", reason: reason || "requested" });
    }
    if (ctx?.leadId) store.updateLead(ctx.leadId, { status: "dnc" });
    console.log("[opt-out]", reason);
    return ok({ next: "Confirm removal, apologise briefly, end the call. Ask nothing further." });
  },
};

export function runTool(name, argsJson, ctx) {
  const fn = handlers[name];
  if (!fn) return { error: `Unknown function: ${name}` };
  let args = {};
  try {
    args = argsJson ? JSON.parse(argsJson) : {};
  } catch {
    return { error: "Could not parse arguments." };
  }
  try {
    const result = fn(args, ctx);
    if (ctx?.callId) store.appendToolCall(ctx.callId, name, args, result);
    return result;
  } catch (err) {
    return { error: String(err && err.message ? err.message : err) };
  }
}
