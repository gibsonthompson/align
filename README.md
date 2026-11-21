# Align

Gibson's personal life operating system. Every part of his life, from the five-year vision down to today's action, is its own page that links to everything it touches.

## Stack

- Next.js (App Router, TypeScript) on Vercel, installed as a PWA
- Supabase: the shared Detail Pro project. Every table, view and function is prefixed `align_`
- The browser never talks to the database. Every read and write goes through the server with the service key, behind a PIN session

## Environment (Vercel)

| Name | What it is |
| --- | --- |
| `SUPABASE_URL` | Detail Pro project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Detail Pro service role key |
| `ALIGN_PIN` | 4 to 12 digits. Changing it signs every device out |

## Database

Migrations live in `supabase/migrations` and are already applied to Detail Pro:

- `0001_align_init.sql`: sectors (9 defaults plus 51 areas), nodes (the tree), links (any to any, both directions), notes, activity (written by triggers), pins, recents, the PIN gate, the object view, breadcrumbs, children, links and search functions
- `0002_align_tree_ops.sql`: sector counts, archive or restore a page with its branch, move a page with its branch

RLS is on for every `align_` table with deny-all policies for `anon` and `authenticated`. Functions can only be called by `service_role`.

## Build Phases

1. Skeleton of a life (this): login, sectors and areas, five-plus levels of pages, links, notes, history, search, quick switcher
2. Vision and assessment
3. Reverse engineering with Claude
4. Habits and measures
5. Calendar
6. Vision board, gallery and the HQ import
7. Reviews
8. Today dashboard and Clyde
