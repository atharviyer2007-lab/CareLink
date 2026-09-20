# CareLink — Care Passport + Consent-based hospital sync (demo)

Prototype for PHC-to-specialist referral completion tracking (India), positioned on top of ABDM / eSanjeevani-style infrastructure. **Simulated for demo/pitch — not production.**

## Consent-based sync (ABDM-style, simulated for demo)

1. Open one of the three hospital tabs on port 5001. Each tab includes realistic **synthetic demo records** for patients, visits, and reports; no real patient data is bundled.
2. Add a patient, examination, or report on a hospital site. The hospital immediately **pushes** the change to CareLink `/api/sync/ingest`.
3. CareLink UI **polls every 3 seconds**, refreshes the dashboard/passport, and silently refreshes an open Fetch results view when data changes.
4. Fetch-records flow requires a **UI consent gate** (fake OTP) before showing results; it queries all three hospital APIs and persists linked records into the CareLink passport.

## Run (2 terminals)

### Terminal 1 — Hospitals

```bash
cd hospital_network
export CARELINK_URL=http://127.0.0.1:5000   # Linux/macOS
# set CARELINK_URL=http://127.0.0.1:5000    # Windows cmd
pip install -r requirements.txt
python app.py
```

### Terminal 2 — CareLink

```bash
cd ..   # project root (if you were in hospital_network)
pip install -r requirements.txt
python app.py
```

Keep **both** running. Open CareLink at http://127.0.0.1:5000, then add a report on City Care — within ~3 seconds CareLink should toast **Consent-based sync: hospital data updated**.

## Specialist visit story report

Open **Care Passport**, choose a patient journey, then use **Print specialist brief** for a one-page handoff that can be printed or saved as PDF from the browser. Use **Download report** to save a portable HTML report that includes the journey stages, appointments, linked hospital records, and uploaded report-file links. The report is generated locally from the currently loaded, consented CareLink data and is suitable for sharing with CareLink or a linked hospital team.

## Analytics dashboard

Open the **Analytics** tab to see overall stage adherence, overdue actions, missed follow-up appointments, patients needing attention, and a hospital-by-hospital comparison. The data is calculated from the current CareLink journeys and appointments; the JSON endpoint is `/api/analytics`. Missed follow-ups include appointments marked missed/no-show/overdue and scheduled follow-ups whose date has passed.

## Messages and Calendar sync

When a new patient is added with a journey, CareLink creates a welcome message in that patient’s thread and returns the new journey ID so the UI can open the thread immediately. Patients can book from Messages by writing, for example, `Book appointment on 20-09-2026`. CareLink creates a scheduled appointment, returns the booking in the message response, refreshes the calendar dots and appointment list, and sends the patient a demo-mode confirmation. A message such as `Reschedule to 25-09-2026` updates the existing linked appointment instead of creating a duplicate.

## Testing specialist email notifications

The automated specialist summary can be tested safely in demo mode with an appointment that includes `specialist_email`, then by calling `POST /api/reminders/run` with `{"force": true}`. The response and `/api/notifications` record the generated summary, recipient, and email mode. Without SMTP variables, no external email is sent; the message is stored as a demo notification. With SMTP configured, the same flow sends the message through the configured SMTP server.

Appointments now store both `created_at` and `booked_at` timestamps. The background reminder worker checks the exact appointment date and time and automatically sends patient and specialist reminders when the appointment is due within the next 24 hours. A manual `force` run remains available for testing. Reminder notification details include the booking timestamp and seconds remaining until the appointment.

For same-day bookings made in Messages, CareLink uses the browser's live local time and chooses the next 30-minute slot after a 30-minute buffer. For example, a request made at 3:58 PM in `Asia/Kolkata` for the current date is booked at 4:30 PM. Future-date requests use the default 10:00 AM slot unless the user reschedules.

For webhook or WhatsApp-style callers that do not send browser time metadata, the fallback timezone is `Asia/Kolkata`. Change it with `CARELINK_TIMEZONE=Europe/London` or another valid IANA timezone before starting the server.

## Patient-friendly examination update

Every Care Passport now includes **What happened and what to do next**. It turns linked examination records into simple-language sections: what was added, next steps, missed or overdue actions, government health information, and official update links. The API is available at `/api/patient-report/<journey_id>`. This is an explanatory summary, not a diagnosis; eligibility, schemes, news, and clinical decisions must be confirmed with official sources and qualified clinicians.

## Automated specialist notification

When booking an appointment, enter the specialist's name and email under **Pre-visit specialist brief**. While the CareLink server is running, its built-in automation checks every minute by default and sends the patient reminder plus the care-summary handoff to the specialist for appointments scheduled today or tomorrow. Each notification is sent once per appointment and is recorded in **Notifications**. Set `CARELINK_AUTOMATION_INTERVAL=300` to check every five minutes, if preferred.

Real email delivery requires SMTP settings in `.env` next to `app.py`:

```dotenv
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=yourname@gmail.com
SMTP_PASSWORD=your_16_char_app_password
SMTP_FROM=yourname@gmail.com
SMTP_TLS=true
```

Without SMTP settings, CareLink stays in safe demo mode and logs the intended messages instead of sending them.

## Test

1. CareLink open on Dashboard
2. City Care → Add visit + report for **Sanya Gupta**
3. Watch CareLink toast + new person/records appear
4. **Fetch records** tab → search a name → complete consent OTP (any 4 digits, e.g. `1234`) → see aggregated view
5. Dashboard **Recent Access** panel shows who viewed what
6. Care Passport → **Print specialist brief** opens the print-ready one-page summary
7. Care Passport → **Download report** downloads an HTML report; open it and confirm the sections and file links

## Notes

- Notifications in demo mode are framed as **SMS/WhatsApp** in the console/UI (underlying path can still use SMTP if configured).
- Access log and consent are client/UI-level simulations for the pitch; production would use ABDM HIE-CM consent manager.
