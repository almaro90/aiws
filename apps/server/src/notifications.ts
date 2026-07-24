import type { Database } from "bun:sqlite";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { HttpError } from "./http/errors.ts";

export interface NotificationSettings {
  readonly enabled: boolean;
  readonly baseUrl: string;
  readonly topic: string;
  readonly accessTokenConfigured: boolean;
  readonly updatedAt: string;
}

export interface NotificationSettingsPatch {
  readonly enabled?: boolean;
  readonly baseUrl?: string;
  readonly topic?: string;
  readonly accessToken?: string | null;
}

interface SettingsRow {
  readonly enabled: number;
  readonly base_url: string;
  readonly topic: string;
  readonly token_ciphertext: Uint8Array | null;
  readonly token_iv: Uint8Array | null;
  readonly token_auth_tag: Uint8Array | null;
  readonly generation: number;
  readonly updated_at: string;
}

interface OutboxRow {
  readonly event_id: string;
  readonly generation: number;
  readonly project_id: string;
  readonly project_name: string;
  readonly task_id: string;
  readonly task_title: string;
  readonly from_status: string;
  readonly to_status: string;
  readonly attempt_count: number;
}

interface EncryptedToken {
  readonly ciphertext: Buffer;
  readonly iv: Buffer;
  readonly authTag: Buffer;
}

export class NotificationSettingsService {
  constructor(
    private readonly database: Database,
    private readonly encryptionKey: Buffer | undefined,
    private readonly publisher: NtfyPublisher,
    private readonly coordinate: <T>(work: () => Promise<T> | T) => Promise<T> = async (work) =>
      work(),
  ) {
    const row = this.settingsRow();
    if (row.token_ciphertext !== null) {
      if (encryptionKey === undefined) {
        throw new Error(
          "AIWS_NOTIFICATION_ENCRYPTION_KEY is required because an encrypted notification token is configured.",
        );
      }
      decryptToken(row, encryptionKey);
    }
  }

  get(): NotificationSettings {
    return publicSettings(this.settingsRow());
  }

  async update(patch: NotificationSettingsPatch, now = new Date()): Promise<NotificationSettings> {
    if (Object.keys(patch).length === 0) {
      throw validationError("changes", "At least one field is required.");
    }
    const current = this.settingsRow();
    const baseUrl = patch.baseUrl ?? current.base_url;
    const topic = patch.topic ?? current.topic;
    const enabled = patch.enabled ?? current.enabled === 1;
    validateEndpoint(baseUrl, topic, enabled);

    let encrypted: EncryptedToken | null | undefined;
    if (patch.accessToken !== undefined) {
      if (patch.accessToken === null) {
        encrypted = null;
      } else {
        if (this.encryptionKey === undefined) {
          throw validationError(
            "accessToken",
            "AIWS_NOTIFICATION_ENCRYPTION_KEY is required to store an access token.",
          );
        }
        if (new URL(baseUrl).protocol !== "https:") {
          throw validationError("accessToken", "Access tokens require an HTTPS base URL.");
        }
        encrypted = encryptToken(patch.accessToken, this.encryptionKey);
      }
    } else if (current.token_ciphertext !== null && new URL(baseUrl).protocol !== "https:") {
      throw validationError("baseUrl", "An access token cannot be sent over HTTP.");
    }

    const materialChange =
      enabled !== (current.enabled === 1) ||
      baseUrl !== current.base_url ||
      topic !== current.topic ||
      patch.accessToken !== undefined;
    const generation = materialChange ? current.generation + 1 : current.generation;
    const updatedAt = now.toISOString();
    const transaction = this.database.transaction(() => {
      if (materialChange) this.database.query("DELETE FROM notification_outbox").run();
      this.database
        .query(
          `UPDATE notification_settings
           SET enabled = ?, base_url = ?, topic = ?,
               token_ciphertext = ?, token_iv = ?, token_auth_tag = ?,
               generation = ?, updated_at = ?
           WHERE singleton_id = 1`,
        )
        .run(
          enabled ? 1 : 0,
          baseUrl,
          topic,
          encrypted === undefined
            ? current.token_ciphertext
            : encrypted === null
              ? null
              : encrypted.ciphertext,
          encrypted === undefined ? current.token_iv : encrypted === null ? null : encrypted.iv,
          encrypted === undefined
            ? current.token_auth_tag
            : encrypted === null
              ? null
              : encrypted.authTag,
          generation,
          updatedAt,
        );
    });
    await this.coordinate(() => transaction());
    return this.get();
  }

  async test(): Promise<void> {
    const row = this.settingsRow();
    validateEndpoint(row.base_url, row.topic, true);
    const token = this.token(row);
    await this.publisher.publish({
      baseUrl: row.base_url,
      topic: row.topic,
      token,
      title: "AIWS · Notificaciones",
      message: "La conexión con ntfy funciona correctamente.",
      sequenceId: `test-${crypto.randomUUID()}`,
    });
  }

  credentials(): {
    readonly enabled: boolean;
    readonly baseUrl: string;
    readonly topic: string;
    readonly token: string | null;
    readonly generation: number;
  } {
    const row = this.settingsRow();
    return {
      enabled: row.enabled === 1,
      baseUrl: row.base_url,
      topic: row.topic,
      token: this.token(row),
      generation: row.generation,
    };
  }

  private token(row: SettingsRow): string | null {
    if (row.token_ciphertext === null) return null;
    if (this.encryptionKey === undefined) {
      throw new Error("Notification encryption key is unavailable.");
    }
    return decryptToken(row, this.encryptionKey);
  }

  private settingsRow(): SettingsRow {
    const row = this.database
      .query<SettingsRow, []>("SELECT * FROM notification_settings WHERE singleton_id = 1")
      .get();
    if (row === null) throw new Error("Notification settings are missing.");
    return row;
  }
}

export interface NtfyPublishInput {
  readonly baseUrl: string;
  readonly topic: string;
  readonly token: string | null;
  readonly title: string;
  readonly message: string;
  readonly click?: string;
  readonly sequenceId: string;
}

export class NtfyPublisher {
  constructor(private readonly fetcher: typeof fetch = fetch) {}

  async publish(input: NtfyPublishInput): Promise<void> {
    let response: Response;
    try {
      response = await this.fetcher(input.baseUrl, {
        method: "POST",
        redirect: "manual",
        signal: AbortSignal.timeout(10_000),
        headers: {
          "Content-Type": "application/json",
          ...(input.token === null ? {} : { Authorization: `Bearer ${input.token}` }),
        },
        body: JSON.stringify({
          topic: input.topic,
          title: input.title,
          message: input.message,
          ...(input.click === undefined ? {} : { click: input.click }),
          priority: 3,
          sequence_id: input.sequenceId,
        }),
      });
    } catch (error) {
      throw new Error(sanitizeDeliveryError(error));
    }
    if (!response.ok) throw new Error(`ntfy returned HTTP ${response.status}.`);
  }
}

export class NotificationDispatcher {
  private timer: ReturnType<typeof setInterval> | undefined;
  private running: Promise<void> | null = null;
  private stopped = false;

  constructor(
    private readonly database: Database,
    private readonly settings: NotificationSettingsService,
    private readonly publisher: NtfyPublisher,
    private readonly publicUrl: string,
    private readonly now: () => Date = () => new Date(),
    private readonly coordinate: <T>(work: () => Promise<T> | T) => Promise<T> = async (work) =>
      work(),
  ) {}

  start(): void {
    if (this.timer !== undefined || this.stopped) return;
    void this.poll();
    this.timer = setInterval(() => void this.poll(), 5_000);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
    await this.running;
  }

  async poll(): Promise<void> {
    if (this.stopped || this.running !== null) return this.running ?? Promise.resolve();
    const work = this.dispatchDue();
    this.running = work;
    try {
      await work;
    } finally {
      if (this.running === work) this.running = null;
    }
  }

  private async dispatchDue(): Promise<void> {
    const rows = await this.coordinate(() =>
      this.database
        .query<OutboxRow, [string]>(
          `SELECT event_id, generation, project_id, project_name, task_id, task_title,
                  from_status, to_status, attempt_count
           FROM notification_outbox
           WHERE next_attempt_at <= ?
           ORDER BY next_attempt_at ASC, event_id ASC
           LIMIT 20`,
        )
        .all(this.now().toISOString()),
    );
    for (let offset = 0; offset < rows.length; offset += 4) {
      await Promise.all(rows.slice(offset, offset + 4).map((row) => this.deliver(row)));
    }
  }

  private async deliver(row: OutboxRow): Promise<void> {
    const credentials = this.settings.credentials();
    if (!credentials.enabled || credentials.generation !== row.generation) {
      await this.remove(row);
      return;
    }
    try {
      await this.publisher.publish({
        baseUrl: credentials.baseUrl,
        topic: credentials.topic,
        token: credentials.token,
        title: `AIWS · ${row.project_name}`,
        message: `${row.task_title}\n${row.from_status} → ${row.to_status}\nTask: ${row.task_id}\nProject: ${row.project_id}`,
        click: `${this.publicUrl}/tasks/${row.task_id}`,
        sequenceId: row.event_id,
      });
      await this.remove(row);
    } catch (error) {
      const attempt = row.attempt_count + 1;
      const delaySeconds = Math.min(3_600, 5 * 2 ** Math.min(20, attempt - 1));
      const nextAttemptAt = new Date(this.now().getTime() + delaySeconds * 1_000).toISOString();
      await this.coordinate(() =>
        this.database
          .query(
            `UPDATE notification_outbox
             SET attempt_count = ?, next_attempt_at = ?, last_error = ?
             WHERE event_id = ? AND generation = ?`,
          )
          .run(
            attempt,
            nextAttemptAt,
            sanitizeDeliveryError(error).slice(0, 500),
            row.event_id,
            row.generation,
          ),
      );
    }
  }

  private async remove(row: Pick<OutboxRow, "event_id" | "generation">): Promise<void> {
    await this.coordinate(() =>
      this.database
        .query("DELETE FROM notification_outbox WHERE event_id = ? AND generation = ?")
        .run(row.event_id, row.generation),
    );
  }
}

export function parseNotificationEncryptionKey(value: string | undefined): Buffer | undefined {
  if (value === undefined) return undefined;
  const key = Buffer.from(value, "base64");
  if (
    key.byteLength !== 32 ||
    key.toString("base64").replace(/=+$/u, "") !== value.replace(/=+$/u, "")
  ) {
    throw new Error("AIWS_NOTIFICATION_ENCRYPTION_KEY must be Base64 encoding exactly 32 bytes.");
  }
  return key;
}

function encryptToken(token: string, key: Buffer): EncryptedToken {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return { ciphertext, iv, authTag: cipher.getAuthTag() };
}

function decryptToken(row: SettingsRow, key: Buffer): string {
  if (row.token_ciphertext === null || row.token_iv === null || row.token_auth_tag === null) {
    throw new Error("Encrypted notification token is incomplete.");
  }
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(row.token_iv));
    decipher.setAuthTag(Buffer.from(row.token_auth_tag));
    return Buffer.concat([
      decipher.update(Buffer.from(row.token_ciphertext)),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new Error("AIWS_NOTIFICATION_ENCRYPTION_KEY cannot decrypt the configured token.");
  }
}

function publicSettings(row: SettingsRow): NotificationSettings {
  return {
    enabled: row.enabled === 1,
    baseUrl: row.base_url,
    topic: row.topic,
    accessTokenConfigured: row.token_ciphertext !== null,
    updatedAt: row.updated_at,
  };
}

function validateEndpoint(baseUrl: string, topic: string, enabled: boolean): void {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw validationError("baseUrl", "Must be an absolute HTTP or HTTPS URL.");
  }
  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.search !== "" ||
    parsed.hash !== ""
  ) {
    throw validationError(
      "baseUrl",
      "Must use HTTP or HTTPS without credentials, query parameters or fragment.",
    );
  }
  if (enabled && !/^[-_A-Za-z0-9]{1,64}$/u.test(topic)) {
    throw validationError("topic", "Must contain 1–64 letters, numbers, hyphens or underscores.");
  }
}

function validationError(path: string, message: string): HttpError {
  return new HttpError(422, "validation_error", "Input validation failed.", {
    fields: [{ path, message }],
  });
}

function sanitizeDeliveryError(error: unknown): string {
  if (error instanceof DOMException && error.name === "TimeoutError")
    return "ntfy request timed out.";
  if (error instanceof Error && /^ntfy returned HTTP \d{3}\.$/u.test(error.message)) {
    return error.message;
  }
  return "ntfy request failed.";
}
