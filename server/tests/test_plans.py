"""The subscription catalogue and the order intake, without touching a machine.

Every test loads `server/orion-api.py` against a temporary data root and a
throwaway provisioner script, so nothing here talks to incus, systemd or the
real /srv/storage. What is tested is the part a mistake would cost a customer:
the prices and sizes the page sells, who may place an order, that a retried
webhook cannot build a second server, and that a plan is a ceiling.

    python3 -m unittest discover -s server/tests -v
"""

import importlib.util
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

API_PATH = Path(__file__).resolve().parents[1] / "orion-api.py"
SECRET = "test-provision-secret"


def load_api(root, secret=SECRET, script=None):
    os.environ["ORION_ROOT"] = str(root)
    os.environ["ORION_PROVISION_SECRET"] = secret
    os.environ["ORION_PROVISION_DIR"] = str(root / "orders")
    if script is not None:
        os.environ["ORION_PROVISION_SCRIPT"] = str(script)
    spec = importlib.util.spec_from_file_location("orion_api_plans_under_test", API_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.DIRECTORY_ENV = root / "no-directory-credentials.env"
    module.samba_installed = lambda: False
    return module


class PlanCatalogueTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name) / "storage"
        self.root.mkdir()
        self.api = load_api(self.root)

    def tearDown(self):
        self.temporary.cleanup()

    def test_the_four_plans_are_sold_in_the_order_the_page_shows_them(self):
        self.assertEqual(
            [plan["slug"] for plan in self.api.PLANS],
            ["trial", "starter", "general", "storage"],
        )

    def test_the_sizes_are_one_five_twentyfive_and_a_hundred_gigabytes(self):
        self.assertEqual(
            [plan["storageGb"] for plan in self.api.PLANS], [1, 5, 25, 100]
        )

    def test_a_bigger_plan_costs_more_and_a_trial_is_free(self):
        paid = [plan["priceCents"] for plan in self.api.PLANS if plan["priceCents"]]
        self.assertEqual(self.api.PLANS[0]["priceCents"], 0)
        self.assertEqual(paid, sorted(paid))
        self.assertEqual(len(set(paid)), len(paid))

    def test_every_plan_has_a_sku_and_a_checkout_link(self):
        facts = self.api.plans_facts()
        self.assertEqual(len(facts["plans"]), 4)
        for plan in facts["plans"]:
            self.assertEqual(plan["sku"], "orion-" + plan["slug"])
            self.assertTrue(plan["checkoutUrl"].endswith("plan=" + plan["sku"]))
            self.assertIn("/signup?", plan["checkoutUrl"])

    def test_an_unknown_plan_is_not_a_plan(self):
        self.assertIsNone(self.api.plan_by_slug("enterprise"))
        self.assertEqual(self.api.plan_by_slug("general")["storageGb"], 25)


class OrderIntakeTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name) / "storage"
        self.root.mkdir()
        self.script = self.root / "provision-container.sh"
        self.script.write_text("#!/bin/sh\n")
        self.api = load_api(self.root, script=self.script)
        self.api.PROVISION_SCRIPT = str(self.script)

    def tearDown(self):
        self.temporary.cleanup()

    def order(self, **overrides):
        payload = {
            "orderId": "ord-2026-0001",
            "plan": "general",
            "email": "person@example.test",
            "paid": True,
        }
        payload.update(overrides)
        return payload

    def test_a_paid_order_is_recorded_and_names_its_container(self):
        order, created = self.api.queue_order(self.order())
        self.assertTrue(created)
        self.assertEqual(order["status"], "queued")
        self.assertEqual(order["sizeGb"], 25)
        self.assertTrue(order["container"].startswith("orion-general-"))
        self.assertEqual(order["container"], order["volume"])
        self.assertTrue(self.api.order_path("ord-2026-0001").is_file())

    def test_the_same_order_twice_is_one_server(self):
        first, created = self.api.queue_order(self.order())
        second, again = self.api.queue_order(self.order())
        self.assertTrue(created)
        self.assertFalse(again)
        self.assertEqual(first["container"], second["container"])
        self.assertEqual(len(self.api.list_orders()), 1)

    def test_a_failed_order_can_be_retried_only_when_asked(self):
        order, _ = self.api.queue_order(self.order())
        self.api.finish_order(order, "failed", error="disk full")
        same, created = self.api.queue_order(self.order())
        self.assertFalse(created)
        self.assertEqual(same["status"], "failed")
        retried, created = self.api.queue_order(self.order(retry=True))
        self.assertTrue(created)
        self.assertEqual(retried["status"], "queued")

    def test_an_unpaid_order_is_refused(self):
        for paid in (False, None, "yes", 1):
            with self.assertRaises(ValueError):
                self.api.queue_order(self.order(paid=paid))

    def test_a_plan_is_a_ceiling_not_a_floor(self):
        smaller, _ = self.api.queue_order(self.order(storageGb=10))
        self.assertEqual(smaller["sizeGb"], 10)
        self.assertEqual(smaller["requestedGb"], 10)
        bigger, _ = self.api.queue_order(
            self.order(orderId="ord-bigger", storageGb=400)
        )
        self.assertEqual(bigger["sizeGb"], 25)
        self.assertEqual(bigger["requestedGb"], 400)

    def test_an_order_without_an_address_is_refused(self):
        with self.assertRaises(ValueError):
            self.api.queue_order(self.order(email="not-an-address"))

    def test_an_order_id_with_a_path_separator_is_refused(self):
        with self.assertRaises(ValueError):
            self.api.queue_order(self.order(orderId="../../etc/passwd"))

    def test_the_worker_claims_each_order_once(self):
        self.api.queue_order(self.order(orderId="ord-b"))
        self.api.queue_order(self.order(orderId="ord-a"))
        first = self.api.claim_next_order()
        second = self.api.claim_next_order()
        self.assertIsNotNone(first)
        self.assertEqual(first["status"], "running")
        self.assertIsNotNone(second)
        self.assertNotEqual(first["orderId"], second["orderId"])
        self.assertIsNone(self.api.claim_next_order())

    def test_a_signed_body_is_the_only_body_that_queues_anything(self):
        raw = json.dumps(self.order()).encode()
        signature = self.api.hmac.new(
            SECRET.encode(), raw, self.api.hashlib.sha256
        ).hexdigest()
        self.assertTrue(self.api.verify_provision_signature(raw, "sha256=" + signature))
        self.assertTrue(self.api.verify_provision_signature(raw, signature))
        self.assertFalse(self.api.verify_provision_signature(raw, "sha256=" + "0" * 64))
        self.assertFalse(self.api.verify_provision_signature(raw, ""))
        self.assertFalse(
            self.api.verify_provision_signature(b'{"paid": true}', "sha256=" + signature)
        )

    def test_no_secret_means_no_provisioning(self):
        self.api.PROVISION_SECRET = ""
        self.assertFalse(self.api.provision_ready())
        self.assertFalse(self.api.verify_provision_signature(b"{}", "sha256=abc"))

    def test_the_provisioner_is_named_in_the_order_it_builds(self):
        order, _ = self.api.queue_order(self.order())
        completed = mock.Mock(returncode=0, stdout='{"container": "x"}\n', stderr="")
        with mock.patch.object(self.api.subprocess, "run", return_value=completed) as run:
            self.api.run_provision(order)
        command = run.call_args[0][0]
        self.assertEqual(command[0], str(self.script))
        self.assertEqual(command[command.index("--name") + 1], order["container"])
        self.assertEqual(command[command.index("--size-gb") + 1], "25")
        self.assertEqual(command[command.index("--plan") + 1], "general")
        stored = self.api.read_order(order["orderId"])
        self.assertEqual(stored["status"], "ready")
        self.assertEqual(stored["result"], {"container": "x"})

    def test_a_missing_provisioner_fails_the_order_instead_of_hanging_it(self):
        order, _ = self.api.queue_order(self.order())
        with mock.patch.object(
            self.api.subprocess, "run", side_effect=FileNotFoundError
        ):
            self.api.run_provision(order)
        stored = self.api.read_order(order["orderId"])
        self.assertEqual(stored["status"], "failed")
        self.assertIn("not installed", stored["error"])

    def test_a_nonzero_provisioner_fails_the_order_with_its_log(self):
        order, _ = self.api.queue_order(self.order())
        completed = mock.Mock(returncode=3, stdout="", stderr="incus said no\n")
        with mock.patch.object(self.api.subprocess, "run", return_value=completed):
            self.api.run_provision(order)
        stored = self.api.read_order(order["orderId"])
        self.assertEqual(stored["status"], "failed")
        self.assertIn("exited 3", stored["error"])
        self.assertIn("incus said no", stored["log"])


class ClaimLinkTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name) / "storage"
        self.root.mkdir()
        self.api = load_api(self.root)
        self.api.CLAIM_SECRET = "claim-secret"

    def tearDown(self):
        self.temporary.cleanup()

    def test_a_claim_link_round_trips(self):
        token = self.api.claim_token("person@example.test")
        claims = self.api.read_claim(token)
        self.assertEqual(claims["email"], "person@example.test")

    def test_an_edited_claim_link_is_refused(self):
        token = self.api.claim_token("person@example.test")
        expires, _address, mac = token.split("~")
        self.assertIsNone(
            self.api.read_claim(f"{expires}~other@example.test~{mac}")
        )
        self.assertIsNone(self.api.read_claim("nonsense"))

    def test_an_address_with_dots_survives_the_round_trip(self):
        claims = self.api.read_claim(self.api.claim_token("first.last@example.test"))
        self.assertEqual(claims["email"], "first.last@example.test")

    def test_an_expired_claim_link_is_refused(self):
        token = self.api.claim_token("person@example.test", expires=1)
        self.assertIsNone(self.api.read_claim(token))

    def test_no_claim_secret_means_no_claim_links(self):
        self.api.CLAIM_SECRET = ""
        self.assertEqual(self.api.claim_token("person@example.test"), "")
        self.assertIsNone(self.api.read_claim("1.a@b.test.abc"))


if __name__ == "__main__":
    unittest.main()
