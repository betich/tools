# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

betich first, then the people betich shares with: friends and collaborators who open a share link. The typical job is a real, one-off piece of work that needs doing now: compress a batch of images, or make a set of cards or certificates from a spreadsheet (the mentor cards in `server/scripts/seed-mentor-cards.ts` are the worked example). Strangers can use the site, but they are not who it is designed for.

## Product Purpose

tools.betich.me is a small workshop kept in public: a few focused tools that do their real work in the browser. squoosh compresses and converts images. Mail merge renders one image per spreadsheet row from a base image and text layers. Success means the job gets done in one sitting, with no sign-up, and the result looks exactly as it did on screen.

## Positioning

Private, with no accounts. The work happens in your browser: squoosh never uploads anything, and mail merge only sends data to the server when you choose to save, share or batch-export. There is no sign-up and no login wall. The only password is an optional lock on a share link.

## Operating Context

- A merge begins with a base image and a CSV or Excel sheet, and ends as a ZIP of images or a PDF.
- Work is handed to others through share links, which can be locked with a password.
- The server is a small, shared, self-hosted box (a Raspberry Pi) behind a Cloudflare tunnel. The client is on Cloudflare Pages.
- Usage is watched through Google Analytics and the password-gated `/admin` dashboard.

## Capabilities and Constraints

- Everything works without the server. Features that need it degrade, show a message, and never throw.
- Server features are guarded by rate limits, a render queue and a disk reserve, because the box is small and shared with other services. New heavy server features must carry the same guards.
- Thai and English are both first-class. User content is often Thai: Thai text must render correctly (with the fallback fonts registered), and file names keep their Unicode.
- Preview and export come from the same renderer (`shared/src/render.ts`), so what you see is what you get.

## Brand Commitments

- The name is "betich's tools", at tools.betich.me. Chrome copy is lowercase.
- It is a personal workshop by one person, not a company product.

## Evidence on Hand

- A real merge: the mentor-cards seed script and the project it creates.
- There are no testimonials, user counts or press. Do not invent any.

## Product Principles

1. Nothing leaves the browser unless the user asks for it to.
2. No accounts, ever. Sharing is a link, and at most a password on it.
3. Degrade, never break. The server is a bonus, not a dependency.
4. Respect the box. Costly work is queued and capped, never unbounded.
5. Thai is not an edge case.
