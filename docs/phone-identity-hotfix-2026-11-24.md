# Team phone identity hotfix

Production base: 0db9345c38101aaf8d2984931e0452d9b8899c1d.
Owner: Codex, authorized by Max on 2026-11-24. Claude monitoring remains paused.

Production evidence: phone/token rejected verified team logins because Auth UUIDs
differ from public.users UUIDs. Incoming TwiML and number assignments use the latter.

Scope: token route and a dedicated identity resolver only. No shared auth changes,
webhook changes, database writes, migrations, phone assignment or forwarding changes.
Resolve a direct active profile, or exactly one profile using the verified login's
confirmed email (literal case-insensitive match). Reject inactive, ambiguous and
unverified profiles. Never issue another person's requested identity. Tokens always
use the resolved Hub profile ID; cache control is private/no-store.

Tests: test-phone-identity.cjs executes the resolver, the actual token route with
network boundaries mocked and real Twilio JWT signing, plus incoming TwiML routing.
Existing Phase A, v55.28 diagnostics and v55.65 voicemail suites pass. Older v55.43
and v55.39 scripts have pre-existing Windows file-URL path errors; v55.56 has two
obsolete version/dashboard assertions (unchanged files), with phone assertions passing.

Release: stage a production-configured build without domain assignment; verify it;
recheck live deployment and origin/main before promotion. Push only a fast-forward,
never force push. No other session's worktree or uncommitted changes are included.
The UI version label is deliberately unchanged for this server-only hotfix.

Live audio/ringing still requires a signed-in browser with microphone permission
and a controlled real call. Unit/token tests alone are not proof of audio delivery.
