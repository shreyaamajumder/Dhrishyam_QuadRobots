"""Walk the API the way the frontend does: log in, create, check, accept, submit, insights.

Start the backend first (from codebase/, with DEMO_MODE=true in .env):
    uvicorn app.main:app --port 8000
Then, in a second window, from codebase/:
    python scripts/smoke_api.py
    python scripts/smoke_api.py "Your own draft text here"

It creates real rows in the database the backend uses, so run it against your local or demo
database, not a shared one. It ends with SMOKE OK, or stops at the first failing request.
"""
import sys
import time

import httpx

BASE = "http://localhost:8000/api/v1"
ORG = "00000000-0000-0000-0000-000000000001"


def client(role):
    token = httpx.post(f"{BASE}/auth/demo-login", json={"role": role}).json()["access_token"]
    return httpx.Client(base_url=BASE, headers={"Authorization": f"Bearer {token}", "X-Org-Id": ORG},
                        timeout=60)


def ok(resp, code=200):
    if resp.status_code != code:
        print("FAILED", resp.request.method, resp.request.url, resp.status_code, resp.text[:600])
        sys.exit(1)
    return resp.json() if resp.content else None


creator, reviewer, admin = client("creator"), client("reviewer"), client("admin")
print("me:", ok(creator.get("/me"))["display_name"])
print("disclosure:", ok(creator.get("/disclosure")))
lib = ok(admin.get("/library/entries"))
print("library entries:", len(lib))

draft = sys.argv[1] if len(sys.argv) > 1 else (
    "India's #1 AI-powered platform, trusted by 10 million users. Our kids plan is guaranteed "
    "to improve grades. CLICK HERE to join.")
item = ok(creator.post("/content", json={"title": "Smoke", "content_type": "blog", "body_text": draft}), 201)
started = ok(creator.post(f"/content/{item['id']}/checks"), 202)
for _ in range(120):
    run = ok(creator.get(f"/checks/{started['check_run_id']}"))
    if run["status"] not in ("queued", "running"):
        break
    time.sleep(0.5)
print("run:", run["status"], run["mode"], run["degraded_reason"], run["stats"], run["engine_info"])
if run["status"] == "failed":
    print("error:", run["error"]); sys.exit(1)
for f in run["findings"]:
    print(f"  [{f['severity']}] {f['display_status']:<25} {f['origin']:<10} {f['span_text']!r} "
          f"cites={[c['entry_code'] for c in f['citations']]} sugg={f['suggestion'] and f['suggestion']['after_text']!r} "
          f"label={f['label']}")
steps = ok(creator.get(f"/checks/{run['id']}/steps"))
print("steps:", len(steps), [s["event_type"] for s in steps][:6], "...")

with_sugg = [f for f in run["findings"] if f["suggestion"]]
if with_sugg:
    target = with_sugg[-1]
    decision = ok(creator.post(f"/findings/{target['id']}/decision", json={"action": "accepted"}))
    print("accepted ->", decision["resulting_version_no"])
    detail = ok(creator.get(f"/content/{item['id']}"))
    print("new body:", detail["versions"][-1]["body_text"])
    print("latest_check still shown:", detail["latest_check"] is not None,
          "stale:", [f["span_text"] for f in detail["latest_check"]["findings"] if f["is_stale"]])
    body = detail["versions"][-1]["body_text"]
    for f in detail["latest_check"]["findings"]:
        if not f["is_stale"] and not f["decisions"]:
            assert body[f["span_start"]:f["span_end"]] == f["span_text"], f
    print("spans still line up: yes")
    again = creator.post(f"/findings/{target['id']}/decision", json={"action": "accepted"})
    print("accept twice ->", again.status_code)

blocked = creator.post(f"/content/{item['id']}/submit", json={})
print("submit with undecided High findings ->", blocked.status_code, blocked.json().get("detail"))
for f in ok(creator.get(f"/content/{item['id']}"))["latest_check"]["findings"]:
    if f["severity"] == "high" and not f["decisions"]:
        ok(creator.post(f"/findings/{f['id']}/decision", json={"action": "dismissed", "reason": "Checked with legal."}))
reviewer_id = ok(reviewer.get("/me"))["id"]
print("submit ->", ok(creator.post(f"/content/{item['id']}/submit", json={"reviewer_id": reviewer_id}))["status"])
print("queue:", [(q["title"], q["high_issues"]) for q in ok(reviewer.get("/review-queue"))][:3])
print("delete ->", creator.delete(f"/content/{item['id']}").status_code)
print("insights:", ok(admin.get("/insights/summary?period_days=30"))["kpis"])
print("login unknown email ->", httpx.post(f"{BASE}/auth/login", json={"email": "x@y.com"}).status_code)
print("SMOKE OK")
