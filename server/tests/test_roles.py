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
        # Name resolution shells out to nmblookup and getent; a unit test has
        # neither, so the runner they go through answers nothing. The lookup
        # itself is exercised in MachineNameTestCase.
        self.api.run_root = lambda *args, **kwargs: ""
        self.api.MACHINE_NAMES.clear()
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

    def test_a_client_is_called_by_its_name_and_keeps_its_address(self):
        self.api.machine_name = lambda address, labels=None: (
            "DESKTOP-7Q4" if address == "192.168.1.20" else ""
        )
        self.api.smb_status = lambda: {
            "tcons": {
                "1": {"service": "Ada Lovelace", "machine": "192.168.1.20", "connected_at": "2026-10-24T09:15:00"}
            }
        }
        facts = self.api.space_facts(self.api.load_spaces()[0], 0, self.admin)
        self.assertEqual(facts["clients"][0]["machine"], "DESKTOP-7Q4")
        self.assertEqual(facts["clients"][0]["address"], "192.168.1.20")
        self.assertEqual(facts["lastClient"]["machine"], "DESKTOP-7Q4")

    def test_a_client_without_a_name_keeps_its_address(self):
        self.api.smb_status = lambda: {
            "tcons": {
                "1": {"service": "Ada Lovelace", "machine": "fe80::3309:3fb0", "connected_at": "2026-10-24T09:15:00"}
            }
        }
        facts = self.api.space_facts(self.api.load_spaces()[0], 0, self.admin)
        self.assertEqual(facts["clients"][0]["machine"], "fe80::3309:3fb0")

    def test_the_notice_uses_the_name_and_quotes_the_address(self):
        self.api.machine_name = lambda address, labels=None: (
            "DESKTOP-7Q4" if address == "192.168.1.20" else ""
        )
        self.api.smb_status = lambda: {
            "tcons": {
                "1": {"service": "Ada Lovelace", "machine": "192.168.1.20", "connected_at": "2026-10-24T09:15:00"}
            }
        }
        self.api.share_client_map(self.api.load_spaces(), ttl=0)
        notice = self.api.share_notices()[0]
        self.assertEqual(notice["title"], "DESKTOP-7Q4 connected to Ada Lovelace")
        self.assertIn("192.168.1.20", notice["body"])

    def test_a_new_machine_is_noticed_once_and_named(self):
        self.api.smb_status = lambda: {
            "tcons": {
                "1": {"service": "Ada Lovelace", "machine": "DESKTOP-7Q4", "connected_at": "2026-10-24T09:15:00"}
            }
        }
        self.api.share_client_map(self.api.load_spaces(), ttl=0)
        notices = self.api.share_notices()
        self.assertEqual(len(notices), 1)
        self.assertIn("DESKTOP-7Q4", notices[0]["title"])
        self.assertIn("Ada Lovelace", notices[0]["title"])
        self.assertEqual(notices[0]["action"]["path"], f"/Users/{self.space['slug']}")
        self.assertEqual(notices[0]["tone"], "success")
        # The same session, read again, is not a second connection.
        self.api.CLIENT_CACHE.update({"key": None, "at": 0.0, "value": {}})
        self.api.share_client_map(self.api.load_spaces(), ttl=0)
        self.assertEqual(len(self.api.share_notices()), 1)
        stored = json.loads((self.root / ".orion" / "share-clients.json").read_text())
        self.assertEqual(len(stored["machines"][self.space["slug"]]), 1)

    def test_a_connection_from_last_week_is_not_news(self):
        self.api.smb_status = lambda: {
            "tcons": {
                "1": {"service": "Ada Lovelace", "machine": "DESKTOP-7Q4", "connected_at": "2026-10-24T09:15:00"}
            }
        }
        self.api.share_client_map(self.api.load_spaces(), ttl=0)
        stored = json.loads((self.root / ".orion" / "share-clients.json").read_text())
        stored["machines"][self.space["slug"]]["DESKTOP-7Q4"] -= 8 * 24 * 3600
        (self.root / ".orion" / "share-clients.json").write_text(json.dumps(stored))
        self.assertEqual(self.api.share_notices(), [])

    def test_a_notice_for_a_share_that_is_gone_is_dropped(self):
        self.api.smb_status = lambda: {
            "tcons": {
                "1": {"service": "Ada Lovelace", "machine": "DESKTOP-7Q4", "connected_at": "2026-10-24T09:15:00"}
            }
        }
        self.api.share_client_map(self.api.load_spaces(), ttl=0)
        self.api.delete_space(self.space["slug"], self.admin)
        self.assertEqual(self.api.share_notices(), [])

    def test_removing_the_person_forgets_their_machine(self):
        self.api.smb_status = lambda: {
            "tcons": {
                "1": {"service": "Ada Lovelace", "machine": "DESKTOP-7Q4", "connected_at": "2026-10-24T09:15:00"}
            }
        }
        self.api.share_client_map(self.api.load_spaces(), ttl=0)
        self.api.delete_space(self.space["slug"], self.admin)
        stored = self.root / ".orion" / "share-clients.json"
        saved = json.loads(stored.read_text())
        self.assertEqual(saved["shares"], {})
        self.assertEqual(saved["machines"], {})

    # -- naming a client --------------------------------------------------

    def _connected(self, machine="fe80::3309:3fb0:b346:87d6"):
        self.api.smb_status = lambda: {
            "tcons": {
                "1": {
                    "service": "Ada Lovelace",
                    "machine": machine,
                    "connected_at": "2026-10-24T09:15:00",
                }
            }
        }

    def test_an_admin_can_name_a_client_the_resolver_cannot(self):
        self._connected()
        facts = self.api.space_facts(self.api.load_spaces()[0], 0, self.admin)
        self.assertEqual(facts["clients"][0]["machine"], "fe80::3309:3fb0:b346:87d6")
        named = self.api.set_share_client_label(
            "fe80::3309:3fb0:b346:87d6", "  Kitchen   tablet ", self.admin
        )
        self.assertEqual(named["name"], "Kitchen tablet")
        self.api.CLIENT_CACHE.update({"key": None, "at": 0.0, "value": {}})
        facts = self.api.space_facts(self.api.load_spaces()[0], 0, self.admin)
        self.assertEqual(facts["clients"][0]["machine"], "Kitchen tablet")
        # The address stays with it: a name that cannot be traced is no better
        # than the address it replaced.
        self.assertEqual(facts["clients"][0]["address"], "fe80::3309:3fb0:b346:87d6")
        self.assertEqual(facts["clients"][0]["label"], "Kitchen tablet")

    def test_the_name_is_on_the_notice_too(self):
        self._connected()
        self.api.set_share_client_label("fe80::3309:3fb0:b346:87d6", "Kitchen tablet", self.admin)
        self.api.share_client_map(self.api.load_spaces(), ttl=0)
        notice = self.api.share_notices()[0]
        self.assertEqual(notice["title"], "Kitchen tablet connected to Ada Lovelace")
        self.assertIn("fe80::3309:3fb0:b346:87d6", notice["body"])

    def test_a_name_survives_a_closed_session(self):
        self._connected("192.168.1.20")
        # Read once while the session is open, so the machine is remembered.
        self.api.space_facts(self.api.load_spaces()[0], 0, self.admin)
        self.api.set_share_client_label("192.168.1.20", "Studio PC", self.admin)
        self.api.smb_status = lambda: {}
        self.api.CLIENT_CACHE.update({"key": None, "at": 0.0, "value": {}})
        facts = self.api.space_facts(self.api.load_spaces()[0], 0, self.admin)
        self.assertEqual(facts["clients"], [])
        self.assertEqual(facts["lastClient"]["machine"], "Studio PC")
        # The remembered machine carries the label too, or a closed session
        # would offer to name a machine that already has a name.
        self.assertEqual(facts["lastClient"]["label"], "Studio PC")
        stored = json.loads((self.root / ".orion" / "share-clients.json").read_text())
        self.assertEqual(stored["labels"]["192.168.1.20"], "Studio PC")

    def test_clearing_the_name_goes_back_to_the_address(self):
        self._connected()
        self.api.set_share_client_label("fe80::3309:3fb0:b346:87d6", "Kitchen tablet", self.admin)
        cleared = self.api.set_share_client_label("fe80::3309:3fb0:b346:87d6", "", self.admin)
        self.assertEqual(cleared["name"], "fe80::3309:3fb0:b346:87d6")
        self.api.CLIENT_CACHE.update({"key": None, "at": 0.0, "value": {}})
        facts = self.api.space_facts(self.api.load_spaces()[0], 0, self.admin)
        self.assertEqual(facts["clients"][0]["machine"], "fe80::3309:3fb0:b346:87d6")
        self.assertEqual(facts["clients"][0]["label"], "")
        stored = json.loads((self.root / ".orion" / "share-clients.json").read_text())
        self.assertEqual(stored["labels"], {})

    def test_a_member_cannot_name_a_client(self):
        self._connected()
        member = self.api.session_facts(identity("ada@example.test"))
        with self.assertRaises(PermissionError):
            self.api.set_share_client_label("fe80::3309:3fb0:b346:87d6", "Mine now", member)
        self.assertEqual(self.api.load_share_registry()["labels"], {})

    def test_an_agency_admin_names_only_machines_on_its_own_shares(self):
        self._connected("192.168.1.20")
        agency = self.api.create_space(
            {"name": "Agency Lady", "email": "agency@example.test", "role": "Agency admin"},
            self.admin,
        )
        session = self.api.session_facts(identity("agency@example.test"))
        # This client is on Ada's share, which is filed under nobody.
        with self.assertRaises(PermissionError):
            self.api.set_share_client_label("192.168.1.20", "Not mine", session)
        person = self.api.create_space(
            {"name": "Filed Person", "email": "filed@example.test", "role": "Member", "agency": agency["slug"]},
            session,
        )
        spaces = self.api.load_spaces()
        for space in spaces:
            space["smb"] = True
        self.api.save_spaces(spaces)
        self.api.smb_status = lambda: {
            "tcons": {
                "1": {"service": person["name"], "machine": "192.168.1.30", "connected_at": "2026-10-24T09:15:00"}
            }
        }
        self.api.CLIENT_CACHE.update({"key": None, "at": 0.0, "value": {}})
        self.assertEqual(
            self.api.set_share_client_label("192.168.1.30", "Reception", session)["name"],
            "Reception",
        )

    def test_an_address_that_could_not_be_one_is_refused(self):
        self._connected()
        for address in ("", "../etc/passwd", "x" * 65):
            with self.assertRaises(ValueError):
                self.api.set_share_client_label(address, "Kitchen tablet", self.admin)

    def test_a_name_that_is_too_long_is_refused(self):
        self._connected()
        with self.assertRaises(ValueError):
            self.api.set_share_client_label("192.168.1.20", "x" * 41, self.admin)

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
        saved = json.loads(stored.read_text())
        self.assertEqual(saved["shares"], {})
        self.assertEqual(saved["machines"], {})


class MachineNameTestCase(unittest.TestCase):
    """Turning an address into something a person recognises."""

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name) / "storage"
        self.root.mkdir()
        self.api = load_api(self.root)
        self.api.MACHINE_NAMES.clear()

    def tearDown(self):
        self.temporary.cleanup()

    def test_the_netbios_name_wins_and_this_server_is_ignored(self):
        self.api.run_root = lambda *args, **kwargs: (
            "Looking up status of 192.168.1.20\n"
            "\tDESKTOP-7Q4     <00> -         B <ACTIVE>\n"
            "\tWORKGROUP       <00> - <GROUP> B <ACTIVE>\n"
            "\tORION-NAS       <00> -         B <ACTIVE>\n"
        )
        self.assertEqual(self.api.netbios_name("192.168.1.20"), "DESKTOP-7Q4")

    def test_the_zero_address_fallback_is_not_a_name(self):
        # nmblookup answers for 0.0.0.0 when it cannot parse the address, and
        # that reply is this server talking about itself.
        self.api.run_root = lambda *args, **kwargs: (
            "Looking up status of 0.0.0.0\n\tORION-NAS       <00> -         B <ACTIVE>\n"
        )
        self.assertEqual(self.api.netbios_name("192.168.1.20"), "")

    def test_this_server_never_names_a_client(self):
        # Loopback and the box's own address answer with its own aliases.
        self.api.run_root = lambda *args, **kwargs: (
            "Looking up status of 127.0.0.1\n"
            "\tORION-NAS       <00> -         B <ACTIVE>\n"
            "\tNAS             <00> -         B <ACTIVE>\n"
        )
        self.assertEqual(self.api.netbios_name("127.0.0.1"), "")

    def test_the_local_alias_is_not_a_client_name(self):
        self.api.run_root = lambda *args, **kwargs: (
            "Looking up status of 127.0.0.1\n"
            "\tORION-NAS       <00> -         B <ACTIVE>\n"
            "\tORION-NAS.LOCAL <00> -         B <ACTIVE>\n"
        )
        self.assertEqual(self.api.netbios_name("127.0.0.1"), "")

    def test_a_lookup_cannot_wait_ten_seconds(self):
        commands = []
        self.api.run_root = lambda script, **kwargs: commands.append(script) or ""
        self.api.machine_name("192.168.1.71")
        self.assertTrue(all(call.startswith("timeout 2 ") for call in commands), commands)

    def test_ipv6_is_never_asked_of_netbios(self):
        asked = []
        self.api.run_root = lambda script, **kwargs: asked.append(script) or ""
        self.api.machine_name("fe80::3309:3fb0:b346:87d6")
        self.assertFalse([call for call in asked if "nmblookup" in call])

    def test_the_resolver_is_the_fallback(self):
        self.api.run_root = lambda script, **kwargs: (
            "192.168.1.20\tdesktop-7q4.local\n" if "getent" in script else ""
        )
        self.assertEqual(self.api.machine_name("192.168.1.20"), "desktop-7q4.local")

    def test_an_admins_name_is_used_before_anything_is_looked_up(self):
        asked = []
        self.api.run_root = lambda script, **kwargs: asked.append(script) or ""
        self.api.save_share_registry(
            {"shares": {}, "machines": {}, "labels": {"fe80::1": "Kitchen tablet"}}
        )
        self.assertEqual(self.api.machine_name("fe80::1"), "Kitchen tablet")
        self.assertEqual(asked, [])

    def test_a_lookup_is_remembered(self):
        calls = []
        self.api.netbios_name = lambda address: calls.append(address) or "DESKTOP-7Q4"
        self.api.machine_name("192.168.1.20")
        self.api.machine_name("192.168.1.20")
        self.assertEqual(calls, ["192.168.1.20"])


class SharedSpaceTestCase(unittest.TestCase):
    """A household share: every account may mount it, and it has an address.

    Samba itself is stubbed here — what is asserted is the export this app
    writes, the registry it keeps, and who is allowed to change either.
    """

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name) / "storage"
        self.root.mkdir()
        self.api = load_api(self.root)
        self.admin = self.api.session_facts(identity("boss@example.test"))
        self.household = self.api.create_space(
            {"name": "Household", "email": "", "role": "Member"}, self.admin
        )
        self.person = self.api.create_space(
            {"name": "Ada Lovelace", "email": "ada@example.test", "role": "Member"}, self.admin
        )
        # create_space only makes a share when it is given a password; these
        # tests are about what happens to a share that exists.
        spaces = self.api.load_spaces()
        for space in spaces:
            space["smb"] = True
        self.api.save_spaces(spaces)

    def tearDown(self):
        self.temporary.cleanup()

    def _section(self, label):
        conf = self.api.render_smb_conf(self.api.load_spaces())
        self.assertIn(f"[{label}]", conf)
        return conf.split(f"[{label}]")[1].split("\n[")[0]

    def _space(self, slug):
        return next(space for space in self.api.load_spaces() if space["slug"] == slug)

    # -- who may mount it --------------------------------------------------

    def test_a_private_share_admits_only_its_owner(self):
        section = self._section("Household")
        self.assertIn("valid users = household", section)
        self.assertNotIn("@orion-nas", section)
        self.assertNotIn("force group", section)

    def test_a_shared_share_admits_every_account(self):
        facts = self.api.set_space_shared("household", True, self.admin)
        self.assertTrue(facts["shared"])
        section = self._section("Household")
        self.assertIn("valid users = @orion-nas", section)
        # Files created by one member must not become theirs alone.
        self.assertIn("force group = orion-nas", section)
        self.assertIn("directory mask = 2770", section)
        # The other person's share is untouched.
        self.assertIn("valid users = ada", self._section("Ada Lovelace"))

    def test_the_folder_joins_the_group_so_it_can_be_written(self):
        commands = []
        self.api.samba_installed = lambda: True
        self.api.run_root = lambda script, **kwargs: commands.append(script) or ""
        self.api.set_space_shared("household", True, self.admin)
        joined = "\n".join(commands)
        self.assertIn("chgrp -R orion-nas", joined)
        self.assertIn("chmod -R g+rwX", joined)
        self.assertIn("-exec chmod g+s", joined)

    def test_closing_it_returns_the_share_to_its_owner(self):
        self.api.set_space_shared("household", True, self.admin)
        facts = self.api.set_space_shared("household", False, self.admin)
        self.assertFalse(facts["shared"])
        self.assertIn("valid users = household", self._section("Household"))

    def test_everyone_needs_a_share_to_join(self):
        spaces = self.api.load_spaces()
        for space in spaces:
            if space["slug"] == "household":
                space["smb"] = False
        self.api.save_spaces(spaces)
        with self.assertRaises(ValueError):
            self.api.set_space_shared("household", True, self.admin)
        self.assertFalse(self._space("household").get("shared"))

    def test_removing_the_share_also_ends_everyones_access(self):
        self.api.set_space_shared("household", True, self.admin)
        facts = self.api.remove_share("household", self.admin)
        self.assertFalse(facts["shared"])
        self.assertFalse(facts["smb"])

    def test_a_member_cannot_open_a_share_to_everyone(self):
        session = self.api.session_facts(identity("ada@example.test"))
        with self.assertRaises(PermissionError):
            self.api.set_space_shared("household", True, session)
        self.assertFalse(self._space("household").get("shared"))

    def test_an_agency_admin_cannot_open_someone_elses_share(self):
        self.api.create_space(
            {"name": "Agency", "email": "agency@example.test", "role": "Agency admin"},
            self.admin,
        )
        session = self.api.session_facts(identity("agency@example.test"))
        with self.assertRaises(PermissionError):
            self.api.set_space_shared("household", True, session)

    # -- the address -------------------------------------------------------

    def test_a_shared_space_takes_an_address(self):
        facts = self.api.set_space_email("household", "Household@Example.Test", self.admin)
        self.assertEqual(facts["email"], "household@example.test")
        stored = json.loads((self.root / ".orion" / "spaces.json").read_text())
        self.assertEqual(stored["spaces"][0]["email"], "household@example.test")

    def test_a_shared_address_is_not_somebodys_personal_space(self):
        self.api.set_space_shared("household", True, self.admin)
        self.api.set_space_email("household", "household@example.test", self.admin)
        # Otherwise signing in with the household mailbox would claim the share.
        self.assertIsNone(self.api.space_by_email("household@example.test"))
        self.assertEqual(self.api.space_by_email("ada@example.test")["slug"], self.person["slug"])

    def test_an_address_can_be_cleared(self):
        self.api.set_space_email("household", "household@example.test", self.admin)
        self.assertEqual(self.api.set_space_email("household", "", self.admin)["email"], "")

    def test_an_address_must_look_like_one(self):
        for bad in ("not-an-address", "two words@example.test", "a@b"):
            with self.assertRaises(ValueError):
                self.api.set_space_email("household", bad, self.admin)

    def test_an_address_belongs_to_only_one_space(self):
        with self.assertRaises(ValueError):
            self.api.set_space_email("household", "ada@example.test", self.admin)

    def test_a_member_cannot_set_an_address(self):
        session = self.api.session_facts(identity("ada@example.test"))
        with self.assertRaises(PermissionError):
            self.api.set_space_email("household", "other@example.test", session)
        self.assertEqual(self._space("household").get("email", ""), "")


class TrashTestCase(unittest.TestCase):
    """Deletes are recoverable: the trash lists, restores and empties."""

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name) / "storage"
        self.root.mkdir()
        self.api = load_api(self.root)
        (self.root / "media").mkdir()
        (self.root / "media" / "notes.txt").write_text("hello")
        (self.root / "Users" / "ada").mkdir(parents=True)
        (self.root / "Users" / "ada" / "notes.txt").write_text("ada's")

    def tearDown(self):
        self.temporary.cleanup()

    def _trash(self):
        return self.api.trash_facts()["items"]

    def test_a_delete_remembers_where_the_file_was(self):
        self.assertEqual(self.api.move_to_trash(["/media/notes.txt"]), 1)
        item = self._trash()[0]
        self.assertEqual(item["name"], "notes.txt")
        self.assertEqual(item["original"], "/media/notes.txt")
        self.assertEqual(item["type"], "file")
        self.assertTrue(item["deletedAt"])
        self.assertFalse((self.root / "media" / "notes.txt").exists())

    def test_two_files_with_the_same_name_keep_their_own_origin(self):
        self.api.move_to_trash(["/media/notes.txt", "/Users/ada/notes.txt"])
        items = self._trash()
        self.assertEqual(len(items), 2)
        # The second one could not keep its name in the trash, so the stored
        # name differs — and each still points at the folder it came from.
        self.assertEqual(len({item["name"] for item in items}), 2)
        self.assertEqual(
            sorted(item["original"] for item in items),
            ["/Users/ada/notes.txt", "/media/notes.txt"],
        )

    def test_restore_puts_it_back_where_it_was(self):
        self.api.move_to_trash(["/media/notes.txt"])
        name = self._trash()[0]["name"]
        restored = self.api.restore_from_trash(name)
        self.assertEqual(restored["path"], "/media/notes.txt")
        self.assertEqual((self.root / "media" / "notes.txt").read_text(), "hello")
        self.assertEqual(self._trash(), [])

    def test_restore_does_not_overwrite_something_new(self):
        self.api.move_to_trash(["/media/notes.txt"])
        (self.root / "media" / "notes.txt").write_text("newer")
        name = self._trash()[0]["name"]
        restored = self.api.restore_from_trash(name)
        self.assertNotEqual(restored["path"], "/media/notes.txt")
        self.assertEqual((self.root / "media" / "notes.txt").read_text(), "newer")
        self.assertEqual(Path(self.root / restored["path"].lstrip("/")).read_text(), "hello")

    def test_restore_refuses_when_the_folder_is_gone(self):
        self.api.move_to_trash(["/media/notes.txt"])
        name = self._trash()[0]["name"]
        (self.root / "media").rmdir()
        with self.assertRaises(ValueError):
            self.api.restore_from_trash(name)
        self.assertEqual(len(self._trash()), 1)

    def test_restore_of_an_item_that_is_gone_is_a_miss(self):
        with self.assertRaises(LookupError):
            self.api.restore_from_trash("nothing-here.txt")

    def test_an_item_placed_by_hand_still_appears(self):
        (self.root / ".orion" / "trash").mkdir(parents=True)
        (self.root / ".orion" / "trash" / "stray.txt").write_text("x")
        item = self._trash()[0]
        self.assertEqual(item["name"], "stray.txt")
        self.assertEqual(item["original"], "")
        # With no recorded origin it goes back to the root rather than nowhere.
        self.assertEqual(self.api.restore_from_trash("stray.txt")["path"], "/stray.txt")

    def test_a_pruned_entry_does_not_linger(self):
        self.api.move_to_trash(["/media/notes.txt"])
        (self.root / ".orion" / "trash" / "notes.txt").unlink()
        self.assertEqual(self._trash(), [])
        stored = json.loads((self.root / ".orion" / "trash.json").read_text())
        self.assertEqual(stored["entries"], {})

    def test_empty_trash_unlinks_everything(self):
        (self.root / "media" / "folder").mkdir()
        (self.root / "media" / "folder" / "inner.txt").write_text("x")
        self.api.move_to_trash(["/media/notes.txt", "/media/folder"])
        self.assertEqual(self.api.trash_count(), 2)
        self.assertEqual(self.api.empty_trash(), 2)
        self.assertEqual(self.api.trash_count(), 0)
        self.assertEqual(self._trash(), [])
        self.assertFalse((self.root / ".orion" / "trash" / "folder").exists())
        self.assertEqual(json.loads((self.root / ".orion" / "trash.json").read_text())["entries"], {})

    def test_the_count_is_what_the_listing_shows(self):
        self.api.move_to_trash(["/media/notes.txt"])
        self.assertEqual(self.api.trash_count(), len(self._trash()))


if __name__ == "__main__":
    unittest.main()
