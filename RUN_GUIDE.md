# CareLink run guide

## 1. Start CareLink

```bash
cd carelink
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python app.py
```

Open <http://127.0.0.1:5000>.

## 2. Optional: start the hospital network demo

Use a second terminal:

```bash
cd carelink/hospital_network
source ../.venv/bin/activate
export CARELINK_URL=http://127.0.0.1:5000
pip install -r requirements.txt
python app.py
```

Open <http://127.0.0.1:5001> to add visits and reports from City Care, Vision Plus, or Mother & Child Centre. Then use **Fetch records** in CareLink to pull the data into the care story.

## 3. Specialist visit story report

1. Open **Care Passport**.
2. Select a journey.
3. Select **Print specialist brief** to open the one-page print view. Choose **Save to PDF** in the browser print dialog when needed.
4. Select **Download report** to download a portable HTML report with the CareLink journey, visits, linked hospital records, and uploaded report-file links.

## Patient-friendly examination update

Open any **Care Passport** to see **What happened and what to do next**. This is updated from the latest visit/report records and includes simple explanations, next steps, missed or overdue actions, government health information, and official update links. Hospital tabs contain realistic synthetic demo records; they are not real patient records.

### How data moves

The hospital demo app runs on port 5001. When a hospital saves a patient, visit, or report, it immediately posts the change to CareLink on port 5000. CareLink stores the linked record and the browser checks for changes every three seconds. If Fetch records is open, its results silently refresh after a new sync event.

## Analytics and specialist email test

Open the **Analytics** tab for stage adherence, overdue actions, missed follow-up appointments, patient risk cards, and hospital comparisons. To test the specialist notification safely, create an appointment with a `specialist_email`, then run:

```bash
curl -X POST http://127.0.0.1:5000/api/reminders/run \
  -H 'Content-Type: application/json' \
  -d '{"force": true}'
```

In the default demo configuration, the generated specialist summary is stored in `/api/notifications` with `mode: demo`; it is not sent to an external recipient. Configure SMTP variables and restart CareLink to send real email.

Appointments store the exact `booked_at` time. The CareLink worker checks the appointment’s date and time automatically and sends reminders when it is within 24 hours. Use `POST /api/reminders/run` with `{"force": true}` to test immediately; notification details show the booking timestamp and the calculated time window.

## Book from Messages

Adding a new person automatically creates a welcome message thread. In **Messages**, select the patient and send a date-based request such as:

```text
Book appointment on 20-09-2026
```

CareLink creates the appointment and refreshes **Calendar & Book**. To move the same appointment, send:

```text
Reschedule to 25-09-2026
```

The linked appointment date is updated and the calendar is refreshed without creating a duplicate.

For a same-day request, the booking time follows the browser's current local time. CareLink adds a 30-minute buffer and rounds up to the next 30-minute slot: a request at 3:58 PM becomes a 4:30 PM appointment. The browser timezone is sent with the request so users in different timezones receive the correct slot.

If a WhatsApp/webhook caller does not send browser timezone metadata, CareLink defaults to `Asia/Kolkata`. Set `CARELINK_TIMEZONE` before starting the server to use another IANA timezone, for example `set CARELINK_TIMEZONE=Europe/London` on Windows.

The demo runs in email-demo mode unless SMTP variables are added to a `.env` file. See `README.md` for the optional email setup.

## Automatic specialist email

When booking an appointment, fill in **Specialist name** and **Specialist email**. CareLink checks for appointments scheduled today or tomorrow every minute while the server is running, then sends the specialist a pre-visit care-summary email and records it in **Notifications**. Each appointment is processed once. Set `CARELINK_AUTOMATION_INTERVAL=300` before starting the server to check every five minutes instead.

For real delivery, add `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, and `SMTP_TLS=true` to `.env`. Without these settings the app logs the notification in demo mode and does not send external email.

> This is a demo/prototype. Consent-based sync and OTP consent are simulated and should not be treated as production clinical data exchange.
