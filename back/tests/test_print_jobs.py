"""Hardware printing / print jobs API (#317)."""

from __future__ import annotations

import unittest
from datetime import timedelta

from pg_client_mixin import PgClientTestCase

from app import models, security
from app import print_service as print_svc


def _bearer_headers(user: models.User) -> dict[str, str]:
    data = {
        "sub": user.username,
        "tenant_id": user.tenant_id,
        "provider_id": getattr(user, "provider_id", None),
        "token_version": user.token_version,
    }
    token = security.create_access_token(data, expires_delta=timedelta(minutes=30))
    return {"Authorization": f"Bearer {token}"}


class TestPrintJobs(PgClientTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.t_a = models.Tenant(name="Print Tenant A")
        self.t_b = models.Tenant(name="Print Tenant B")
        self.session.add(self.t_a)
        self.session.add(self.t_b)
        self.session.commit()
        self.session.refresh(self.t_a)
        self.session.refresh(self.t_b)

        self.owner_a = models.User(
            username="print-owner-a@amvara.de",
            hashed_password=security.get_password_hash("x"),
            full_name="Owner A",
            tenant_id=self.t_a.id,
            role=models.UserRole.owner,
        )
        self.owner_b = models.User(
            username="print-owner-b@amvara.de",
            hashed_password=security.get_password_hash("x"),
            full_name="Owner B",
            tenant_id=self.t_b.id,
            role=models.UserRole.owner,
        )
        self.session.add(self.owner_a)
        self.session.add(self.owner_b)
        self.session.commit()
        self.session.refresh(self.owner_a)
        self.session.refresh(self.owner_b)

        floor = models.Floor(name="Main", sort_order=0, tenant_id=self.t_a.id)
        self.session.add(floor)
        self.session.commit()
        self.session.refresh(floor)
        table = models.Table(
            name="T01",
            token="tok-print-a-unique",
            floor_id=floor.id,
            tenant_id=self.t_a.id,
            x_position=0,
            y_position=0,
            rotation=0,
            shape="rect",
            width=1,
            height=1,
            seat_count=4,
            is_active=False,
        )
        self.session.add(table)
        self.session.commit()
        self.session.refresh(table)

        product = models.Product(
            name="Burger",
            price_cents=1200,
            tenant_id=self.t_a.id,
            category="Main Course",
        )
        self.session.add(product)
        self.session.commit()
        self.session.refresh(product)

        order = models.Order(
            tenant_id=self.t_a.id,
            table_id=table.id,
            status=models.OrderStatus.pending,
            customer_name="Guest",
        )
        self.session.add(order)
        self.session.commit()
        self.session.refresh(order)
        item = models.OrderItem(
            order_id=order.id,
            product_id=product.id,
            product_name=product.name,
            quantity=2,
            price_cents=1200,
        )
        self.session.add(item)
        self.session.commit()
        self.order_id = order.id

    def test_clear_queue_only_removes_own_finished_and_pending_jobs(self) -> None:
        from datetime import datetime, timezone

        ha = _bearer_headers(self.owner_a)
        hb = _bearer_headers(self.owner_b)
        now = datetime.now(timezone.utc)
        rows = [
            models.PrintJob(tenant_id=self.t_a.id, job_type="kitchen", status="pending"),
            models.PrintJob(tenant_id=self.t_a.id, job_type="receipt", status="failed"),
            models.PrintJob(tenant_id=self.t_a.id, job_type="kitchen", status="done"),
            models.PrintJob(tenant_id=self.t_a.id, job_type="kitchen", status="claimed", claimed_at=now),
            models.PrintJob(tenant_id=self.t_b.id, job_type="kitchen", status="pending"),
        ]
        for r in rows:
            self.session.add(r)
        self.session.commit()
        res = self.client.delete("/print-jobs", headers=ha)
        self.assertEqual(res.status_code, 200, res.text)
        self.assertEqual(res.json()["deleted"], 3)
        left_a = self.client.get("/print-jobs", headers=ha).json()
        self.assertEqual([j["status"] for j in left_a], ["claimed"])
        self.assertEqual(len(self.client.get("/print-jobs", headers=hb).json()), 1)

    def test_create_agent_and_poll_job(self) -> None:
        h = _bearer_headers(self.owner_a)
        r = self.client.post(
            "/tenant/print-agents",
            headers=h,
            json={"device_id": "pi-1", "display_name": "Kitchen Pi"},
        )
        self.assertEqual(r.status_code, 200, r.text)
        body = r.json()
        self.assertIn("token", body)
        token = body["token"]
        self.assertTrue(token)

        status = self.client.get("/print-jobs/status", headers=h)
        self.assertEqual(status.status_code, 200)
        self.assertFalse(status.json()["agent_online"])

        hb = self.client.post(
            "/print-agent/heartbeat",
            headers={"Authorization": f"Bearer {token}"},
        )
        self.assertEqual(hb.status_code, 200, hb.text)
        self.assertTrue(hb.json()["online"])

        status2 = self.client.get("/print-jobs/status", headers=h)
        self.assertTrue(status2.json()["agent_online"])

        job_res = self.client.post(
            "/print-jobs",
            headers=h,
            json={"job_type": "kitchen", "order_id": self.order_id},
        )
        self.assertEqual(job_res.status_code, 200, job_res.text)
        job = job_res.json()["job"]
        self.assertEqual(job["status"], "pending")
        self.assertIn("KITCHEN", job["payload"].get("plain_text", ""))
        self.assertIn("Burger", job["payload"].get("plain_text", ""))

        claimed = self.client.get(
            "/print-agent/jobs",
            headers={"Authorization": f"Bearer {token}"},
        )
        self.assertEqual(claimed.status_code, 200, claimed.text)
        jobs = claimed.json()
        self.assertEqual(len(jobs), 1)
        self.assertEqual(jobs[0]["id"], job["id"])
        self.assertEqual(jobs[0]["status"], "claimed")

        done = self.client.post(
            f"/print-agent/jobs/{job['id']}/complete",
            headers={"Authorization": f"Bearer {token}"},
            json={"status": "done"},
        )
        self.assertEqual(done.status_code, 200, done.text)
        self.assertEqual(done.json()["status"], "done")

    def test_agent_cannot_see_other_tenant_jobs(self) -> None:
        h_a = _bearer_headers(self.owner_a)
        h_b = _bearer_headers(self.owner_b)
        agent_a = self.client.post(
            "/tenant/print-agents",
            headers=h_a,
            json={"device_id": "pi-a"},
        ).json()
        agent_b = self.client.post(
            "/tenant/print-agents",
            headers=h_b,
            json={"device_id": "pi-b"},
        ).json()

        self.client.post(
            "/print-jobs",
            headers=h_a,
            json={
                "job_type": "receipt",
                "payload": {"plain_text": "SECRET-A\n"},
            },
        )
        claimed_b = self.client.get(
            "/print-agent/jobs",
            headers={"Authorization": f"Bearer {agent_b['token']}"},
        )
        self.assertEqual(claimed_b.status_code, 200)
        self.assertEqual(claimed_b.json(), [])

        claimed_a = self.client.get(
            "/print-agent/jobs",
            headers={"Authorization": f"Bearer {agent_a['token']}"},
        )
        self.assertEqual(len(claimed_a.json()), 1)
        self.assertIn("SECRET-A", claimed_a.json()[0]["payload"]["plain_text"])

    def test_failed_job_can_be_retried(self) -> None:
        h = _bearer_headers(self.owner_a)
        agent = self.client.post(
            "/tenant/print-agents", headers=h, json={"device_id": "usb-pc", "display_name": "USB"}
        ).json()
        job = self.client.post(
            "/print-jobs",
            headers=h,
            json={"job_type": "kitchen", "payload": {"plain_text": "RETRY-ME"}},
        ).json()["job"]
        ah = {"Authorization": f"Bearer {agent['token']}"}
        self.assertEqual(len(self.client.get("/print-agent/jobs", headers=ah).json()), 1)
        self.client.post(
            f"/print-agent/jobs/{job['id']}/complete",
            headers=ah,
            json={"status": "failed", "error_message": "cannot open Windows printer"},
        )
        # Done jobs cannot be retried; failed ones go back to the queue.
        r = self.client.post(f"/print-jobs/{job['id']}/retry", headers=h)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["status"], "pending")
        self.assertIsNone(r.json()["error_message"])
        self.assertEqual(self.client.post(f"/print-jobs/{job['id']}/retry", headers=h).status_code, 400)

    def test_unauthenticated_agent_rejected(self) -> None:
        r = self.client.get("/print-agent/jobs")
        self.assertEqual(r.status_code, 401)

    def test_hash_token_roundtrip(self) -> None:
        raw = print_svc.generate_agent_token()
        h = print_svc.hash_agent_token(raw)
        self.assertEqual(len(h), 64)
        self.assertEqual(h, print_svc.hash_agent_token(raw))


if __name__ == "__main__":
    unittest.main()
