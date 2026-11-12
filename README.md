# FIRST Dashboard+

A browser extension for the FIRST Dashboard (`https://my.firstinspires.org/Dashboard/`), in the same shape as VMS+:
a Manifest V3 content script that runs in your own signed-in session. Nothing is saved and nothing is sent anywhere
except `my.firstinspires.org`.

- `dashboard-plus/` — the extension (load this folder in Chrome).
- `FINDINGS.md` — what was learned about the Dashboard: pages, server calls, data shapes, bugs, speed.

## Install

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. **Load unpacked** → choose the `dashboard-plus` folder.
4. Reload the Dashboard tab.

After editing a file, press the reload arrow on the extension's card, then reload the Dashboard tab.

## What v0.1 does

| Feature | Where | Tested how |
| --- | --- | --- |
| Lists the real reason behind each "Outstanding Task(s)" / "Pending Roster Task" badge, one line per cause, with a **Fix** button that opens the page where it is fixed | Team list on the Dashboard home | Run against the live Dashboard. Reasons appear for every team, survive sorting, and Fix opened the right page on a test team. |
| Checkboxes sit beside their labels instead of above them | Team page → Team Information → Communication & Mentoring (and every other checkbox of that kind) | Run against the live page. |
| The blue reason tooltip above the first tab is no longer cut off at the left | Team page | Run against the live page. |
| Team list tidy-up (v0.2.2): "Outstanding Task(s)" and "Pending Roster Task" become one red badge with a count ("3 TASKS"; "Event Ready" unchanged); each reason is one aligned row (reason and tag, then a one-line "Holds up" list cut off with "…" and shown in full on hover, then a right-aligned Fix button); the "Participating Team" column no longer runs past the table edge | Dashboard home | Run against the live Dashboard at 1278px wide. |
| Sidebar buttons for each persona (Team, Event Volunteer, Parent/Guardian, Class Pack) under "Dashboard", so there is no need to go through Switch Persona. Personas with nothing in them are hidden; the one you are on always shows, and Parent/Guardian always shows for under-18s. Works with the sidebar collapsed. (v0.2.0) **More…** (v0.3.0) replaces the site's Switch Persona link: it appears only when something is hidden and reveals the empty personas (where "Add a Youth" and "Create an Account" live); an empty persona you open goes back under More… when you leave it. The last result is remembered in this browser (just empty yes/no per persona), so the sidebar is right as soon as the page opens and is re-checked in the background (v0.3.1). | Dashboard sidebar | Run against the live Dashboard: Parent/Guardian and Class Pack hidden as empty; Team and Event Volunteer switch correctly, including from an open team page; More… opened Parent/Guardian and Add a Youth was there. |
| After pressing **Fix**, an "Opening the page…" message with a timer shows until the page arrives, instead of a blank screen (v0.1.2) | Dashboard home | Message checked on the live Dashboard; its removal was checked with a simulated page load, since the real page did not arrive during the outage. |
| The older roster wizard no longer shows its "Create New Team" header and step bar twice (v0.1.1) | `/Teams/Wizard/TeamContacts/…` (Contacts, Printable Roster) | Rule applied by hand to a real team's pages, read-only. Not yet seen through the installed extension. |
| **Roster at a glance**: counts of coaches/mentors, accepted youth, people waiting for a decision, people without Consent & Release, incomplete screening, incomplete training | Team page → Team Roster | Run against the live page on a test team (one person on the roster). |
| **Accept applicants…**: lists every youth and mentor applicant with a tick box, then accepts the ticked ones one after another and reloads the roster once | Team page → Team Roster | **Dry run only.** Made-up applicants, with the network call intercepted. The requests it builds match the site's own code. It has not accepted a real applicant yet. |
| **Send C&R reminders…**: lists everyone without Consent & Release, then sends the site's standard reminder to the ticked ones. Coaches, mentors and mentor applicants are ticked by default; parents of youth are listed but not ticked. People with no email on file are shown and skipped. | Team page → Team Roster | Panel: **dry run only**, same as above. The server call behind it was sent once for real on a test team (to the signed-in coach's own address) and the site answered `true`. |

Both write tools show the full list first and do nothing until the button is pressed. Requests go out one at a time
with a short pause. A run can be stopped part-way.

## Not tested yet, and why

- **A real accept.** None of the three test teams has an applicant, and they cannot show youth at all until they have
  two Lead Coaches who have passed screening. To test: have a spare account apply to a test team as a mentor, then use
  "Accept applicants…".
- **A real reminder sent from the panel.** The server call works (one was sent by hand on a test team), but the panel
  only lists people without Consent & Release on record, and no test team has one. Whether that one email arrived
  has not been confirmed either.
- **Installed as an extension.** All testing was done by running these exact files inside the live pages. Loading
  the folder through `chrome://extensions` has not been done yet (it has to be done by hand).
- **A large roster.** A large real team's roster data was read once to learn its shape, but the panel itself has not
  been opened on a large roster.

## Limits

- The roster for a big team takes the server close to a minute to produce. Dashboard+ avoids asking for it more than
  once but cannot make that first load faster.
- Inviting people is not automated: the site puts a reCAPTCHA on it.
- The Mentor Network Terms of Use embedded in the Dashboard forbid automated use of that part of the site.
  Dashboard+ does nothing there, and elsewhere only acts on a click.
