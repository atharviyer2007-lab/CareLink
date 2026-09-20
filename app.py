"""
Fake hospital network — 3 hospital websites with live add patient/reports.
Data saved to data.json so CareLink fetch sees new records.
Run: py app.py  →  http://localhost:5001
"""

import json
import uuid
from datetime import datetime, timedelta
from pathlib import Path

from flask import Flask, render_template, jsonify, request, redirect, url_for
from flask_cors import CORS
import os
import urllib.request


app = Flask(__name__)
CORS(app)

DATA_FILE = Path(__file__).parent / "data.json"
NOW = datetime.utcnow()


def default_data():
    return {
        "city-care": {
            "id": "city-care",
            "name": "City Care Hospital",
            "city": "Mumbai",
            "type": "Multi-specialty",
            "phone": "+91 22 4000 1000",
            "color": "#0d9488",
            "tagline": "Complete care under one roof",
            "patients": [
                {
                    "id": "cc-p1",
                    "name": "Meera Patel",
                    "email": "meera@example.com",
                    "dob": "1984-03-12",
                    "visits": [
                        {
                            "id": "v1",
                            "date": (NOW - timedelta(days=12)).strftime("%Y-%m-%d"),
                            "department": "Cardiology",
                            "doctor": "Dr. Rao",
                            "reason": "Chest pain evaluation",
                            "status": "completed",
                        },
                        {
                            "id": "v2",
                            "date": (NOW - timedelta(days=5)).strftime("%Y-%m-%d"),
                            "department": "Cardiology",
                            "doctor": "Dr. Rao",
                            "reason": "TMT scheduling",
                            "status": "scheduled",
                        },
                    ],
                    "reports": [
                        {
                            "id": "cc-r1",
                            "title": "ECG Baseline",
                            "type": "Investigation",
                            "date": (NOW - timedelta(days=12)).strftime("%Y-%m-%d"),
                            "summary": "Sinus rhythm. No acute ischemic changes.",
                        },
                        {
                            "id": "cc-r2",
                            "title": "Lipid Profile",
                            "type": "Lab report",
                            "date": (NOW - timedelta(days=11)).strftime("%Y-%m-%d"),
                            "summary": "LDL mildly elevated. Lifestyle advice given.",
                        },
                    ],
                },
                {
                    "id": "cc-p2",
                    "name": "Arjun Desai",
                    "email": "arjun@example.com",
                    "dob": "1991-07-22",
                    "visits": [
                        {
                            "id": "v3",
                            "date": (NOW - timedelta(days=8)).strftime("%Y-%m-%d"),
                            "department": "Pulmonology",
                            "doctor": "Dr. Khan",
                            "reason": "Breathlessness",
                            "status": "completed",
                        }
                    ],
                    "reports": [
                        {
                            "id": "cc-r3",
                            "title": "Chest X-Ray",
                            "type": "Imaging",
                            "date": (NOW - timedelta(days=8)).strftime("%Y-%m-%d"),
                            "summary": "No consolidation. Spirometry advised.",
                        }
                    ],
                },
            ],
        },
        "vision-plus": {
            "id": "vision-plus",
            "name": "Vision Plus Clinic",
            "city": "Mumbai",
            "type": "Eye care",
            "phone": "+91 22 4000 2000",
            "color": "#2563eb",
            "tagline": "Clear sight, better life",
            "patients": [
                {
                    "id": "vp-p1",
                    "name": "Ramesh Kumar",
                    "email": "ramesh@example.com",
                    "dob": "1968-01-05",
                    "visits": [
                        {
                            "id": "v4",
                            "date": (NOW - timedelta(days=45)).strftime("%Y-%m-%d"),
                            "department": "Retina",
                            "doctor": "Dr. Shah",
                            "reason": "Diabetic eye check",
                            "status": "completed",
                        },
                        {
                            "id": "v5",
                            "date": (NOW - timedelta(days=14)).strftime("%Y-%m-%d"),
                            "department": "Retina",
                            "doctor": "Dr. Shah",
                            "reason": "Follow-up (overdue)",
                            "status": "missed",
                        },
                    ],
                    "reports": [
                        {
                            "id": "vp-r1",
                            "title": "Retina Scan Summary",
                            "type": "Imaging",
                            "date": (NOW - timedelta(days=45)).strftime("%Y-%m-%d"),
                            "summary": "Mild NPDR. Follow-up in 4 weeks recommended.",
                        },
                        {
                            "id": "vp-r2",
                            "title": "Visual Acuity Chart",
                            "type": "Investigation",
                            "date": (NOW - timedelta(days=45)).strftime("%Y-%m-%d"),
                            "summary": "OD 6/9, OS 6/12 with correction.",
                        },
                    ],
                },
                {
                    "id": "vp-p2",
                    "name": "Meera Patel",
                    "email": "meera@example.com",
                    "dob": "1984-03-12",
                    "visits": [
                        {
                            "id": "v6",
                            "date": (NOW - timedelta(days=90)).strftime("%Y-%m-%d"),
                            "department": "General Ophthalmology",
                            "doctor": "Dr. Mehta",
                            "reason": "Routine eye exam",
                            "status": "completed",
                        }
                    ],
                    "reports": [
                        {
                            "id": "vp-r3",
                            "title": "Refraction Report",
                            "type": "Investigation",
                            "date": (NOW - timedelta(days=90)).strftime("%Y-%m-%d"),
                            "summary": "Mild myopia. Glasses advised for distance.",
                        }
                    ],
                },
            ],
        },
        "mother-child": {
            "id": "mother-child",
            "name": "Mother & Child Centre",
            "city": "Pune",
            "type": "Maternity & child health",
            "phone": "+91 20 4000 3000",
            "color": "#db2777",
            "tagline": "Safe motherhood, healthy children",
            "patients": [
                {
                    "id": "mc-p1",
                    "name": "Fatima Sheikh",
                    "email": "fatima@example.com",
                    "dob": "1998-11-18",
                    "visits": [
                        {
                            "id": "v7",
                            "date": (NOW - timedelta(days=20)).strftime("%Y-%m-%d"),
                            "department": "ANC",
                            "doctor": "Dr. Banerjee",
                            "reason": "Antenatal check — 2nd trimester",
                            "status": "completed",
                        },
                        {
                            "id": "v8",
                            "date": (NOW - timedelta(days=5)).strftime("%Y-%m-%d"),
                            "department": "Lab",
                            "doctor": "Lab Unit",
                            "reason": "ANC panel bloodwork",
                            "status": "completed",
                        },
                    ],
                    "reports": [
                        {
                            "id": "mc-r1",
                            "title": "ANC Ultrasound",
                            "type": "Imaging",
                            "date": (NOW - timedelta(days=20)).strftime("%Y-%m-%d"),
                            "summary": "Single live intrauterine gestation. Parameters normal.",
                        },
                        {
                            "id": "mc-r2",
                            "title": "ANC Blood Panel",
                            "type": "Lab report",
                            "date": (NOW - timedelta(days=5)).strftime("%Y-%m-%d"),
                            "summary": "Hb 11.2. Iron supplementation ongoing.",
                        },
                    ],
                },
                {
                    "id": "mc-p2",
                    "name": "Lakshmi Iyer",
                    "email": "lakshmi@example.com",
                    "dob": "1965-09-02",
                    "visits": [
                        {
                            "id": "v9",
                            "date": (NOW - timedelta(days=60)).strftime("%Y-%m-%d"),
                            "department": "General Medicine",
                            "doctor": "Dr. Nair",
                            "reason": "BP review (linked PHC referral)",
                            "status": "completed",
                        }
                    ],
                    "reports": [
                        {
                            "id": "mc-r3",
                            "title": "BP Trend Note",
                            "type": "Clinical note",
                            "date": (NOW - timedelta(days=60)).strftime("%Y-%m-%d"),
                            "summary": "Hypertension controlled on current meds.",
                        }
                    ],
                },
            ],
        },
    }


def load():
    if DATA_FILE.exists():
        with open(DATA_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    data = default_data()
    save(data)
    return data


def save(data):
    with open(DATA_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)



def push_to_carelink(hospital_meta: dict, patient: dict, visit=None, report=None):
    """Push change to CareLink for real-time sync."""
    base = os.getenv("CARELINK_URL", "http://127.0.0.1:5000").rstrip("/")
    url = base + "/api/sync/ingest"
    payload = {
        "hospital": {
            "id": hospital_meta.get("id"),
            "name": hospital_meta.get("name"),
            "city": hospital_meta.get("city"),
            "type": hospital_meta.get("type"),
        },
        "patient": {
            "id": patient.get("id"),
            "name": patient.get("name"),
            "email": patient.get("email"),
            "dob": patient.get("dob"),
            "visits": patient.get("visits") or [],
            "reports": patient.get("reports") or [],
        },
    }
    if visit:
        payload["visit"] = visit
    if report:
        payload["report"] = report
    try:
        import json as _json
        req = urllib.request.Request(
            url,
            data=_json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=3) as resp:
            return _json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        print(f"[sync] CareLink push failed: {e}")
        return {"ok": False, "error": str(e)}


def find_patient(hospital_key: str, query: str, data=None):
    data = data or load()
    q = query.lower().strip()
    h = data[hospital_key]
    for p in h["patients"]:
        if q in p["name"].lower() or q in (p.get("email") or "").lower():
            return p
    return None


@app.route("/")
def network_home():
    data = load()
    return render_template("network.html", hospitals=list(data.values()))


@app.route("/<key>/")
def hospital_home(key):
    data = load()
    if key not in data:
        return "Hospital not found", 404
    return render_template("hospital.html", h=data[key])


@app.route("/api/hospitals")
def api_hospitals():
    data = load()
    return jsonify([
        {
            "id": h["id"],
            "name": h["name"],
            "city": h["city"],
            "type": h["type"],
            "phone": h["phone"],
            "api": f"/api/{h['id']}/patient",
            "patient_count": len(h.get("patients", [])),
        }
        for h in data.values()
    ])


@app.route("/api/<key>/patient")
def api_patient(key):
    data = load()
    if key not in data:
        return jsonify({"ok": False, "error": "unknown hospital"}), 404
    name = request.args.get("name") or request.args.get("q") or ""
    if len(name.strip()) < 2:
        return jsonify({"ok": False, "error": "name query required"}), 400
    p = find_patient(key, name, data)
    h = data[key]
    if not p:
        return jsonify({
            "ok": True,
            "found": False,
            "hospital": {"id": h["id"], "name": h["name"], "city": h["city"]},
            "patient": None,
            "message": f"No record for '{name}' at {h['name']}",
        })
    return jsonify({
        "ok": True,
        "found": True,
        "hospital": {
            "id": h["id"],
            "name": h["name"],
            "city": h["city"],
            "type": h["type"],
            "phone": h["phone"],
        },
        "patient": {
            "id": p.get("id"),
            "name": p["name"],
            "email": p.get("email"),
            "dob": p.get("dob"),
            "visits": p.get("visits", []),
            "reports": p.get("reports", []),
        },
        "message": f"Found {p['name']} at {h['name']}",
    })


@app.route("/api/<key>/patients", methods=["POST"])
def api_add_patient(key):
    data = load()
    if key not in data:
        return jsonify({"ok": False, "error": "unknown hospital"}), 404
    payload = request.get_json(force=True) or {}
    name = (payload.get("name") or "").strip()
    email = (payload.get("email") or "").strip()
    if not name:
        return jsonify({"ok": False, "error": "name required"}), 400

    # Update existing by name/email or create
    existing = None
    for p in data[key]["patients"]:
        if name.lower() == p["name"].lower() or (email and email.lower() == (p.get("email") or "").lower()):
            existing = p
            break

    if existing:
        if email:
            existing["email"] = email
        if payload.get("dob"):
            existing["dob"] = payload["dob"]
        patient = existing
        created = False
    else:
        patient = {
            "id": "p_" + uuid.uuid4().hex[:8],
            "name": name,
            "email": email,
            "dob": (payload.get("dob") or "").strip(),
            "visits": [],
            "reports": [],
        }
        data[key]["patients"].insert(0, patient)
        created = True

    save(data)
    sync = push_to_carelink(data[key], patient)
    return jsonify({"ok": True, "created": created, "patient": patient, "carelink_sync": sync}), 201 if created else 200


@app.route("/api/<key>/patients/<pid>/visits", methods=["POST"])
def api_add_visit(key, pid):
    data = load()
    if key not in data:
        return jsonify({"ok": False, "error": "unknown hospital"}), 404
    patient = next((p for p in data[key]["patients"] if p.get("id") == pid), None)
    if not patient:
        return jsonify({"ok": False, "error": "patient not found"}), 404
    payload = request.get_json(force=True) or {}
    visit = {
        "id": "v_" + uuid.uuid4().hex[:8],
        "date": (payload.get("date") or datetime.utcnow().strftime("%Y-%m-%d")).strip(),
        "department": (payload.get("department") or "General").strip(),
        "doctor": (payload.get("doctor") or "").strip(),
        "reason": (payload.get("reason") or "Visit").strip(),
        "status": (payload.get("status") or "completed").strip(),
    }
    patient.setdefault("visits", []).insert(0, visit)
    save(data)
    sync = push_to_carelink(data[key], patient, visit=visit)
    return jsonify({"ok": True, "visit": visit, "carelink_sync": sync}), 201


@app.route("/api/<key>/patients/<pid>/reports", methods=["POST"])
def api_add_report(key, pid):
    data = load()
    if key not in data:
        return jsonify({"ok": False, "error": "unknown hospital"}), 404
    patient = next((p for p in data[key]["patients"] if p.get("id") == pid), None)
    if not patient:
        return jsonify({"ok": False, "error": "patient not found"}), 404
    payload = request.get_json(force=True) or {}
    title = (payload.get("title") or "").strip()
    if not title:
        return jsonify({"ok": False, "error": "title required"}), 400
    report = {
        "id": "r_" + uuid.uuid4().hex[:8],
        "title": title,
        "type": (payload.get("type") or "Report").strip(),
        "date": (payload.get("date") or datetime.utcnow().strftime("%Y-%m-%d")).strip(),
        "summary": (payload.get("summary") or "").strip(),
    }
    patient.setdefault("reports", []).insert(0, report)
    save(data)
    sync = push_to_carelink(data[key], patient, report=report)
    return jsonify({"ok": True, "report": report, "carelink_sync": sync}), 201


@app.route("/api/<key>/add-full", methods=["POST"])
def api_add_full(key):
    """One-shot: create/find patient + optional visit + optional report."""
    data = load()
    if key not in data:
        return jsonify({"ok": False, "error": "unknown hospital"}), 404
    payload = request.get_json(force=True) or {}
    name = (payload.get("name") or "").strip()
    email = (payload.get("email") or "").strip()
    if not name:
        return jsonify({"ok": False, "error": "name required"}), 400

    patient = None
    for p in data[key]["patients"]:
        if name.lower() == p["name"].lower() or (email and email.lower() == (p.get("email") or "").lower()):
            patient = p
            break
    if not patient:
        patient = {
            "id": "p_" + uuid.uuid4().hex[:8],
            "name": name,
            "email": email,
            "dob": (payload.get("dob") or "").strip(),
            "visits": [],
            "reports": [],
        }
        data[key]["patients"].insert(0, patient)
    else:
        if email:
            patient["email"] = email

    visit = None
    if payload.get("reason") or payload.get("department"):
        visit = {
            "id": "v_" + uuid.uuid4().hex[:8],
            "date": (payload.get("visit_date") or payload.get("date") or datetime.utcnow().strftime("%Y-%m-%d")).strip(),
            "department": (payload.get("department") or "General").strip(),
            "doctor": (payload.get("doctor") or "").strip(),
            "reason": (payload.get("reason") or "Visit").strip(),
            "status": (payload.get("status") or "completed").strip(),
        }
        patient.setdefault("visits", []).insert(0, visit)

    report = None
    if payload.get("report_title") or payload.get("title"):
        report = {
            "id": "r_" + uuid.uuid4().hex[:8],
            "title": (payload.get("report_title") or payload.get("title") or "Report").strip(),
            "type": (payload.get("report_type") or payload.get("type") or "Report").strip(),
            "date": (payload.get("report_date") or payload.get("date") or datetime.utcnow().strftime("%Y-%m-%d")).strip(),
            "summary": (payload.get("summary") or "").strip(),
        }
        patient.setdefault("reports", []).insert(0, report)

    save(data)
    sync = push_to_carelink(data[key], patient, visit=visit, report=report)
    return jsonify({"ok": True, "patient": patient, "visit": visit, "report": report, "carelink_sync": sync}), 201


@app.route("/api/reset", methods=["POST"])
def api_reset():
    seed_file = Path(__file__).parent / "demo_seed.json"
    if seed_file.exists():
        with open(seed_file, "r", encoding="utf-8") as f:
            save(json.load(f))
    else:
        save(default_data())
    return jsonify({"ok": True})


if __name__ == "__main__":
    load()
    print("\nHospital network: http://localhost:5001")
    print("  City Care:     http://localhost:5001/city-care/")
    print("  Vision Plus:   http://localhost:5001/vision-plus/")
    print("  Mother Child:  http://localhost:5001/mother-child/\n")
    app.run(host="127.0.0.1", port=5001, debug=False)
