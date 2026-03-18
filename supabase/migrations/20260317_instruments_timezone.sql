-- Migration: Add timezone column to instruments table (BUG-14)
-- Stores the IANA timezone for each instrument so that strategy time inputs
-- (rangeStart, rangeEnd, triggerDeadline, timeExit) are interpreted in the
-- instrument's local exchange timezone rather than hardcoded UTC.

ALTER TABLE instruments
  ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'UTC';

-- Update existing instruments with their exchange-native timezones.
-- European indices & commonly traded instruments (user context: Germany)
UPDATE instruments SET timezone = 'Europe/Berlin'
WHERE symbol IN ('GER30', 'GER40', 'FRA40',
                 'XAUUSD', 'XAGUSD',
                 'WTIUSD', 'BRENTUSD',
                 'SOYBEANUSD', 'COPPERUSD');

-- London exchange
UPDATE instruments SET timezone = 'Europe/London'
WHERE symbol IN ('UK100');

-- US exchanges (NYSE / NASDAQ / CME)
UPDATE instruments SET timezone = 'America/New_York'
WHERE symbol IN ('US30', 'US500', 'NAS100');

-- Asian exchanges
UPDATE instruments SET timezone = 'Asia/Tokyo'
WHERE symbol IN ('JPN225');

UPDATE instruments SET timezone = 'Australia/Sydney'
WHERE symbol IN ('AUS200');

-- Forex majors & crosses: keep UTC (24 h global market)
-- (All remaining instruments that were not updated above stay at DEFAULT 'UTC')
