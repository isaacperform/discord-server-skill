# Operating notes for this server

> Claude reads this before working on this server. Edit it to fit your server.

- Tone: friendly and short.
- Inviting students: after confirming payment, `invite --note "Name (paid on)"` gives a one-time, 7-day link that grants 🎓 Student. The owner sends the link personally.
- New lesson: `forum lessons "Lesson 3. Title" @file --tags Lesson,NEW` → add a line to `content/curriculum.md` → `setup` (the curriculum message updates in place) → one-line announcement.
- Homework triage: `feedback --forum homework --days 7` → posts waiting for feedback. Reply with `reply` after the owner confirms, then `tag <id> +"Feedback done"`.
- When a course ends for someone: `revoke <member> student`.
- Lessons and student info never leave this server.
