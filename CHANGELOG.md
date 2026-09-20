# CHANGELOG — CareLink demo updates

## Round 1 (prior)

### 1. Consent gate
- UI modal: patient consent + fake 4-digit OTP before fetch results.
- Comment on `/api/fetch-patient` (ABDM HIE-CM simulation).

### 2. Visible access log
- In-memory log + `GET /api/access-log`.
- Dashboard **Recent Access** panel.

### 3. Honest labeling
- Consent-based sync wording; Guided FAQ / Quick Reply Assistant; SMS framing for demo notifications.

### 4. Hygiene
- `127.0.0.1` + `debug=False`; removed unused `re`; `.gitignore`; `hospital_network/requirements.txt`; relative-path README.

---

## Round 2 (this release)

### A. Tab notifications (in-app + browser tab)
- Badge counts on **Dashboard**, **Messages**, **Calendar**, **Verify Desk** tabs.
- Yellow **notify strip** under the tab bar when stuck referrals or notifications exist.
- **Browser tab title** updates to `(N) Stuck · CareLink…` so the user is nudged even if the window is in the background.

### B. Stuck / drop-off signal
- Dashboard banner: **stuck referrals** (overdue, blocked, or pending ≥7 days).
- Metric tile **stuck referrals**.
- Seed data already includes overdue (Ramesh) and blocked (Arjun) journeys for a clear pitch story.

### C. Consent receipt
- After OTP grant: fixed receipt bar with simulated Consent ID, purpose, 24h validity.
- Purpose line also shown on the consent modal.

### D. Guided demo path
- Dashboard **Demo path (90 sec)** card with sample names and **Jump to Fetch · Meera Patel** button.
