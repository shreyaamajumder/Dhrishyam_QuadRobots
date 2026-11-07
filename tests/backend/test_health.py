from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_healthz():
    response = client.get("/healthz")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_readyz_needs_database(db):
    assert client.get("/readyz").status_code == 200


def test_cors_allows_only_listed_origins():
    ok = client.options("/healthz", headers={
        "Origin": "http://localhost:5173", "Access-Control-Request-Method": "GET"})
    bad = client.options("/healthz", headers={
        "Origin": "https://evil.example", "Access-Control-Request-Method": "GET"})
    assert ok.headers.get("access-control-allow-origin") == "http://localhost:5173"
    assert "access-control-allow-origin" not in bad.headers
