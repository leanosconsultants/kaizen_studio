# Kaizen Copilot Studio

Kaizen Copilot Studio is a study workflow prototype for capturing a work observation, reviewing uploaded media, defining process steps, tracking observed problems, and publishing a short study summary.

This repository includes two runnable versions:

- `docs/`: static GitHub Pages version for online use in a browser.
- Flask backend: full local version with SQLite, uploaded media folders, and FFmpeg-generated clips.

## GitHub Pages Version

The GitHub Pages version is ready to serve from the `docs/` folder. It runs entirely in the browser and stores study data in `localStorage`.

Static mode supports:

- Create and edit studies.
- Upload a video for the current browser session.
- Generate interval-based process steps from the video duration or study duration.
- Classify and edit process steps.
- Add and update observed problems.
- Publish a summary modal.

Static mode limitations:

- GitHub Pages cannot run Python, SQLite, or FFmpeg.
- Uploaded videos are not stored online; they are previewed only in the current browser session.
- Generated clips are browser previews of the uploaded video at selected step times, not server-rendered video files.

## Deploy to GitHub Pages

1. Create a GitHub repository.
2. Push this project to the repository's `main` branch.
3. In GitHub, open **Settings > Pages**.
4. Set **Source** to **GitHub Actions**.
5. Push again or run the **Deploy GitHub Pages** workflow manually.

The included workflow deploys the `docs/` folder.

## Local Static Preview

You can open `docs/index.html` directly in a browser, or serve it with any static server.

```powershell
python -m http.server 8080 -d docs
```

Then open:

```text
http://127.0.0.1:8080
```

## Full Flask Version

Use the Flask version when you need persistent media storage, SQLite, FFmpeg clip generation, and thumbnail generation.

### Requirements

- Python 3.10+
- FFmpeg installed and available on `PATH`

### Run on Windows PowerShell

```powershell
python -m venv .venv
.\.venv\Scripts\Activate
python -m pip install --upgrade pip
pip install -r requirements.txt
python app.py
```

Open:

```text
http://127.0.0.1:5000
```

### Run on macOS / Linux

```bash
python -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
pip install -r requirements.txt
python app.py
```

## Repository Layout

```text
docs/                  GitHub Pages static app
static/                Flask static assets
templates/             Flask HTML templates
app.py                 Flask backend
requirements.txt       Flask dependencies
.github/workflows/     GitHub Pages deployment workflow
```

The `instance/` folder is ignored because it contains local database files, uploaded videos, clips, and thumbnails.
