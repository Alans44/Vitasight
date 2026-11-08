import type { ReviewEvent, SmsNotification } from "./contracts.ts";

export function eventText(event: ReviewEvent) {
  const time = new Date(event.createdAt).toLocaleString("en-US", {
    hour12: false,
    timeZoneName: "short",
  });
  return `${event.mode === "demo" ? "SIMULATED | " : ""}Vitasight | ${event.source}\n${event.reason}\n${time} | Event ${event.id.slice(0, 8)}`;
}

export const smsStatusLabel: Record<SmsNotification["status"], string> = {
  pending: "SMS pending",
  sending: "Sending SMS",
  queued: "SMS accepted",
  sent: "SMS sent",
  delivered: "SMS delivered",
  failed: "SMS failed",
  unknown: "SMS status unknown",
  canceled: "SMS canceled",
};
export const smsTemplateLabel = {
  "": "Detailed event text",
  sms_internal_alerts: "Trial: Internal alerts",
  sms_event_notifications: "Trial: Event notifications",
  sms_appointment_reminders: "Trial: Appointment reminders",
};
