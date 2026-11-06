-- Dream Watch — keep the source order of events that share a video timestamp
-- (e.g. a foul, the card for it and the penalty goal all at the same second).
alter table public.match_events add column if not exists seq int;
create index if not exists match_events_match_time_seq_idx on public.match_events (match_id, video_time, seq);
