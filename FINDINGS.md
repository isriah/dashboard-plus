# Dashboard+ findings

Running notes from exploring the FIRST Dashboard (`https://my.firstinspires.org/Dashboard/`) to plan a
browser extension in the same shape as VMS+ (a Manifest V3 content script that uses the signed-in session).

Explored on 2026-11-12 with three test teams that could be changed (called **test team A** (FRC), **B** (FTC) and **C** (FLL Challenge) below)
and two real teams that were only read (**a large real team** (FRC, about 110 people) and **a second real team** (FTC)). Team numbers,
names and people are deliberately left out of these notes.

Status key: **Verified** = seen in the live site or its source. **Guess** = inferred, not yet confirmed.

---

## 1. How the site is put together

| Fact | Status |
| --- | --- |
| Server-rendered ASP.NET MVC site. Front end is jQuery 1.9.1 + Bootstrap 3 + Handlebars templates. No SPA framework. | Verified |
| The Dashboard home is one page that holds four "apps" at once: `TeamsApp`, `VolunteersApp`, `StudentsApp` (Parent/Guardian), `ClassPackApp`. Only one is shown; "Switch Persona" toggles which. The choice is kept in `localStorage.SelectedApp`. | Verified |
| The page ships about 240,000 characters of inline script and Handlebars templates, plus roughly 25 hidden modal dialogs. One of them is the entire FIRST Mentor Network Terms of Use. | Verified |
| Dashboard scripts: `/Dashboard/Scripts/dashboard/{dashboard,teams,volunteer,students,accounts,dropdown,sidebar}.js`. They are small (2k to 29k characters each) and not minified, so they are easy to read. | Verified |
| Clicking a team row calls `LoadUrl(row.dataset.url)`. The team's pages live in a separate app at `/Teams//Wizard/EditTeam?TeamProfileID=<id>` and are shown inside an iframe on the Dashboard (`LoadApplicationInIframe`). | Verified (iframe part still to be looked at) |
| Other apps on the same host: `/Teams/` (team wizard), `/Profile/` (account, youth protection, training), `/Volunteers/` (event volunteering), `/VMS/` (covered by VMS+). | Verified |

### Identifiers

- `fk_team_profiles` (also `TeamProfileID`): the per-season team record. This is the id every team call uses. It is **not** the team number.
- `TeamCode`: the team number as text (`"1234"`).
- `fk_people` / `UID`: the signed-in person's id. It is embedded in many sidebar links.
- `Role`: the signed-in person's role on that team: `coach-1`, `coach-2`, `team_admin`, `youth_member`, `awards_submitter`, `youth_awards_submitter`, `account_admin`, `account_teacher`. Only `coach-1`, `coach-2` and `team_admin` get working task links.

### Personas

Verified. "Switch Persona" (`#role-select`) shows the "Choose Your Role" cards (`.get-role-selection > div[data-application]`). Clicking a card runs the site's handler in `sidebar.js`: it stores `SelectedApp` in `localStorage`, hides `#appFrame` and every persona, and calls `ShowApp(app)`. Dashboard+ v0.2.0 adds sidebar buttons that trigger that same card click.

What each persona's data looks like (reads, all `POST /Dashboard/Dashboard/<action>`):

| Persona | Call | Empty when | Time |
| --- | --- | --- | --- |
| Team (`TeamsApp`) | `GetMoreTeams` | `TotalRecord` 0 | 0.2 s |
| Event Volunteer (`VolunteersApp`) | `getVolunteer` | `Volunteer.EventDetails` empty | 2 s |
| Parent/Guardian (`StudentsApp`) | `getStudents` | `Students` empty (but under-18s use this persona to invite a parent) | 0.3 s |
| Class Pack (`ClassPackApp`) | `getAccounts` (`pageNumber`, `sortBy`, `isReturningAccount`) | `TotalRecord` 0 | 0.8 s |

Oddity: `getStudents` replies `IsMinor: true` for an adult account (26), while `GetMoreTeams` says `false`. Dashboard+ takes "under 18" from `GetMoreTeams`.

Note: `navItemClicked` handles every `#sidebar a`, so the Dashboard+ buttons are not `<a>` elements; otherwise the site's handler would hide everything right after the switch.

## 2. Server calls found so far

All Dashboard calls are `POST /Dashboard/Dashboard/<Action>` with a form-encoded body and a JSON reply. No anti-forgery token is sent by the site's own code.

| Action | Body | What it returns | Status |
| --- | --- | --- | --- |
| `GetMoreTeams` | `pageNumber`, `sortBy` (`team_number`…), `programCode`, `isReturningTeam` | The team list **with every outstanding task spelled out** (see section 3). Also `TotalRecord`, `Events`, `Validation` (flat list of all tasks), `Age`, `IsMinor`. | Verified |
| `GetProgramList` (GET) | none | Program filter options. | Verified in source |
| `GenerateNotificationResolutionURL` | `ID` (= task's `fk_wizard_steps`), `TeamProfileID` | `{ Url }`: the page that fixes that task. | Verified in source |
| `GetEventDetails` | `Id`, `TeamProfileID` | Event details for the modal. | Verified in source |
| `WithdrawTeamApplication` | `id`, `userid` | Youth withdraws their own application. | Verified in source |
| `getVolunteer`, `getStudents`, `getAccounts` | none / paging | Data for the other three personas. | Verified in source |
| `GetActionLinks` | none | Per-role action links. The site's own code has this call commented out: "New UI has no dropdown to bind actions link. Disabling it for now." | Verified in source |

## 3. What "Outstanding Task(s)" and "Pending Roster Task" really mean

**Verified.** The badges on the team list are driven by flags in the `GetMoreTeams` reply, and the same reply already holds the
specific reason. The current UI just does not show it.

Per team the reply has:

- `FlagHasTask` → the red **OUTSTANDING TASK(S)** badge.
- `FlagRosterTask` → the red **PENDING ROSTER TASK** badge. Set when `RosterTasks` is not empty.
- `FlagEventsTask`, `FlagBalancesTask` → no badge of their own in the new UI.
- `TeamTasks`: a list of groups, one group per underlying problem. Each group repeats the same problem once for every part of the site it blocks.
- `RosterTasks`, `EventsTasks`, `BalancesTasks`: the same problems filtered by area.

Each task entry looks like this:

```
Issue_key           the real cause, e.g. val_team_pending_applications
Topic_key           the area of the site it blocks, e.g. team_contacts, team_events
OriginalTopicKey    the area where the problem lives
TopicLocalizedText  human sentence (sometimes an untranslated key, see section 6)
Localization        second sentence (often an untranslated key)
rec_clue            "FRC Team 1234"
fk_wizard_steps     id used to ask the server for the "fix it" page
```

The distinct `Issue_key` is the thing worth showing. Seen so far:

| `Issue_key` | Plain meaning | Seen on |
| --- | --- | --- |
| `val_team_pending_applications` | Someone has applied to join the team and is waiting for a decision. This is what "Pending Roster Task" meant for the large real team. | large real team |
| `val_team_not_registered` | Season registration is not paid ("Please review your team for missing payment."). | second real team, test teams B, C |
| `val_team_nickname_too_long` | The team nickname is longer than allowed. Blocks profile, payment, events, kit, awards. | test team A |
| `val_coach-2_missing` | There is no second Lead Coach/Mentor, or their profile is incomplete. | test teams A, B, C |
| `val_team_not_2leadcoaches_screened` | Two Lead Coaches have not both passed Youth Protection screening. Blocks roster, events, awards. | test teams A, B, C |
| `val_team_partners_school_partner_missing` | No school or organization is attached to the team. | test team C |

So a team with one real problem can carry 10 to 16 task entries, because the problem is repeated per blocked area. Dashboard+ should
collapse them to one line per `Issue_key`, with the list of blocked areas as secondary detail, and link each one straight to its fix
(`GenerateNotificationResolutionURL`).

## 4. Team pages

**Verified.** A team opens at `/Teams//Wizard/EditTeam?TeamProfileID=<id>`. It works as a normal page as well as inside the
Dashboard's `#appFrame` iframe. The page is about 240,000 characters and has four tabs. Only the first is in the page; the
others are HTML fragments fetched the first time their tab is clicked (jQuery `.load`).

| Tab | Fetched from | What is in it |
| --- | --- | --- |
| Team Information | in the page (`<form id="team-information">`, posts to `/Teams/Wizard/EditTeam`) | Team Details, Communication & Mentoring, School/Organization, Sponsors |
| Team Finances | `/Teams/Page/FinancialGuarantorSetup/EditFinancialGuarantor`, `/Teams/Page/TeamPaymentsSummary/PaymentHistory`, `/Teams/Page/TeamFundsAndGrants/GetTeamDetailsForRegrant` | Financial guarantor, payment history, regrant |
| Team Roster | `/Teams/Page/TeamContacts/TeamRoster` | Youth members, parent/guardian invitations, team leadership, applications, invitations |
| Team Events and Awards | `/Teams/Page/Events/GetTeamEvents?SortBy=…`, `/Teams/Page/AccessCodes/GetSeasonSpecificVouchers` | Awards, event list, robot name, voucher codes |

All of these take `?TeamProfileID=<id>`.

The header also has "My team is participating in the <year> season", "Go To FIRST Storefront" and "Delete Team". The red dot
on a tab means that tab has an outstanding task, and a blue tooltip above the tab names it ("Lead Coach 2 missing",
"Team Name > 80 chars"). This tooltip is the only place the site shows the real reason, and it is cut off at the left edge of the window.

### 4.1 Roster data

**Verified.** The roster fragment is HTML, but the data is embedded in it as three JSON objects in an inline script:

- `teamContactsModel` → `PeopleRoles[]` (every adult and accepted youth with a role), `Invites[]`, `ExpressInvitationsList[]` (people who applied through "Express" enrollment; mentor applications live here).
- `ContactRosterModel` → `TeamStudents[]` (youth, including applicants).
- `teamContactsWizardModel` → the two above plus `ParentRoster[]`, `PriorSeasonYouthMembers`, `applyToTeamYouthMemberNotification`, `applyToTeamMentorNotification`, `IsBlockTeamStudents`.

So one GET of the fragment gives Dashboard+ the whole roster as data, with no page scraping. Fields that matter:

| Where | Field | Meaning |
| --- | --- | --- |
| `TeamStudents[]` | `ApplicationStatus` | `Applied` (waiting for a decision), `Accepted`, `Denied` |
| `TeamStudents[]` | `ConsentReleaseStatus` | `true` when the youth's Consent & Release is on record |
| `TeamStudents[]` | `PeopleID`, `TeamStudentId`, `name_first/last`, `email`, `parent_name_first/last`, `parent_email` | Needed for accept and for the parent reminder |
| `PeopleRoles[]` | `role_key` | `coach-1`, `coach-2`, `team_admin`, `Mentor`, `youth_mentor`, `team_volunteer`, `youth_member` |
| `PeopleRoles[]` | `ConsentReleaseStatus` | `true` when that person's Consent & Release is on record |
| `PeopleRoles[]` | `peopleId`, `Id` (role record), `name_first/last`, `email` | Needed for reminders |
| `ExpressInvitationsList[]` | `RoleKey`, `FkPeople`, `FlagApplicationDenied`, `EmailAddress`, `NickNameFullName`, `ConsentReleaseStatus` | Mentor applications |

Youth Protection, state clearance and training status are **not** in the fragment. The page asks for them separately:
`GET /Teams/Page/TeamContacts/GetPersonStatus?TeamProfileID=<id>&ids=<peopleId>&ids=…` returns
`[{ peopleId, screening:{status,icon,text}, supplemental:{status,icon,text,stateprov}, training:{status,icon} }]`
where status is a colour: `green` (meets), `blue` (incomplete), `orange` (problem), `grey` (not applicable).

Youth are hidden on a team until two Lead Coaches have passed screening (`IsBlockTeamStudents`). All three test teams are in
that state, so their youth lists cannot be seen at the moment.

A read-only look at the large real team's roster confirmed the shape above: youth applicants appear in `TeamStudents` with
`ApplicationStatus: "Applied"`, and those applicants are what its "Pending Roster Task" refers to. Youth also appear in
`PeopleRoles` as `youth_member`, so the two lists overlap.

### 4.2 Roster actions

**Verified in the site's source. One has been sent for real** (the adult C&R reminder, see section 8); the rest have not.
Every action is a `POST` with a form-encoded body to
`/Teams/Page/<Controller>/<Action>?TeamProfileID=<id>`. The site's own code sends no anti-forgery header on these.

| Action in the "Options" menu | Endpoint | Body |
| --- | --- | --- |
| Approve Membership (youth applicant) | `ContactRoster/AcceptInvitation` | `id` = youth's `PeopleID`, `teamProfileId` |
| Decline Membership (youth) | `ContactRoster/RemoveContact` | `id` = `PeopleID`, `teamProfileId` |
| Accept Application (mentor applicant) | `TeamContacts/AcceptAppliedApplication` | `PeopleId` = `FkPeople`, `TeamProfileId` |
| Decline Application (mentor) | `TeamContacts/DeclineAppliedApplication` | `PeopleId`, `TeamProfileId` |
| Delete declined application | `TeamContacts/DeleteDeclinedApplication` | `PeopleId`, `TeamProfileId` |
| Send C&R Email Reminder (adult) | `TeamContacts/SendContactConsentAndReleaseReminderEmail` | `recipientName`, `recipientEmail` |
| Send C&R Email Reminder (youth's parent) | `TeamContacts/sendReminderEmail` | `student_name`, `student_email`, `parent_name`, `parent_email`, `teamProfileID`, `people_id` |
| Request Screening | `TeamContacts/RequestScreening` | `peopleRoleId`, `email` |
| Resend Invitation | `TeamContacts/ResendInvitation` (or `ContactRoster/ResendParentInvitation`) | `TeamProfileID`, `email` |
| Delete contact | `TeamContacts/RemoveContact` / `ContactRoster/RemoveContact` / `ContactRoster/RemoveInvitees` | `id`, `invitation`, `teamProfileId` |
| Retire from team | `TeamContacts/RetireContact` | to be read |
| Invite contacts | `TeamContacts/InviteContacts`, `ContactRoster/InviteParents` | needs a reCAPTCHA answer, so Dashboard+ will not automate it |
| Re-invite last season's youth | `TeamContacts/InvitePriorSeasonYouthMembers` (reCAPTCHA), `TeamContacts/ReinviteAllStudentsToTeam`, `TeamContacts/ReinviteStudentToTeam` | `TeamProfileID`, `StudentIDList` / `StudentID` |
| Notify-me toggles | `TeamContacts/setApplytoTeamYouthMemberNotification`, `…MentorNotification` (sent as **GET**) | `profileID`, `optin` |
| Award submitter flags | `ContactRoster/UpdateAwardSubmitter`, `ContactRoster/UpdateDeansListAwardSubmitter` | to be read |

When the menu shows what:

- Youth card: "Approve Membership" and "Decline Membership" only while `ApplicationStatus` is `Applied`. "Send C&R Email Reminder" only when C&R is not on record **and** a parent email exists.
- Adult card: "Send C&R Email Reminder" whenever C&R is not on record. "Request Screening" when screening is incomplete.
- Mentor application card: "Accept Application", "Decline Application", plus the two above when they apply.

After each single action the site shows a confirmation dialog and then reloads the whole roster.

### 4.3 Other pages seen

- **My Invitations/Roles** (`/Teams/Wizard/RolesInvitation/`, title "My Roles", about 176,000 characters). Part of a "Profile" area with tabs My Profile, Demographics and Affiliations, Acknowledgement Forms, My Invitations/Roles, Volunteer Information, Volunteer History. Sections: Invitations, Accepted Team and Class Pack Roles, Accepted Event Roles, Accepted Parent/Guardian Roles, Accepted Financial Guarantor Roles. It already has its own "Accept All Invitations" button, for invitations sent **to** the signed-in person. Verified by opening it; not explored further.
- **Sidebar**: Youth Protection (`/Profile//wizard/MyProfile/5`), My Policies (`/Profile//wizard/MyProfile/4`), My Account (`/Profile//Wizard/MyProfile/`), FIRST Training (`/Profile//Certification`). Not opened.
- **Other personas** on the Dashboard home (Event Volunteer, Parent/Guardian, Class Pack). Their markup and scripts were read; their pages were not opened.
- **Not opened on purpose**: Storefront, Delete Team, payment and financial guarantor forms, award submission portals, Express Enrollment "Manage Invitations" (greyed out on the test teams).

## 5. Feature ideas for Dashboard+

| Idea | Why | Feasibility |
| --- | --- | --- |
| Show the real reasons under each badge on the team list | Section 3. One extra `GetMoreTeams` call (same one the page makes). | High. Built in v0.1. |
| "Fix" link per reason | Uses the site's own `GenerateNotificationResolutionURL`. | High. Built in v0.1. |
| Bulk accept applications (youth and mentor) | Section 4.2. One POST per person, sent one after another, then a single roster reload instead of one reload per person. On a large team that turns about a minute per applicant into about a minute in total. | High, but **not yet tested end to end**: no test team has an applicant right now, and the test teams cannot see youth until they have two screened Lead Coaches. |
| Bulk Consent & Release reminders (adults, and parents of youth) | Section 4.2. Same pattern. | High for adults. Not yet sent for real. |
| Roster summary without opening the Roster tab | Counts of applicants, missing C&R, incomplete screening or training, straight from the embedded JSON. | High |
| Cross-team view | Same roster summary for every team the user coaches, on the Dashboard home. | Medium: each team costs one slow roster call (section 7), so it must be on demand and cached. |
| Styling fixes (checkbox above its label, clipped tooltip) | CSS injected by the content script. | High. Built in v0.1. |
| Roster export (CSV) | Everything needed is in the embedded JSON. | High |

## 6. Oddities and bugs noticed

- **Untranslated text keys reach the user.** `TopicLocalizedText` / `Localization` sometimes contain raw keys such as `val.team_contacts:1`, `val.team_manage_students:1`, `val.team_events.team_profile:1`. One real team's only task has the key instead of a sentence.
- **Misleading sentence.** For `val_team_not_2leadcoaches_screened` in the roster-printing area, the text shown is "Please review your Team Contacts for incomplete Consent and Release forms." The real cause is Youth Protection screening of the Lead Coaches, not Consent & Release.
- **Same problem repeated.** One cause appears up to 15 times in the reply (once per blocked area).
- **Dead code shipped.** The action-link dropdown code is still sent to the browser but its data call is commented out.
- **Everything loads for every persona.** Volunteer, Parent/Guardian and Class Pack markup and templates load even when only Teams is used.
- **Duplicate click handlers.** `teams.js` re-binds `.OutstandingTaskResolutionLink` click handlers inside the per-team loop, so with N teams the first team's links get N handlers.
- **Double slashes in links** (`/Teams//Wizard/...`, `/Profile//wizard/...`). Harmless, but shows links are built by string concatenation.
- **Checkbox sits above its label** (Team Information → Communication & Mentoring, and the mentoring options). Root cause, verified: the stylesheet rule is `.participation-section { flex-direction: row; align-items: end; gap: 8px; }` with no `display: flex`. Only the copy in the page header gets `display: flex` (`.team-header-details > .participation-section`), which is why "My team is participating…" looks right and the others do not. The checkbox itself is `display: block`, so it takes a full line.
- **Team list columns overflow the table.** Verified. Each `.header-cell` / `.row-cell` has `width: N%` (15+17+13+24+13+13 = 95%) **and** 7px margins on each side, plus 18px left padding on the row, so the last column ("Participating Team") ends about 23px past the table edge at around 1280px wide. Fixed in v0.2.2 by letting the columns shrink.
- **Fix links open to a blank screen.** Verified on the large real team on 2026-11-12. For a roster task, `GenerateNotificationResolutionURL` returns the older roster wizard (`/Teams/wizard/TeamContacts/1`). The Dashboard loads it in its frame with the frame hidden until it finishes, and hides its own spinner as soon as the small "which page?" request is done. On a slow page that is a blank screen with no sign of progress; That team's had not appeared after more than two minutes. The same afternoon the Teams app was slow overall (a one-person team page took 27 s instead of 0.8 s, and a one-person roster 29 s instead of 1.5 s, while `/Dashboard/` calls stayed at 0.18 s), most likely a wider service outage. v0.1.2 shows "Opening the page…" with a timer until the frame loads.
- **Where the site's Fix links go** (checked 2026-11-12 with `GenerateNotificationResolutionURL`): roster tasks (applicants waiting, a Lead Coach missing, Lead Coach screening; step 23) → `/Teams/wizard/TeamContacts/1`, the older roster wizard titled "Create New Team"; a missing school (step 37) → `/Teams/wizard/EditTeam/2`, also "Create New Team"; unpaid registration (step 341) → `/Teams/wizard/Payment/1`, which redirected to the Dashboard and loaded it inside the Dashboard's own frame, on both a real and a test team; a team name over 80 characters (step 35) → `/Teams/wizard/EditTeam/1`, the normal team page. Since v0.7.2 Dashboard+ opens the normal team page on the Team Roster / Team Information (scrolled to School/Organization) / Team Finances tab for the first three, and keeps the site's link for everything else.
- **Older roster wizard draws its header twice.** Verified on the large real team, steps 1 and 3 of `/Teams/Wizard/TeamContacts/<step>`: the "Create New Team" title, program line and step bar appear across the top **and** again inside the left `.col-sm-3.sidenav` column, where the step labels overlap and push into the main content. This is the site's own markup; Dashboard+ was ruled out (none of its rules or elements are on that page). Fixed in v0.1.1 by hiding the side-menu copy. The page also wears the title "Create New Team" for an existing team. The test teams cannot open this page (it redirects to the Dashboard with a Youth Protection warning until two Lead Coaches are screened).
- **The reason tooltip is clipped.** The blue tooltip above the first tab ("Team Name > 80 chars") runs off the left edge of the window.
- **The C&R reminder is not checked on the server.** Verified: a reminder was accepted for someone whose Consent & Release is already on record. The site only hides the menu option. See section 8.
- **Settings changed with GET.** The two "Notify me when … applies" checkboxes save by sending a GET request, and do it synchronously.
- **Blocking requests.** Several calls use `async: false` (`GetPersonStatus` on the roster, the notify toggles, re-invite, and Finances → Payment History `GetPaymentHistories`, 3–11 s per season on a large real team). The page freezes until the server answers. Before any search, Payment History shows "$0.00" and "Payment records not available", which is a placeholder, not a result. Dashboard+ makes the Payment History call asynchronous with a jQuery `ajaxPrefilter` (the site's own success handler still renders the table) and answers repeat seasons from memory with an `ajaxTransport`.
- **Raw text keys in success messages.** `Reinvite_All_Youth_Team_Members_Success:1` and `Invite_Replacement:1` are shown to the user as is.
- **Internal server name in the page.** The session-check script contains a sign-out link whose return address points at an internal host name rather than the public site.
- **Roster fragment is mostly boilerplate.** A team with one person still returns about 150,000 characters, around 120,000 of them script, including two copies of the reCAPTCHA loader.
- **Unsolicited popups.** The Dashboard home carries a "Don't show this message for the rest of the season" welcome dialog and a policy dialog in the page at all times.

## 7. Performance notes

Measured on 2026-11-12 from one browser, one sample each unless noted. Treat as rough.

| Request | Time | Size |
| --- | --- | --- |
| `GetProgramList` | 0.17 s | small |
| `GetMoreTeams` (9 teams) | under 1 s | small |
| `EditTeam` page | 0.8 s | 239k chars |
| Roster fragment, team with 1 person | 1.5 s | 150k chars |
| Roster fragment, team with about 110 people | **52 s and 57 s** (two samples) | 518k chars |
| `GetPersonStatus` for 1 person | 0.5 s | 300 chars |
| Roster fragment, large real team (later sample) | **68 s** | 79 kB transferred |
| `GetPersonStatus` for that whole roster, right after it | **27 s**, synchronous | 32 kB transferred |
| Team Events and Awards tab (`GetTeamEvents`, `GetSeasonSpecificVouchers`) | 0.4 s + 1.6 s | small |
| Team Finances tab (`EditFinancialGuarantor`, `PaymentHistory`) | 1.0 s + 0.3 s | small |
| Opening a team page from the team list (iframe load) | about 6.5 s end to end | — |

- **The roster freezes the whole Dashboard after it arrives.** Once the roster's HTML is inserted, its script calls
  `getPersonStatuses()`, a jQuery `$.ajax` with `async: false` for every person's screening and training status. On a
  large team that blocks the page's only thread for about half a minute: nothing repaints, clicks do nothing, and
  automation tools time out. Measured total from tab click to a usable roster: about 2 minutes. Dashboard+ cannot make
  the call asynchronous without rewriting the site's roster script, so its "Loading the roster…" message warns that
  the page may stop responding after the roster appears. The site's own dimmed overlay disappears after a few
  seconds, long before the roster arrives.
- **Why so slow, and what Dashboard+ does about it (v0.8.0).** Roster build time grows with head count at about 0.5 s per person (1.5–1.8 s for one person, 52–68 s for about 116), and the follow-up `GetPersonStatus` at about 1 s per adult (only adults and mentor applicants are looked up: `peopleIds` is built from `teamContactsModel.PeopleRoles[].peopleId` and `ExpressInvitationsList[].FkPeople`; screening/training are not in the roster HTML). Both point to per-person lookups on the server. Dashboard+ (a) fetches the roster HTML itself, reads the adult ids from the embedded `teamContactsModel`, runs `GetPersonStatus` asynchronously, then inserts the HTML and answers the page's synchronous call from that result once (jQuery `ajaxTransport`); measured on the large team: roster 59.2 s + status 23.1 s, longest main-thread stall 0.34 s instead of a 27 s freeze; and (b) keeps the last roster HTML and status answer per team in the Dashboard window's memory for 30 minutes and shows it instantly on a repeat visit, inert and dimmed under an "updating…" banner until the fresh roster replaces it (0.3 s to show 116 cards).

- **The roster is the bottleneck.** Time grows with head count at roughly half a second per person. **Guess:** the server looks up each person's screening and training status one at a time while building the page (the single-person status call also takes about half a second).
- Because the site reloads the roster after every single action, accepting N applicants on a big team costs about N minutes of waiting. Doing the N actions first and reloading once is the main win Dashboard+ can offer.
- **Requests in one session look serialized. Likely, not proven:** two roster calls sent together finished in 1.4 s and 2.7 s, the same as sending them one after the other. So sending requests in parallel will not speed things up, and a slow roster call delays everything else queued behind it in the Teams app. The Dashboard app (`/Dashboard/…`) kept answering in 0.17 s while a 57 s roster call was in flight, so the two apps do not block each other.
- Dashboard+ should therefore: load a roster once and keep it in memory, never reload after each action, show progress while the server works, and send one request at a time.
- What an extension cannot fix: the server's 50+ seconds for a large roster. It can only avoid asking twice.

## 8. What has been tested (v0.1, 2026-11-12)

The extension's files were run inside the live pages (loaded from disk into the page, not yet installed through `chrome://extensions`).

| Check | Result |
| --- | --- |
| Reasons under each team on the Dashboard home | Pass. 7 of 9 teams have tasks; each got its list. Reasons come back after re-sorting the list. |
| Fix button | Pass on test team A: opened `/Teams/wizard/EditTeam/1` for that team inside the Dashboard. |
| Checkbox beside label | Pass, Communication & Mentoring on test team A. |
| Tooltip no longer clipped | Pass on test team A. |
| Roster summary panel | Pass on test team A (1 person). Not opened on a large roster. |
| Accept applicants | **Dry run only**: made-up applicants and the network call intercepted. Built the right requests, skipped an unticked person, reported results, called the roster reload. No real applicant has been accepted. |
| Send C&R reminders, the panel | **Dry run only**: same method. Correct defaults, skipped the person with no email, showed a simulated failure. |
| Send C&R reminder, the server call (adult) | **Sent once for real**, with the account owner's go-ahead: `SendContactConsentAndReleaseReminderEmail` on test team A, to the signed-in Lead Coach's own name and address. The request was built by hand in the same shape the panel builds. Reply: HTTP 200, `application/json`, body `true`, in 1.7 s. Arrival of the email has not been confirmed. |
| Reply format of the write endpoints | **Verified for the adult reminder:** JSON `true`. Dashboard+ reads that as success, and `false`, empty, or a sign-in page as failure. **Guess** for the others: the same, since they share the site's one success handler. |

What the real send also showed: the server sent the reminder for a person whose Consent & Release **is** on record. The
"only people without C&R" rule exists in the page's menu, not on the server. The request carries just a name and an email
address, no person id. **Guess, not tried:** it would accept any name and address.

To finish testing the write tools, a test team needs (a) an applicant and (b) someone without Consent & Release, so the
panel itself lists a real person. The test teams also cannot show youth until they have two screened Lead Coaches.

### How to test without installing

In a Dashboard tab's console: fetch `content.css` and the scripts (`core.js` … `main.js`, in manifest order) from a small local server that sends
`Access-Control-Allow-Origin: https://my.firstinspires.org`, add the CSS in a `<style>` tag, and `eval` the script. For a dry
run of the write tools, replace `jQuery.ajax` with a stub for `POST /Teams/Page/…` and add made-up entries to
`ContactRosterModel.TeamStudents`, `teamContactsModel.ExpressInvitationsList` and `teamContactsModel.PeopleRoles`, then nudge
`#acct-roster-accordion` (append and remove a node) so the panel redraws.

## 9. Rules to keep in mind

- The Dashboard page still embeds the FIRST Mentor Network Terms of Use (which forbid "any automated use of the Site"), but FIRST has closed the Mentor Network (announced with its 2025–2026 mentor changes; teams now connect through Team Search contact details instead), so the terms are a leftover. Dashboard+ still only acts when the user clicks and keeps request volume low.
- Write actions get a preview and a confirmation first, as in VMS+.
- The tool output filter used during this exploration hides query strings and cookies, so no session secrets are recorded here.
