"""The rules about who may administer whom, against a throwaway data directory.

Every test loads `server/orion-api.py` with ORION_ROOT pointing at a temporary
directory, so nothing here can read or write the real NAS: spaces are folders in
that directory and the registry is a JSON file inside it. Samba, systemd and the
identity provider are stubbed, because those are the parts a unit test cannot
own — the role rules themselves are the subject.

    python3 -m unittest discover -s server/tests -v
"""

import importlib.util
import json
import os
import tempfile
import unittest
from pathlib import Path

API_PATH = Path(__file__).resolve().parents[1] / "orion-api.py"


def identity(email, groups=()):
    handle = email.split("@")[0]
    return {"email": email, "name": handle.title(), "username": handle, "groups": list(groups)}


def load_api(root):
    """Import the service against `root`, with the host-facing parts stubbed."""
    os.environ["ORION_ROOT"] = str(root)
    for name in ("ORION_AUTHENTIK_URL", "ORION_AUTHENTIK_TOKEN", "ORION_AUTHENTIK_GROUP"):
        os.environ.pop(name, None)
    spec = importlib.util.spec_from_file_location("orion_api_under_test", API_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    # A test must never touch /etc/samba, systemd or a real smbpasswd.
    module.DIRECTORY_ENV = root / "no-directory-credentials.env"
    module.samba_installed = lambda: False
    module.write_smb_password = lambda *args, **kwargs: None
    module.apply_smb_conf = lambda *args, **kwargs: None
    module.drop_samba_account = lambda *args, **kwargs: None
    return module


class RoleTestCase(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name) / "storage"
        self.root.mkdir()
        self.api = load_api(self.root)
        self.admin = self.api.session_facts(identity("boss@example.test"))
        self.member_email = "member@example.test"
        self.api.create_space({"name": "Member One", "email": self.member_email, "role": "Member"}, self.admin)

    def tearDown(self):
        self.temporary.cleanup()

    # -- who is asking -----------------------------------------------------

    def test_anonymous_session_manages_nothing(self):
        session = self.api.session_facts(None)
        self.assertEqual(session["role"], "Anonymous")
        self.assertFalse(session["permissions"]["manageUsers"])

    def test_first_identity_on_a_fresh_box_becomes_platform_admin(self):
        self.assertEqual(self.admin["role"], "Platform admin")
        self.assertEqual(self.admin["permissions"]["scope"], "all")
        registry = json.loads((self.root / ".orion" / "platform-admins.json").read_text())
        self.assertEqual(registry["emails"], ["boss@example.test"])

    def test_second_identity_is_not_a_platform_admin(self):
        session = self.api.session_facts(identity(self.member_email))
        self.assertEqual(session["role"], "Member")
        self.assertEqual(session["permissions"]["scope"], "none")

    def test_provider_group_grants_platform_admin_without_the_registry(self):
        fresh_root = Path(self.temporary.name) / "second"
        fresh_root.mkdir()
        api = load_api(fresh_root)
        session = api.session_facts(identity("someone@example.test", groups=["orion-platform-admins"]))
        self.assertEqual(session["role"], "Platform admin")
        # Being in the group must not claim the box: only a listed address does.
        self.assertFalse((fresh_root / ".orion" / "platform-admins.json").exists())

    def test_member_session_cannot_manage_any_space(self):
        session = self.api.session_facts(identity(self.member_email))
        spaces = self.api.spaces_facts(session)
        self.assertTrue(spaces)
        self.assertTrue(all(not space["manageable"] for space in spaces))

    # -- creating people ---------------------------------------------------

    def test_member_cannot_create_a_space(self):
        session = self.api.session_facts(identity(self.member_email))
        with self.assertRaises(PermissionError):
            self.api.create_space({"name": "Intruder", "email": "x@example.test", "role": "Member"}, session)
        self.assertFalse((self.root / "Users" / "intruder").exists())

    def test_agency_admin_is_filed_under_itself_and_its_people_under_it(self):
        agency = self.api.create_space(
            {"name": "Agency Lady", "email": "agency@example.test", "role": "Agency admin"},
            self.admin,
        )
        session = self.api.session_facts(identity("agency@example.test"))
        self.assertEqual(session["role"], "Agency admin")
        self.assertEqual(session["permissions"]["scope"], "agency")
        self.assertEqual(session["agency"], agency["slug"])

        person = self.api.create_space(
            {"name": "Agency Person", "email": "person@example.test", "role": "Member"}, session
        )
        self.assertEqual(person["agency"], agency["slug"])
        self.assertTrue(person["manageable"])

    def test_agency_admin_cannot_appoint_another_agency_admin(self):
        self.api.create_space(
            {"name": "Agency Lady", "email": "agency@example.test", "role": "Agency admin"},
            self.admin,
        )
        session = self.api.session_facts(identity("agency@example.test"))
        with self.assertRaises(PermissionError):
            self.api.create_space(
                {"name": "Rival", "email": "rival@example.test", "role": "Agency admin"}, session
            )

    def test_agency_admin_does_not_manage_its_own_space_or_another_agency(self):
        agency = self.api.create_space(
            {"name": "Agency Lady", "email": "agency@example.test", "role": "Agency admin"},
            self.admin,
        )
        other = self.api.create_space(
            {"name": "Other Agency", "email": "other@example.test", "role": "Agency admin"},
            self.admin,
        )
        session = self.api.session_facts(identity("agency@example.test"))
        self.assertFalse(self.api.can_manage_space(self.api.load_spaces()[0], session))
        with self.assertRaises(PermissionError):
            self.api.delete_space(agency["slug"], session)
        with self.assertRaises(PermissionError):
            self.api.delete_space(other["slug"], session)

    def test_agency_admin_cannot_remove_a_member_of_another_agency(self):
        agency = self.api.create_space(
            {"name": "Agency One", "email": "one@example.test", "role": "Agency admin"},
            self.admin,
        )
        other = self.api.create_space(
            {"name": "Agency Two", "email": "two@example.test", "role": "Agency admin"},
            self.admin,
        )
        person = self.api.create_space(
            {"name": "Theirs", "email": "theirs@example.test", "role": "Member", "agency": other["slug"]},
            self.admin,
        )
        session = self.api.session_facts(identity("one@example.test"))
        self.assertIn(agency["slug"], [space["slug"] for space in self.api.spaces_facts(session)])
        with self.assertRaises(PermissionError):
            self.api.delete_space(person["slug"], session)

    def test_setting_a_password_is_scoped_to_manageable_spaces(self):
        person = self.api.create_space(
            {"name": "Someone", "email": "someone@example.test", "role": "Member"}, self.admin
        )
        # The account exists in the registry; a member session cannot re-key it.
        session = self.api.session_facts(identity(self.member_email))
        with self.assertRaises(PermissionError):
            self.api.set_space_password(person["slug"], "a-long-password", session)
        self.api.set_space_password(person["slug"], "a-long-password", self.admin)
        stored = {space["slug"]: space for space in self.api.load_spaces()}
        self.assertTrue(stored[person["slug"]]["smb"])

    def test_removing_a_share_keeps_the_folder_and_the_sign_in(self):
        self.api.directory_ready = lambda: True
        self.api.create_signin = lambda username, *args, **kwargs: username
        space = self.api.create_space(
            {
                "name": "Shared Person",
                "email": "shared@example.test",
                "role": "Member",
                "password": "a-long-password",
            },
            self.admin,
        )
        self.api.samba_installed = lambda: True
        removed = self.api.remove_share(space["slug"], self.admin)
        self.assertFalse(removed["smb"])
        self.assertEqual(removed["signin"], space["slug"])
        self.assertTrue((self.root / "Users" / space["slug"]).is_dir())
        stored = self.api.load_spaces()[0]
        self.assertFalse(stored["smb"])

    def test_removing_a_share_obeys_the_same_scope_as_the_rest(self):
        self.api.samba_installed = lambda: True
        person = self.api.create_space(
            {"name": "Someone", "email": "someone@example.test", "role": "Member"}, self.admin
        )
        self.api.set_space_password(person["slug"], "a-long-password", self.admin)
        session = self.api.session_facts(identity(self.member_email))
        with self.assertRaises(PermissionError):
            self.api.remove_share(person["slug"], session)

    # -- appointing and demoting ------------------------------------------

    def test_only_a_platform_admin_may_change_a_role(self):
        session = self.api.session_facts(identity(self.member_email))
        with self.assertRaises(PermissionError):
            self.api.set_space_role("member-one", "Agency admin", session)

    def test_a_platform_admin_appoints_and_demotes_an_agency_admin(self):
        appointed = self.api.set_space_role("member-one", "Agency admin", self.admin)
        self.assertEqual(appointed["role"], "Agency admin")
        self.assertEqual(appointed["agency"], "member-one")
        session = self.api.session_facts(identity(self.member_email))
        self.assertEqual(session["role"], "Agency admin")

        demoted = self.api.set_space_role("member-one", "Member", self.admin)
        self.assertEqual(demoted["role"], "Member")
        self.assertEqual(demoted["agency"], "")
        self.assertEqual(self.api.session_facts(identity(self.member_email))["role"], "Member")

    def test_demoting_an_agency_admin_releases_the_people_under_it(self):
        agency = self.api.create_space(
            {"name": "Agency Lady", "email": "agency@example.test", "role": "Agency admin"},
            self.admin,
        )
        session = self.api.session_facts(identity("agency@example.test"))
        person = self.api.create_space(
            {"name": "Filed Person", "email": "filed@example.test", "role": "Member"}, session
        )
        self.api.set_space_role(agency["slug"], "Member", self.admin)
        stored = {space["slug"]: space for space in self.api.load_spaces()}
        self.assertEqual(stored[person["slug"]]["agency"], "")
        # The folder is untouched; only the filing changed.
        self.assertTrue((self.root / "Users" / person["slug"]).is_dir())

    def test_a_role_payload_cannot_mint_a_platform_admin(self):
        with self.assertRaises(ValueError):
            self.api.set_space_role("member-one", "Platform admin", self.admin)
        self.assertEqual(self.api.load_spaces()[0]["role"], "Member")

    def test_role_changes_are_reported_per_space(self):
        self.api.set_space_role("member-one", "Agency admin", self.admin)
        spaced = {space["slug"]: space for space in self.api.spaces_facts(self.admin)}
        self.assertEqual(spaced["member-one"]["role"], "Agency admin")
        self.assertTrue(spaced["member-one"]["manageable"])

    # -- a person's own space and password --------------------------------

    def test_a_signed_in_person_can_create_their_own_space(self):
        self.api.create_signin = lambda *args, **kwargs: (_ for _ in ()).throw(
            AssertionError("own space must not create a second directory account")
        )
        self.api.directory_ready = lambda: True
        self.api.samba_installed = lambda: True
        person = identity("self@example.test")
        space = self.api.create_own_space(
            person, {"password": "a-long-password"}, self.api.session_facts(person)
        )
        self.assertEqual(space["slug"], "self")
        self.assertEqual(space["email"], "self@example.test")
        self.assertEqual(space["role"], "Member")
        self.assertEqual(space["signin"], "")
        self.assertTrue(space["smb"])
        # Once is the rule for a self-made space, not a way to make a second.
        with self.assertRaises(ValueError):
            self.api.create_own_space(person, {"password": "a-long-password"}, self.admin)

    def test_own_space_needs_an_identity(self):
        with self.assertRaises(PermissionError):
            self.api.create_own_space(None, {"password": "a-long-password"}, self.admin)

    def test_own_password_changes_the_share_and_the_sign_in(self):
        person = identity("self@example.test")
        self.api.samba_installed = lambda: True
        self.api.create_own_space(person, {"password": "a-long-password"}, self.admin)
        self.api.directory_ready = lambda: True
        self.api.directory_user = lambda username: {"pk": 42, "username": username}
        changed = []
        self.api.update_signin_password = lambda username, password: changed.append(
            (username, password)
        )
        result = self.api.change_own_password(person, "another-long-password")
        self.assertTrue(result["share"])
        self.assertTrue(result["signin"])
        self.assertEqual(result["slug"], "self")
        self.assertEqual(changed, [("self", "another-long-password")])

    def test_own_password_needs_a_signed_in_person(self):
        with self.assertRaises(PermissionError):
            self.api.change_own_password(None, "a-long-password")
        with self.assertRaises(ValueError):
            self.api.change_own_password(identity("self@example.test"), "short")

    # -- sign-in provisioning ---------------------------------------------

    def test_a_person_with_an_address_gets_a_sign_in_only_when_configured(self):
        space = self.api.create_space(
            {"name": "Local Only", "email": "local@example.test", "role": "Member"}, self.admin
        )
        self.assertEqual(space["signin"], "")

        calls = []

        def fake_create_signin(username, name, email, password):
            calls.append((username, name, email, password))
            return username

        self.api.directory_ready = lambda: True
        self.api.create_signin = fake_create_signin
        space = self.api.create_space(
            {
                "name": "With Sign In",
                "email": "signin@example.test",
                "role": "Member",
                "password": "a-long-password",
            },
            self.admin,
        )
        self.assertEqual(calls, [("with-sign-in", "With Sign In", "signin@example.test", "a-long-password")])
        self.assertEqual(space["signin"], "with-sign-in")

    def test_a_failed_sign_in_leaves_no_half_created_space(self):
        self.api.directory_ready = lambda: True
        self.api.create_signin = lambda *args, **kwargs: (_ for _ in ()).throw(
            ValueError("the directory refused that change")
        )
        with self.assertRaises(ValueError):
            self.api.create_space(
                {
                    "name": "Doomed",
                    "email": "doomed@example.test",
                    "role": "Member",
                    "password": "a-long-password",
                },
                self.admin,
            )
        self.assertFalse((self.root / "Users" / "doomed").exists())
        self.assertNotIn("doomed", [space["slug"] for space in self.api.load_spaces()])

    def test_an_unexpected_directory_error_still_leaves_no_space_behind(self):
        # The live failure this guards against was an AttributeError inside the
        # client; it escaped the narrow handler and left a folder and a Unix
        # account with no registry entry to match them.
        self.api.directory_ready = lambda: True
        self.api.create_signin = lambda *args, **kwargs: (_ for _ in ()).throw(
            AttributeError("module 'urllib' has no attribute 'request'")
        )
        with self.assertRaises(AttributeError):
            self.api.create_space(
                {
                    "name": "Half Made",
                    "email": "half@example.test",
                    "role": "Member",
                    "password": "a-long-password",
                },
                self.admin,
            )
        self.assertFalse((self.root / "Users" / "half-made").exists())
        self.assertNotIn("half-made", [space["slug"] for space in self.api.load_spaces()])

    def test_removing_a_person_ends_their_sign_in(self):
        disabled = []
        self.api.directory_ready = lambda: True
        self.api.create_signin = lambda username, *args, **kwargs: username
        self.api.disable_signin = lambda username: disabled.append(username)
        space = self.api.create_space(
            {
                "name": "Departing",
                "email": "departing@example.test",
                "role": "Member",
                "password": "a-long-password",
            },
            self.admin,
        )
        self.api.delete_space(space["slug"], self.admin)
        self.assertEqual(disabled, ["departing"])

    def test_the_directory_client_imports_the_modules_it_calls(self):
        # A missing `import urllib.request` is invisible until a real host tries
        # to provision, and then it is a 500 halfway through creating a person.
        self.assertTrue(hasattr(self.api.urllib, "request"))
        self.assertTrue(hasattr(self.api.urllib, "error"))

    def test_create_signin_joins_the_group_through_the_group_endpoint(self):
        calls = []

        def fake_call(path, method="GET", body=None):
            calls.append((method, path, body))
            if path.startswith("/core/groups/?name="):
                return {"results": [{"pk": "group-uuid", "name": "orion-users"}]}
            if path.startswith("/core/users/?username="):
                # An account left behind by an earlier removal.
                return {"results": [{"pk": 99, "username": "orphan"}]}
            if path == "/core/users/":
                return {"pk": 7, "username": "orphan"}
            return {}

        self.api.directory_call = fake_call
        self.assertEqual(self.api.create_signin("orphan", "Orphaned", "o@example.test", "a-long-password"), "orphan")
        methods = [(method, path) for method, path, _ in calls]
        self.assertIn(("DELETE", "/core/users/99/"), methods)
        self.assertIn(("POST", "/core/groups/group-uuid/add_user/"), methods)
        self.assertIn(("POST", "/core/users/7/set_password/"), methods)
        # The credential may not edit users, so nothing here may PATCH one.
        self.assertNotIn("PATCH", [method for method, _ in methods])

    def test_directory_settings_read_the_host_file_and_normalise_the_url(self):
        credentials = self.root / "sso-admin.env"
        credentials.write_text(
            "# written by the installer\nORION_AUTHENTIK_URL=https://id.example.test\n"
            "ORION_AUTHENTIK_TOKEN=not-a-real-token\nORION_AUTHENTIK_GROUP=orion-users\n"
        )
        self.api.DIRECTORY_ENV = credentials
        settings = self.api.directory_settings()
        self.assertEqual(settings["url"], "https://id.example.test/api/v3")
        self.assertEqual(settings["group"], "orion-users")
        self.assertTrue(self.api.directory_ready())


class ShareClientTestCase(unittest.TestCase):
    """What the share dialog may claim about a connection.

    smbstatus only reports sessions that are open right now, so the API also
    remembers the last machine it saw. Both halves are pure data here; the
    daemon is stubbed because a test has no Samba.
    """

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name) / "storage"
        self.root.mkdir()
        self.api = load_api(self.root)
        self.admin = self.api.session_facts(identity("boss@example.test"))
        self.space = self.api.create_space(
            {"name": "Ada Lovelace", "email": "ada@example.test", "role": "Member"}, self.admin
        )
        # create_space writes a folder; the share is what these tests are about.
        spaces = self.api.load_spaces()
        spaces[0]["smb"] = True
        self.api.save_spaces(spaces)
        self.api.samba_installed = lambda: True
        # create_space already asked for the share facts (with no Samba, so
        # nothing), and that answer is cached for a few seconds.
        self.api.CLIENT_CACHE.update({"key": None, "at": 0.0, "value": {}})

    def tearDown(self):
        self.temporary.cleanup()

    def test_both_section_names_samba_has_used_are_read(self):
        modern = self.api.parse_share_sessions(
            {"tcons": {"1": {"service": "Ada Lovelace", "machine": "DESKTOP-7Q4", "connected_at": "2026-10-24T09:15:00"}}}
        )
        legacy = self.api.parse_share_sessions(
            {"shares": {"4242": {"service": "Ada Lovelace", "remote_machine": "DESKTOP-7Q4"}}}
        )
        self.assertEqual(modern[0]["machine"], "DESKTOP-7Q4")
        self.assertEqual(modern[0]["service"], "Ada Lovelace")
        self.assertEqual(legacy[0]["machine"], "DESKTOP-7Q4")
        self.assertEqual(legacy[0]["since"], "")

    def test_an_epoch_connect_time_is_reported_as_a_date(self):
        rows = self.api.parse_share_sessions(
            {"tcons": [{"service": "ada", "machine": "desktop", "connected_at": 1792853712}]}
        )
        self.assertEqual(rows[0]["since"], "2026-10-24T14:55:12Z")

    def test_samba_microseconds_become_milliseconds(self):
        # Safari parses three fractional digits and no more; "Unknown" in the
        # dialog would look like the API had nothing to say.
        rows = self.api.parse_share_sessions(
            {"tcons": [{"service": "ada", "machine": "desktop", "connected_at": "2026-10-24T19:38:21.500101+00:00"}]}
        )
        self.assertEqual(rows[0]["since"], "2026-10-24T19:38:21.500Z")

    def test_the_ipc_connection_is_not_a_share(self):
        rows = self.api.parse_share_sessions(
            {"tcons": [{"service": "IPC$", "machine": "desktop"}, {"service": "ada", "machine": "desktop"}]}
        )
        self.assertEqual([row["service"] for row in rows], ["ada"])

    def test_a_live_session_is_reported_and_remembered(self):
        self.api.smb_status = lambda: {
            "tcons": {
                "1": {"service": "Ada Lovelace", "machine": "DESKTOP-7Q4", "connected_at": "2026-10-24T09:15:00"}
            }
        }
        facts = self.api.space_facts(self.api.load_spaces()[0], 0, self.admin)
        self.assertTrue(facts["smb"])
        self.assertEqual([client["machine"] for client in facts["clients"]], ["DESKTOP-7Q4"])
        self.assertEqual(facts["lastClient"]["machine"], "DESKTOP-7Q4")
        # Written down, so a closed session still says who was here.
        stored = json.loads((self.root / ".orion" / "share-clients.json").read_text())
        self.assertEqual(stored["shares"][self.space["slug"]]["machine"], "DESKTOP-7Q4")

    def test_a_closed_session_keeps_the_last_machine(self):
        self.api.smb_status = lambda: {
            "tcons": {
                "1": {"service": "Ada Lovelace", "machine": "DESKTOP-7Q4", "connected_at": "2026-10-24T09:15:00"}
            }
        }
        self.api.share_client_map(self.api.load_spaces(), ttl=0)
        self.api.smb_status = lambda: {}
        # The map is cached for a few seconds; this is the read after that.
        self.api.CLIENT_CACHE.update({"key": None, "at": 0.0, "value": {}})
        facts = self.api.space_facts(self.api.load_spaces()[0], 0, self.admin)
        self.assertEqual(facts["clients"], [])
        self.assertEqual(facts["lastClient"]["machine"], "DESKTOP-7Q4")

    def test_a_share_without_a_connection_says_so(self):
        self.api.smb_status = lambda: {}
        facts = self.api.space_facts(self.api.load_spaces()[0], 0, self.admin)
        self.assertEqual(facts["clients"], [])
        self.assertIsNone(facts["lastClient"])

    def test_a_space_that_is_not_shared_claims_nothing(self):
        spaces = self.api.load_spaces()
        spaces[0]["smb"] = False
        self.api.save_spaces(spaces)
        self.api.smb_status = lambda: {
            "tcons": {
                "1": {"service": "Ada Lovelace", "machine": "DESKTOP-7Q4", "connected_at": "2026-10-24T09:15:00"}
            }
        }
        facts = self.api.space_facts(self.api.load_spaces()[0], 0, self.admin)
        self.assertEqual(facts["clients"], [])
        self.assertIsNone(facts["lastClient"])

    def test_removing_the_person_forgets_their_machine(self):
        self.api.smb_status = lambda: {
            "tcons": {
                "1": {"service": "Ada Lovelace", "machine": "DESKTOP-7Q4", "connected_at": "2026-10-24T09:15:00"}
            }
        }
        self.api.share_client_map(self.api.load_spaces(), ttl=0)
        self.api.delete_space(self.space["slug"], self.admin)
        stored = self.root / ".orion" / "share-clients.json"
        self.assertEqual(json.loads(stored.read_text())["shares"], {})

    def test_unsharing_forgets_their_machine(self):
        self.api.smb_status = lambda: {
            "tcons": {
                "1": {"service": "Ada Lovelace", "machine": "DESKTOP-7Q4", "connected_at": "2026-10-24T09:15:00"}
            }
        }
        self.api.share_client_map(self.api.load_spaces(), ttl=0)
        self.api.smb_status = lambda: {}
        self.api.remove_share(self.space["slug"], self.admin)
        stored = self.root / ".orion" / "share-clients.json"
        self.assertEqual(json.loads(stored.read_text())["shares"], {})


if __name__ == "__main__":
    unittest.main()
