# Fix: persist imported PDF questions during exam creation

Replace your existing `App.tsx` with the included `App.tsx` (merge if your local filename differs).

What changed:
- Draft exam fields and imported/manual questions are saved to browser `localStorage` as you work.
- Refreshing the page and reopening **New exam** restores the draft, including imported questions.
- After the exam is successfully saved to the OEMS API, the temporary draft is cleared.
- The existing exam API already saves the `questions` array as part of the exam record.

Important: on GitHub Pages, this storage is per browser/device, not shared across users. To make exams available on every device, deploy the app with a persistent server/database backend instead of browser-only storage.
