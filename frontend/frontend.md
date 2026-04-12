# Frontend

The frontend is a web UI for managing the configuration of the reporting system.
It allows users to define subjects, add questions, and configure reminder and scheduling behaviour.

---

## Pages

| Page | Purpose |
|---|---|
| Subjects | Manage question categories |
| Questions | Manage individual report questions |
| Reminders | Configure reminder and send settings |

---

## Subjects Page

Manage the top-level categories that group questions together.

**Actions:**
- Add Subject
- List Subjects
- Delete Subject (removes all related questions)

---

## Questions Page

Manage the questions that are sent to employees.

**Actions:**
- Select Subject (filter questions by subject)
- Add Question
- List Questions
- Delete Question

---

## Reminders Page

Configure how the system follows up on unanswered questions and when to send them.

**Actions:**
- Set Interval (time window for sending, e.g. 9am-11am)
- Set Repetitions (how many reminders before reporting failure, max 4)
- Send Questions (manually trigger the AI graph)