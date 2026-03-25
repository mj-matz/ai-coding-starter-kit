-- Economic calendar table for news day filter (PROJ-23)
CREATE TABLE IF NOT EXISTS public.economic_calendar (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  date        date        NOT NULL,
  currency    text        NOT NULL,
  impact      text        NOT NULL,
  event       text        NOT NULL,
  synced_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (date, currency, event)
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_economic_calendar_date     ON public.economic_calendar (date);
CREATE INDEX IF NOT EXISTS idx_economic_calendar_currency ON public.economic_calendar (currency);

-- Row Level Security
ALTER TABLE public.economic_calendar ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read
CREATE POLICY "Authenticated users can read economic_calendar"
  ON public.economic_calendar
  FOR SELECT
  TO authenticated
  USING (true);

-- Service role can write (sync route uses service role key)
CREATE POLICY "Service role can insert economic_calendar"
  ON public.economic_calendar
  FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Service role can update economic_calendar"
  ON public.economic_calendar
  FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service role can delete economic_calendar"
  ON public.economic_calendar
  FOR DELETE
  TO service_role
  USING (true);
