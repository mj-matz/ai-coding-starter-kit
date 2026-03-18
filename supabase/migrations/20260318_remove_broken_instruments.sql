-- Migration: Remove broken Dukascopy symbols from instruments table
-- These symbols return no data from Dukascopy and were removed from the fetcher (BUG-28/BUG-29).
-- upsert in seed_instruments.py does not delete rows, so they must be removed explicitly.

DELETE FROM instruments
WHERE symbol IN ('NATGASUSD', 'CORNUSD', 'XPDUSD', 'XPTUSD', 'WHEATUSD');
