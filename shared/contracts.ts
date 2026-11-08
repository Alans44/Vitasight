import { z } from "zod";

export const modeSchema = z.enum(["live", "demo"]);
export type Mode = z.infer<typeof modeSchema>;
export const patientInput = z.object({
  name: z.string().trim().min(1).max(60),
  context: z.string().trim().max(200),
  priority: z.number().int().min(1).max(5),
  mode: modeSchema,
});
export type Patient = z.infer<typeof patientInput> & {
  id: string;
  assessedAt: number;
};
export const settingsSchema = z.object({
  sustainSeconds: z.number().int().min(3).max(30),
  postureThreshold: z.number().min(0.15).max(0.9),
  overdueMinutes: z.number().int().min(0).max(180),
});
export type Settings = z.infer<typeof settingsSchema>;
export const pointSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  confidence: z.number().min(0).max(1),
});
export const detectionSchema = z.object({
  id: z.string().min(1).max(80),
  box: z.tuple([
    z.number().min(0).max(1),
    z.number().min(0).max(1),
    z.number().min(0).max(1),
    z.number().min(0).max(1),
  ]),
  points: z.array(pointSchema).length(17),
});
export type Detection = z.infer<typeof detectionSchema>;
export const poseResponse = z.object({
  session: z.string(),
  timestamp: z.number(),
  detections: z.array(detectionSchema).max(6),
});
export const frameInput = z.object({
  session: z.string().uuid(),
  timestamp: z.number().finite(),
  jpeg: z
    .string()
    .max(500_000)
    .regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/),
});
export type Track = {
  key: string;
  externalId: string;
  label: string;
  box: Detection["box"];
  points: Detection["points"];
  patientId: string | null;
  lastSeen: number;
  quality: number;
  ambiguous: boolean;
  score: number | null;
  since: number | null;
  episode: boolean;
};
export type Feed = {
  id: string;
  session: string;
  label: string;
  mode: Mode;
  startedAt: number;
  lastFrame: number;
  status: "watching" | "waiting" | "error";
  error: string;
  tracks: Track[];
};
export type ReviewEvent = {
  id: string;
  feedId: string;
  source: string;
  trackKey: string;
  person: string;
  patientId: string | null;
  mode: Mode;
  kind: "posture" | "overdue";
  status: "open" | "acknowledged" | "resolved" | "dismissed";
  assignedTo: string | null;
  reason: string;
  createdAt: number;
  updatedAt: number;
  evidence: { score?: number; threshold?: number; seconds?: number };
};
export type Audit = {
  id: string;
  eventId: string | null;
  at: number;
  actor: string;
  action: string;
  note: string;
};
export const actionSchema = z.object({
  action: z.enum(["acknowledge", "assign", "reassess", "dismiss"]),
  actor: z.string().trim().min(1).max(60),
  note: z.string().trim().max(500).default(""),
});
export const phoneSchema = z
  .string()
  .trim()
  .regex(
    /^\+[1-9]\d{7,14}$/,
    "Use a phone number with country code, such as +15551234567",
  );
export const smsPreferencesSchema = z.object({
  enabled: z.boolean(),
  recipient: phoneSchema.or(z.literal("")),
  includeDemo: z.boolean(),
  trialTemplate: z
    .enum([
      "",
      "sms_internal_alerts",
      "sms_event_notifications",
      "sms_appointment_reminders",
    ])
    .default(""),
});
export const smsConfigurationSchema = smsPreferencesSchema.extend({
  actor: z.string().trim().min(1).max(60),
  accountSid: z
    .string()
    .trim()
    .regex(/^AC[0-9a-fA-F]{32}$/, "Enter a valid Twilio Account SID")
    .optional(),
  authToken: z.string().trim().min(32).max(128).optional(),
  fromNumber: phoneSchema.optional(),
});
export type SmsPreferences = z.infer<typeof smsPreferencesSchema>;
export type SmsNotification = {
  id: string;
  eventId: string | null;
  mode: Mode | "test";
  recipient: string;
  body: string;
  template?: SmsPreferences["trialTemplate"];
  status:
    | "pending"
    | "sending"
    | "queued"
    | "sent"
    | "delivered"
    | "failed"
    | "unknown"
    | "canceled";
  providerId: string | null;
  error: string;
  createdAt: number;
  updatedAt: number;
  nextCheckAt: number | null;
};
export type SmsSnapshot = {
  preferences: SmsPreferences;
  configured: boolean;
  credentialsSaved: boolean;
  fromNumber: string;
  notifications: SmsNotification[];
};
export type Snapshot = {
  feeds: Feed[];
  patients: Patient[];
  events: ReviewEvent[];
  audit: Audit[];
  settings: Settings;
  sms: SmsSnapshot;
  now: number;
};
