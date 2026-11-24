-- Align 0008: blocks remember whether their sector was guessed or chosen.
-- A guessed sector (from the title and notes) is re-guessed when the text
-- changes; a sector Gibson picks himself is never overwritten.

alter table public.align_blocks add column if not exists sector_auto boolean not null default false;
