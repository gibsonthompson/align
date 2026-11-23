# Align

Gibson's personal life operating system. Every part of his life, from the five-year vision down to today's action, is its own page that links to everything it touches.

## Stack

- Next.js (App Router, TypeScript) on Vercel, installed as a PWA, desktop first
- OpenAI for the brain, called only from the server
- Supabase: the shared Detail Pro project. Every table, view and function is prefixed `align_`
- The browser never talks to the database. Every read and write goes through the server with the service key, behind a PIN session

## Environment (Vercel)

| Name | What it is |
| --- | --- |
| `SUPABASE_URL` | Detail Pro project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Detail Pro service role key |
| `ALIGN_PIN` | 4 to 12 digits. Changing it signs every device out |
| `OPENAI_API_KEY` | Powers the brain |
| `ALIGN_BRAIN_MODEL` | Optional. Defaults to `gpt-5.6` |

## Database

Migrations live in `supabase/migrations` and are already applied to Detail Pro:

- `0001_align_init.sql`: sectors (9 defaults plus 51 areas), nodes (the tree), links (any to any, both directions), notes, activity (written by triggers), pins, recents, the PIN gate, the object view, breadcrumbs, children, links and search functions
- `0002_align_tree_ops.sql`: sector counts, archive or restore a page with its branch, move a page with its branch
- `0003_align_brain.sql`: done criteria, effort, cadence and actionable on pages; the brain's conversation per page; facts it learns about Gibson
- `0004_align_chatgpt.sql`: OAuth clients, codes and tokens for the ChatGPT connection; marks history rows written by ChatGPT
- `0005_align_months_weeks_events.sql`: Month and Week page kinds (end dates fill themselves in), event date, location, cost and link on any page, shifting a plan's dates, and ended weeks no longer counting as overdue

## The Brain

Every sector and page has a brain panel (`lib/brain.ts`). It reads the whole path above the page, the pages already under it and the facts it knows, then either asks what only Gibson can answer (with tap-to-pick options) or proposes the next, more specific layer with a done criterion and effort on each. Accepted proposals become real pages; "Keep Going" opens one and runs the brain again, until a step passes the actionable test: one sitting, a verb, the exact object, a method, a measurable finish.

RLS is on for every `align_` table with deny-all policies for `anon` and `authenticated`. Functions can only be called by `service_role`.

## Build Phases

1. Skeleton of a life plus the brain (this): login, sectors and areas, five-plus levels of pages, links, notes, history, search, quick switcher, the planning brain
2. Vision and assessment
3. Deeper reverse engineering: realism checks on timelines and effort
4. Habits and measures
5. Calendar
6. Vision board, gallery and the HQ import
7. Reviews
8. Today dashboard and Clyde
