import { monotonicFactory } from "ulid";
import type {
  AttachmentId,
  ProjectId,
  QuestionId,
  QuestionOptionId,
  TaskEventId,
  TaskId,
  ConnectionId,
  AgentProfileId,
  RunId,
  TaskCycleId,
  TaskMessageId,
  SpecRevisionId,
  QuestionAnswerId,
  DeliveryId,
} from "../domain/ids.ts";
import { SystemClock, type Clock } from "./clock.ts";

export interface IdGenerator {
  projectId(): ProjectId;
  taskId(): TaskId;
  questionId(): QuestionId;
  optionId(): QuestionOptionId;
  attachmentId(): AttachmentId;
  eventId(): TaskEventId;
  connectionId(): ConnectionId;
  agentProfileId(): AgentProfileId;
  runId(): RunId;
  cycleId(): TaskCycleId;
  messageId(): TaskMessageId;
  specRevisionId(): SpecRevisionId;
  questionAnswerId(): QuestionAnswerId;
  deliveryId(): DeliveryId;
}

export class UlidIdGenerator implements IdGenerator {
  readonly #clock: Clock;
  readonly #nextUlid = monotonicFactory();

  constructor(clock: Clock = new SystemClock()) {
    this.#clock = clock;
  }

  projectId(): ProjectId {
    return this.#generate("prj_") as ProjectId;
  }

  taskId(): TaskId {
    return this.#generate("tsk_") as TaskId;
  }

  questionId(): QuestionId {
    return this.#generate("qst_") as QuestionId;
  }

  optionId(): QuestionOptionId {
    return this.#generate("opt_") as QuestionOptionId;
  }

  attachmentId(): AttachmentId {
    return this.#generate("att_") as AttachmentId;
  }

  eventId(): TaskEventId {
    return this.#generate("evt_") as TaskEventId;
  }

  connectionId(): ConnectionId {
    return this.#generate("con_") as ConnectionId;
  }

  agentProfileId(): AgentProfileId {
    return this.#generate("agp_") as AgentProfileId;
  }

  runId(): RunId {
    return this.#generate("run_") as RunId;
  }

  cycleId(): TaskCycleId {
    return this.#generate("cyc_") as TaskCycleId;
  }
  messageId(): TaskMessageId {
    return this.#generate("msg_") as TaskMessageId;
  }
  specRevisionId(): SpecRevisionId {
    return this.#generate("spc_") as SpecRevisionId;
  }
  questionAnswerId(): QuestionAnswerId {
    return this.#generate("ans_") as QuestionAnswerId;
  }
  deliveryId(): DeliveryId {
    return this.#generate("dlv_") as DeliveryId;
  }

  #generate(prefix: string): string {
    return `${prefix}${this.#nextUlid(this.#clock.now().getTime()).toUpperCase()}`;
  }
}
