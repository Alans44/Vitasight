# Waiting-room log and text alerts

New sustained posture events and reassessment reminders are saved with their source, person, time, and a plain-language description. Open **Configuration → Text alerts** and enter:

- The receiving mobile number, including country code.
- A Twilio Account SID and auth token.
- An SMS-capable Twilio sender number.

Save the settings and use **Send test text** to check the connection. Enable **Send automatic text alerts** for future events. Simulated events have a separate opt-in switch and are identified in the text.

Each event queues one SMS in SQLite, independently of capture and inference. Acknowledging an event or reloading a page does not send it again. The interface distinguishes locally pending, provider-accepted, sent, delivered, failed, and unknown messages. Delivery is checked through Twilio's API because the application runs on localhost; no public webhook is required.

Ambiguous network failures are not blindly retried. Pending event texts are canceled when their recipient or enabled state changes, and unsent alerts expire after five minutes. Enabling notifications does not resend old events.

SMS credentials are saved only in ignored `data/sms-credentials.json`; the auth token is never returned by the API or included in exports. You can alternatively set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_FROM_NUMBER` in your shell or an ignored `.env.local`. Monitoring and pulse analysis use no API keys, and the application remains usable with text alerts disabled.

An active Twilio sender and a reachable recipient are required for real SMS. Trial accounts may require verified recipients. See [Twilio's Messages API](https://www.twilio.com/docs/messaging/api/message-resource).
