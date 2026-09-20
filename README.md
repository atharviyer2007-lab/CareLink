# CareLink + Live Hospital Sync

## Real-time flow

1. Add patient / visit / report on a hospital site (port 5001)
2. Hospital **pushes** to CareLink `/api/sync/ingest`
3. CareLink UI **polls every 3s** and refreshes when data changes

## Run (2 terminals)

### Terminal 1 — Hospitals

```bat
cd /d "C:\Users\Admin\Desktop\New folder (6)\hospital_network"
set CARELINK_URL=http://127.0.0.1:5000
py -m pip install flask flask-cors
py app.py
```

### Terminal 2 — CareLink

```bat
cd /d "C:\Users\Admin\Desktop\New folder (6)"
venv\Scripts\activate
py -m pip install -r requirements.txt
py app.py
```

Keep **both** running. Open CareLink, then add a report on City Care — within ~3 seconds CareLink should toast **Live sync: hospital data updated**.

## Test

1. CareLink open on Dashboard
2. City Care → Add visit + report for **Sanya Gupta**
3. Watch CareLink toast + new person/records appear
