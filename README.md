# OEMS — backend-connected edition

This edition connects the React app to an Express API and persists school data in a server-side JSON database file (`data/oems-data.json`). Data is shared by users reaching the same backend instance, rather than being stored only in each browser.

## Run locally

Requires Node.js 20.19+.

1. Install dependencies: `npm install`
2. Terminal 1 — start the API: `npm run server`
3. Terminal 2 — start the frontend: `npm run dev`
4. Open the Vite URL shown in terminal 2. Vite proxies `/api` requests to `http://localhost:3001`.

The backend creates `data/oems-data.json` automatically from the supplied seed data on first launch. Keep the `data/` directory out of source control and configure a persistent disk/volume when hosting the backend; ephemeral hosting filesystems can lose data on redeploy.

## Production deployment

Build the frontend with `npm run build`, then start the server with `npm start`. When the `dist/` folder exists, Express serves the frontend and API from the same origin. Set `PORT` if your hosting provider requires it.

Configure these server environment variables in the hosting dashboard:
- `ADMIN_USERNAME` — optional; default `admin`
- `ADMIN_PASSWORD` — required for production; default `admin123` is for local demo only
- `GEMINI_API_KEY` — optional; enables server-side Gemini question extraction for PDF import
- `GEMINI_MODEL` — optional; default `gemini-2.5-flash`
- `DATA_DIR` — optional path for persistent database storage

**Important:** change the default administrator password before exposing this app publicly. For production and multiple concurrent writes, replace the JSON file store with a managed database (PostgreSQL/MySQL) and add proper authentication/session security. This starter backend demonstrates persistence and API connectivity; it is not a hardened production identity system.

## PDF import

PDF/question extraction requests are sent to `/api/import-questions-gemini`. Configure `GEMINI_API_KEY` on the backend only; do not put it in frontend environment variables or commit it to Git.

## GitHub Pages

GitHub Pages cannot run Express or host a persistent backend. Deploy the backend to a Node-capable host and configure the frontend proxy/base API URL for that host if you want GitHub Pages to remain the frontend. The simplest deployment for this package is to build and serve the frontend from the Express server as described above.
