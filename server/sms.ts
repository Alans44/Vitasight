import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import {
  phoneSchema,
  smsConfigurationSchema,
  type SmsNotification,
  type SmsSnapshot,
} from "../shared/contracts.ts";
import { Store } from "./store.ts";

const credentialsSchema = z.object({
  accountSid: z.string().regex(/^AC[0-9a-fA-F]{32}$/),
  authToken: z.string().min(32).max(128),
  fromNumber: phoneSchema,
});
type Credentials = z.infer<typeof credentialsSchema>;
export type SmsOptions = {
  credentialsPath?: string;
  credentials?: Partial<Credentials>;
  fetcher?: typeof fetch;
  now?: () => number;
};
const providerMessageSchema = z.object({
  sid: z.string().regex(/^SM[0-9a-fA-F]{32}$/),
  status: z.string(),
  error_code: z.number().nullable().optional(),
});

function providerStatus(status: string): SmsNotification["status"] {
  if (["accepted", "queued", "sending", "scheduled"].includes(status))
    return "queued";
  if (status === "sent") return "sent";
  if (status === "delivered") return "delivered";
  if (["failed", "undelivered"].includes(status)) return "failed";
  if (status === "canceled") return "canceled";
  return "unknown";
}

export class SmsService {
  private credentials: Partial<Credentials>;
  private fetcher: typeof fetch;
  private now: () => number;
  private running: Promise<void> | null = null;
  constructor(
    private store: Store,
    private options: SmsOptions = {},
  ) {
    let saved = {};
    if (options.credentialsPath) {
      try {
        saved = credentialsSchema
          .partial()
          .parse(JSON.parse(readFileSync(options.credentialsPath, "utf8")));
      } catch {}
    }
    this.credentials = options.credentials ?? {
      accountSid: process.env.TWILIO_ACCOUNT_SID,
      authToken: process.env.TWILIO_AUTH_TOKEN,
      fromNumber: process.env.TWILIO_FROM_NUMBER,
      ...saved,
    };
    this.fetcher = options.fetcher || fetch;
    this.now = options.now || Date.now;
    for (const message of store.smsWithStatus("sending")) {
      if (message.status === "sending")
        store.updateSms({
          ...message,
          status: "unknown",
          error:
            "Sending was interrupted. Check the provider log before resending.",
          updatedAt: this.now(),
        });
    }
  }
  snapshot(): SmsSnapshot {
    return {
      preferences: this.store.smsPreferences(),
      configured: credentialsSchema.safeParse(this.credentials).success,
      credentialsSaved:
        !!this.credentials.accountSid && !!this.credentials.authToken,
      fromNumber: this.credentials.fromNumber || "",
      notifications: this.store.smsNotifications(),
    };
  }
  configure(input: z.infer<typeof smsConfigurationSchema>) {
    const next = { ...this.credentials };
    if (input.accountSid) {
      if (
        next.accountSid &&
        next.accountSid !== input.accountSid &&
        !input.authToken
      )
        throw Error("Enter the auth token for the new Twilio account.");
      next.accountSid = input.accountSid;
    }
    if (input.authToken) next.authToken = input.authToken;
    if (input.fromNumber) next.fromNumber = input.fromNumber;
    if (
      input.enabled &&
      (!input.recipient || !credentialsSchema.safeParse(next).success)
    )
      throw Error(
        "Add the recipient, Twilio Account SID, auth token, and sender number before enabling text alerts.",
      );
    if (
      this.options.credentialsPath &&
      (input.accountSid || input.authToken || input.fromNumber)
    ) {
      mkdirSync(dirname(this.options.credentialsPath), { recursive: true });
      const temporary = this.options.credentialsPath + ".tmp";
      writeFileSync(temporary, JSON.stringify(next), { mode: 0o600 });
      renameSync(temporary, this.options.credentialsPath);
    }
    this.credentials = next;
    this.store.configureSms(
      {
        enabled: input.enabled,
        recipient: input.recipient,
        includeDemo: input.includeDemo,
        trialTemplate: input.trialTemplate,
      },
      input.actor,
    );
    return this.snapshot();
  }
  test() {
    const snapshot = this.snapshot();
    if (!snapshot.configured || !snapshot.preferences.recipient)
      throw Error("Save a sender and recipient before sending a test text.");
    if (
      snapshot.notifications.some(
        (message) =>
          message.mode === "test" && this.now() - message.createdAt < 30_000,
      )
    )
      throw Error("Wait 30 seconds before sending another test text.");
    return this.store.queueSms(
      null,
      "test",
      snapshot.preferences.recipient,
      "Vitasight test: text alerts are connected. New waiting-room events will include what happened, the source, and the time.",
      this.now(),
      snapshot.preferences.trialTemplate,
    );
  }
  tick(): Promise<void> {
    if (this.running) return this.running;
    this.running = this.process().finally(() => {
      this.running = null;
    });
    return this.running;
  }
  private async process() {
    for (let i = 0; i < 4; i++) {
      const message = this.store.claimSms(this.now());
      if (!message) break;
      if (this.now() - message.createdAt > 300_000) {
        this.store.updateSms({
          ...message,
          status: "canceled",
          error: "This alert expired before sending.",
          updatedAt: this.now(),
        });
        continue;
      }
      await this.send(message);
    }
    const due = this.store.dueSms(this.now());
    for (const message of due) await this.check(message);
  }
  private auth(credentials: Credentials) {
    return {
      Authorization: `Basic ${Buffer.from(`${credentials.accountSid}:${credentials.authToken}`).toString("base64")}`,
    };
  }
  private async send(message: SmsNotification) {
    const result = credentialsSchema.safeParse(this.credentials);
    if (!result.success) {
      this.store.updateSms({
        ...message,
        status: "failed",
        error: "SMS sender is not configured.",
        updatedAt: this.now(),
      });
      return;
    }
    const credentials = result.data;
    try {
      const response = await this.fetcher(
        `https://api.twilio.com/2010-04-01/Accounts/${credentials.accountSid}/Messages.json`,
        {
          method: "POST",
          headers: {
            ...this.auth(credentials),
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            To: message.recipient,
            From: credentials.fromNumber,
            Body: message.template || message.body,
          }),
          signal: AbortSignal.timeout(8000),
        },
      );
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        const code =
          typeof body?.code === "number" ? ` (code ${body.code})` : "";
        this.store.updateSms({
          ...message,
          status: response.status >= 500 ? "unknown" : "failed",
          error:
            body?.code === 572006
              ? "This Twilio trial only accepts predefined templates. Choose a trial format in Text alerts."
              : `Twilio rejected or could not confirm the text${code}. Check the sender settings and provider log.`,
          updatedAt: this.now(),
        });
        return;
      }
      const parsed = providerMessageSchema.safeParse(body);
      if (!parsed.success) throw Error();
      this.store.updateSms(this.fromProvider(message, parsed.data));
    } catch {
      this.store.updateSms({
        ...message,
        status: "unknown",
        error:
          "The SMS request could not be confirmed. Check the provider log before resending.",
        updatedAt: this.now(),
        nextCheckAt: null,
      });
    }
  }
  private fromProvider(
    message: SmsNotification,
    body: z.infer<typeof providerMessageSchema>,
  ): SmsNotification {
    const status = providerStatus(body.status);
    return {
      ...message,
      providerId: body.sid,
      status,
      error: body.error_code ? `Twilio reported error ${body.error_code}.` : "",
      updatedAt: this.now(),
      nextCheckAt: ["queued", "sent", "unknown"].includes(status)
        ? this.now() + 10_000
        : null,
    };
  }
  private async check(message: SmsNotification) {
    const result = credentialsSchema.safeParse(this.credentials);
    if (!result.success) return;
    if (this.now() - message.createdAt > 3_600_000) {
      this.store.updateSms({
        ...message,
        nextCheckAt: null,
        error: "No further delivery confirmation is available.",
        updatedAt: this.now(),
      });
      return;
    }
    try {
      const response = await this.fetcher(
        `https://api.twilio.com/2010-04-01/Accounts/${result.data.accountSid}/Messages/${message.providerId}.json`,
        {
          headers: this.auth(result.data),
          signal: AbortSignal.timeout(5000),
        },
      );
      if (!response.ok) throw Error();
      const body = providerMessageSchema.parse(await response.json());
      if (body.sid !== message.providerId) throw Error();
      this.store.updateSms(this.fromProvider(message, body));
    } catch {
      this.store.updateSms({
        ...message,
        nextCheckAt: this.now() + 30_000,
        error: "Delivery confirmation is temporarily unavailable.",
        updatedAt: this.now(),
      });
    }
  }
}
