-- ─── ENUMS ───────────────────────────────────────────────────────────────────
CREATE TYPE user_role           AS ENUM ('admin', 'manager', 'viewer', 'participant');
CREATE TYPE day_of_week         AS ENUM ('Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday');
CREATE TYPE recipient_mode      AS ENUM ('all', 'subset');
CREATE TYPE broadcast_status    AS ENUM ('pending', 'in_progress', 'completed', 'failed');
CREATE TYPE conversation_status AS ENUM ('pending','awaiting_reply','processing','completed','timed_out','superseded','failed');
CREATE TYPE message_role        AS ENUM ('ai', 'participant');

-- ─── UPDATED_AT TRIGGER ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

-- ─── USERS ───────────────────────────────────────────────────────────────────
CREATE TABLE users (
  id          SERIAL PRIMARY KEY,
  supabase_id TEXT UNIQUE,
  name        TEXT NOT NULL,
  email       TEXT UNIQUE NOT NULL,
  phone       TEXT,
  initials    TEXT,
  title       TEXT,
  role        user_role NOT NULL,
  active      BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);
CREATE TRIGGER users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── EMPLOYEES ───────────────────────────────────────────────────────────────
CREATE TABLE employees (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  phone         TEXT UNIQUE NOT NULL,   -- E.164 format e.g. +15551234567
  property      TEXT,
  active        BOOLEAN DEFAULT true,
  sms_opted_out BOOLEAN DEFAULT false,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);
CREATE TRIGGER employees_updated_at BEFORE UPDATE ON employees
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── GROUPS ──────────────────────────────────────────────────────────────────
CREATE TABLE groups (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);
CREATE TRIGGER groups_updated_at BEFORE UPDATE ON groups
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── GROUP MEMBERS ───────────────────────────────────────────────────────────
-- A group can contain platform users (user_id) or employees (employee_id).
CREATE TABLE group_members (
  id          SERIAL PRIMARY KEY,
  group_id    INT NOT NULL REFERENCES groups(id)    ON DELETE CASCADE,
  user_id     INT          REFERENCES users(id)     ON DELETE CASCADE,
  employee_id INT          REFERENCES employees(id) ON DELETE CASCADE,
  UNIQUE (group_id, user_id),
  UNIQUE (group_id, employee_id)
);
CREATE INDEX gm_user_id_idx     ON group_members(user_id);
CREATE INDEX gm_employee_id_idx ON group_members(employee_id);

-- ─── MANAGER GROUPS ──────────────────────────────────────────────────────────
-- Which managers oversee which groups (scope derived at query time via these joins).
CREATE TABLE manager_groups (
  manager_id INT NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  group_id   INT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  PRIMARY KEY (manager_id, group_id)
);
CREATE INDEX mg_manager_id_idx ON manager_groups(manager_id);

-- ─── QUESTIONS ───────────────────────────────────────────────────────────────
CREATE TABLE questions (
  id         SERIAL PRIMARY KEY,
  manager_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text       TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE TRIGGER questions_updated_at BEFORE UPDATE ON questions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── SCHEDULES ───────────────────────────────────────────────────────────────
CREATE TABLE schedules (
  id             SERIAL PRIMARY KEY,
  manager_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label          TEXT,
  day_of_week    day_of_week NOT NULL,
  time_of_day    TEXT NOT NULL,    -- "HH:MM" 24h
  timezone       TEXT NOT NULL,    -- IANA e.g. "America/New_York"
  active         BOOLEAN DEFAULT true,
  recipient_mode recipient_mode NOT NULL,
  created_at     TIMESTAMPTZ DEFAULT now(),
  updated_at     TIMESTAMPTZ DEFAULT now()
);
CREATE TRIGGER schedules_updated_at BEFORE UPDATE ON schedules
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE schedule_employees (
  schedule_id INT NOT NULL REFERENCES schedules(id)  ON DELETE CASCADE,
  employee_id INT NOT NULL REFERENCES employees(id)  ON DELETE CASCADE,
  PRIMARY KEY (schedule_id, employee_id)
);

CREATE TABLE schedule_questions (
  schedule_id INT NOT NULL REFERENCES schedules(id)  ON DELETE CASCADE,
  question_id INT NOT NULL REFERENCES questions(id)  ON DELETE CASCADE,
  PRIMARY KEY (schedule_id, question_id)
);

-- ─── BROADCASTS ──────────────────────────────────────────────────────────────
CREATE TABLE broadcasts (
  id           SERIAL PRIMARY KEY,
  schedule_id  INT NOT NULL REFERENCES schedules(id),
  fire_date    TEXT NOT NULL,             -- "YYYY-MM-DD" in schedule.timezone
  status       broadcast_status DEFAULT 'pending',
  triggered_at TIMESTAMPTZ DEFAULT now(),
  triggered_by INT REFERENCES users(id),
  UNIQUE (schedule_id, fire_date)         -- one broadcast per schedule per calendar day
);
CREATE INDEX broadcasts_schedule_triggered_idx ON broadcasts(schedule_id, triggered_at);

-- ─── CONVERSATIONS ───────────────────────────────────────────────────────────
CREATE TABLE conversations (
  id              SERIAL PRIMARY KEY,
  broadcast_id    INT NOT NULL REFERENCES broadcasts(id),
  employee_id     INT NOT NULL REFERENCES employees(id),
  status          conversation_status DEFAULT 'pending',
  occupancy       INT,
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  failed_at       TIMESTAMPTZ,
  fail_reason     TEXT,
  last_message_at TIMESTAMPTZ,
  reminders_sent  INT DEFAULT 0
);
CREATE INDEX conv_employee_status_idx ON conversations(employee_id, status);
CREATE INDEX conv_status_idx          ON conversations(status);
CREATE INDEX conv_last_message_idx    ON conversations(last_message_at);

-- ─── MESSAGES ────────────────────────────────────────────────────────────────
CREATE TABLE messages (
  id              SERIAL PRIMARY KEY,
  conversation_id INT NOT NULL REFERENCES conversations(id),
  role            message_role NOT NULL,
  body            TEXT NOT NULL,
  sent_at         TIMESTAMPTZ DEFAULT now(),
  twilio_sid      TEXT UNIQUE   -- idempotency key: duplicate Twilio delivery = skip
);

-- ─── ANSWERS ─────────────────────────────────────────────────────────────────
-- Confident answers only — null answers are not stored.
CREATE TABLE answers (
  id              SERIAL PRIMARY KEY,
  conversation_id INT NOT NULL REFERENCES conversations(id),
  question_id     INT NOT NULL REFERENCES questions(id),
  answer          TEXT NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (conversation_id, question_id)
);
CREATE INDEX answers_conv_id_idx ON answers(conversation_id);

-- ─── INBOUND AUDIT LOG ───────────────────────────────────────────────────────
-- Every inbound SMS that was rejected (out-of-turn, closed session, opt-out).
CREATE TABLE inbound_audit_logs (
  id              SERIAL PRIMARY KEY,
  from_phone      TEXT NOT NULL,
  body            TEXT NOT NULL,
  conversation_id INT,
  reason          TEXT NOT NULL,  -- OUT_OF_TURN | SESSION_CLOSED | OPT_OUT | NO_CONVERSATION
  received_at     TIMESTAMPTZ DEFAULT now()
);

-- ─── RLS ─────────────────────────────────────────────────────────────────────
-- Enable RLS on every table. All data access goes through the backend API
-- (service_role key bypasses RLS). Direct browser access via anon key is blocked.
-- Phase 6 adds scoped per-user policies as a second layer of defense.

ALTER TABLE users               ENABLE ROW LEVEL SECURITY;
ALTER TABLE employees           ENABLE ROW LEVEL SECURITY;
ALTER TABLE groups              ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_members       ENABLE ROW LEVEL SECURITY;
ALTER TABLE manager_groups      ENABLE ROW LEVEL SECURITY;
ALTER TABLE questions           ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedules           ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedule_employees  ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedule_questions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE broadcasts          ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations       ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages            ENABLE ROW LEVEL SECURITY;
ALTER TABLE answers             ENABLE ROW LEVEL SECURITY;
ALTER TABLE inbound_audit_logs  ENABLE ROW LEVEL SECURITY;

-- ─── TEST USER SETUP ─────────────────────────────────────────────────────────
-- After creating your user in Supabase dashboard (Authentication → Users → Add user),
-- run this to set their role so the frontend knows what to show on login.
--
-- UPDATE auth.users
-- SET raw_user_meta_data = jsonb_build_object(
--   'name',  'Admin User',
--   'role',  'admin',
--   'title', 'Administrator'
-- )
-- WHERE email = 'your@email.com';
