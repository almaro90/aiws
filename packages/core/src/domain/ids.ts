declare const idBrand: unique symbol;

type BrandedId<Name extends string> = string & { readonly [idBrand]: Name };

export type ProjectId = BrandedId<"ProjectId">;
export type TaskId = BrandedId<"TaskId">;
export type QuestionId = BrandedId<"QuestionId">;
export type QuestionOptionId = BrandedId<"QuestionOptionId">;
export type AttachmentId = BrandedId<"AttachmentId">;
export type TaskEventId = BrandedId<"TaskEventId">;
export type ConnectionId = BrandedId<"ConnectionId">;
export type AgentProfileId = BrandedId<"AgentProfileId">;
export type RunId = BrandedId<"RunId">;
export type TaskCycleId = BrandedId<"TaskCycleId">;
export type TaskMessageId = BrandedId<"TaskMessageId">;
export type SpecRevisionId = BrandedId<"SpecRevisionId">;
export type QuestionAnswerId = BrandedId<"QuestionAnswerId">;
export type DeliveryId = BrandedId<"DeliveryId">;
