from __future__ import annotations

import shutil
import sqlite3
import subprocess
import uuid
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

from flask import Flask, jsonify, render_template, request, send_from_directory
from werkzeug.utils import secure_filename

BASE_DIR = Path(__file__).resolve().parent
INSTANCE_DIR = BASE_DIR / 'instance'
STUDIES_DIR = INSTANCE_DIR / 'studies'
DB_PATH = INSTANCE_DIR / 'kaizen.db'
ALLOWED_VIDEO = {'.mp4', '.mov', '.m4v', '.webm', '.avi', '.mkv'}


class VideoToolError(RuntimeError):
    pass


@dataclass
class AppPaths:
    study_dir: Path
    original_dir: Path
    clips_dir: Path
    thumbs_dir: Path


app = Flask(__name__, instance_path=str(INSTANCE_DIR), instance_relative_config=True)
app.config['MAX_CONTENT_LENGTH'] = 1024 * 1024 * 1024


def connect_db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA foreign_keys = ON')
    return conn


def utc_now() -> str:
    return datetime.utcnow().isoformat(timespec='seconds') + 'Z'


def init_db() -> None:
    INSTANCE_DIR.mkdir(parents=True, exist_ok=True)
    STUDIES_DIR.mkdir(parents=True, exist_ok=True)
    with connect_db() as conn:
        conn.executescript(
            '''
            CREATE TABLE IF NOT EXISTS studies (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                owner TEXT,
                line TEXT,
                area TEXT,
                goal TEXT,
                status TEXT NOT NULL DEFAULT 'draft',
                duration_minutes INTEGER DEFAULT 2,
                snapshot_interval INTEGER DEFAULT 15,
                frames_target INTEGER DEFAULT 0,
                sampling_rule TEXT DEFAULT 'systematic',
                video_filename TEXT,
                video_duration REAL DEFAULT 0,
                published_at TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS issues (
                id TEXT PRIMARY KEY,
                study_id TEXT NOT NULL,
                title TEXT NOT NULL,
                detail TEXT,
                priority TEXT DEFAULT 'medium',
                status TEXT DEFAULT 'todo',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(study_id) REFERENCES studies(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS process_steps (
                id TEXT PRIMARY KEY,
                study_id TEXT NOT NULL,
                sort_order INTEGER NOT NULL,
                name TEXT NOT NULL,
                title TEXT NOT NULL,
                start_seconds REAL NOT NULL,
                end_seconds REAL NOT NULL,
                timing_ms INTEGER NOT NULL,
                classification TEXT DEFAULT 'non-value-add',
                materials TEXT DEFAULT '',
                tools TEXT DEFAULT '',
                key_points TEXT DEFAULT '',
                notes TEXT DEFAULT '',
                clip_filename TEXT,
                thumbnail_filename TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(study_id) REFERENCES studies(id) ON DELETE CASCADE
            );
            '''
        )


def ensure_study_paths(study_id: str) -> AppPaths:
    study_dir = STUDIES_DIR / study_id
    original_dir = study_dir / 'original'
    clips_dir = study_dir / 'clips'
    thumbs_dir = study_dir / 'thumbs'
    for path in (study_dir, original_dir, clips_dir, thumbs_dir):
        path.mkdir(parents=True, exist_ok=True)
    return AppPaths(study_dir, original_dir, clips_dir, thumbs_dir)


def public_media_url(study_id: str, section: str, filename: str | None) -> str | None:
    if not filename:
        return None
    return f'/media/{study_id}/{section}/{filename}'


def ffprobe_duration(path: Path) -> float:
    cmd = [
        'ffprobe', '-v', 'error', '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1', str(path)
    ]
    try:
        completed = subprocess.run(cmd, capture_output=True, text=True, check=True)
    except FileNotFoundError as exc:
        raise VideoToolError('FFmpeg/ffprobe is not installed or not available on PATH.') from exc
    except subprocess.CalledProcessError as exc:
        raise VideoToolError(exc.stderr.strip() or 'Unable to read video duration with ffprobe.') from exc
    try:
        return float((completed.stdout or '0').strip() or 0)
    except ValueError:
        return 0.0


def run_ffmpeg(args: list[str]) -> None:
    try:
        subprocess.run(
            ['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', *args],
            capture_output=True,
            text=True,
            check=True,
        )
    except FileNotFoundError as exc:
        raise VideoToolError('FFmpeg is not installed or not available on PATH.') from exc
    except subprocess.CalledProcessError as exc:
        message = (exc.stderr or '').strip()
        if not message:
            message = 'FFmpeg could not generate the clip for this step.'
        raise VideoToolError(message) from exc


def try_generate_step_media(paths: AppPaths, video_path: Path, step_id: str, sort_order: int, start: float, end: float) -> tuple[str | None, str | None]:
    try:
        return generate_step_media(paths, video_path, step_id, sort_order, start, end)
    except VideoToolError:
        return None, None


def clamp_segment(start: float, end: float, duration: float) -> tuple[float, float]:
    start = max(0.0, float(start or 0.0))
    duration = max(0.1, float(duration or 0.0))
    end = max(start + 0.1, float(end or start + 0.1))
    if start >= duration:
        start = max(0.0, duration - 0.1)
    if end > duration:
        end = duration
    if end <= start:
        end = min(duration, start + 0.1)
    return round(start, 3), round(end, 3)


def dict_from_row(row: sqlite3.Row) -> dict[str, Any]:
    return {k: row[k] for k in row.keys()}


def fetch_study(conn: sqlite3.Connection, study_id: str) -> dict[str, Any] | None:
    row = conn.execute('SELECT * FROM studies WHERE id = ?', (study_id,)).fetchone()
    if not row:
        return None
    study = dict_from_row(row)
    issues = conn.execute(
        'SELECT * FROM issues WHERE study_id = ? ORDER BY created_at ASC', (study_id,)
    ).fetchall()
    steps = conn.execute(
        'SELECT * FROM process_steps WHERE study_id = ? ORDER BY sort_order ASC, created_at ASC', (study_id,)
    ).fetchall()
    study['issues'] = [
        {
            'id': r['id'],
            'title': r['title'],
            'detail': r['detail'],
            'priority': r['priority'],
            'status': r['status'],
        }
        for r in issues
    ]
    study['process_steps'] = [
        {
            'id': r['id'],
            'sort_order': r['sort_order'],
            'name': r['name'],
            'title': r['title'],
            'start_seconds': r['start_seconds'],
            'end_seconds': r['end_seconds'],
            'timing_ms': r['timing_ms'],
            'classification': r['classification'],
            'materials': r['materials'],
            'tools': r['tools'],
            'key_points': r['key_points'],
            'notes': r['notes'],
            'clip_url': public_media_url(study_id, 'clips', r['clip_filename']),
            'thumbnail_url': public_media_url(study_id, 'thumbs', r['thumbnail_filename']),
        }
        for r in steps
    ]
    study['video_url'] = public_media_url(study_id, 'original', study['video_filename'])
    return study


def study_summary(study: dict[str, Any]) -> list[str]:
    issue_counts = {'todo': 0, 'doing': 0, 'done': 0}
    for issue in study.get('issues', []):
        issue_counts[issue['status']] = issue_counts.get(issue['status'], 0) + 1
    return [
        f"{study['title']} is currently marked as {study['status']}.",
        f"Sampling uses {study.get('sampling_rule') or 'systematic'} review over {study.get('duration_minutes') or 0} minutes with {study.get('snapshot_interval') or 0} second intervals.",
        f"{len(study.get('process_steps', []))} process steps are available for detailed editing.",
        f"{issue_counts['todo']} open issues, {issue_counts['doing']} in progress issues, and {issue_counts['done']} completed issues are tracked.",
        f"Study owner: {study.get('owner') or 'Not assigned'}. Line/area: {study.get('line') or '-'} / {study.get('area') or '-'}.",
    ]


def cleanup_step_media(paths: AppPaths, clip_filename: str | None, thumb_filename: str | None) -> None:
    for folder, filename in ((paths.clips_dir, clip_filename), (paths.thumbs_dir, thumb_filename)):
        if filename:
            target = folder / filename
            if target.exists():
                target.unlink(missing_ok=True)


def generate_step_media(paths: AppPaths, video_path: Path, step_id: str, sort_order: int, start: float, end: float) -> tuple[str, str]:
    clip_name = f'step_{sort_order + 1:03d}_{step_id[:8]}.mp4'
    thumb_name = f'step_{sort_order + 1:03d}_{step_id[:8]}.jpg'
    clip_path = paths.clips_dir / clip_name
    thumb_path = paths.thumbs_dir / thumb_name
    segment_length = max(0.1, end - start)
    thumb_time = start + min(segment_length / 2, 0.5)
    run_ffmpeg([
        '-i', str(video_path), '-ss', f'{start:.3f}', '-t', f'{segment_length:.3f}',
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-c:a', 'aac', '-movflags', '+faststart', str(clip_path)
    ])
    run_ffmpeg([
        '-i', str(video_path), '-ss', f'{thumb_time:.3f}', '-frames:v', '1', '-q:v', '3', str(thumb_path)
    ])
    return clip_name, thumb_name


def reorder_steps(conn: sqlite3.Connection, study_id: str) -> None:
    rows = conn.execute(
        'SELECT id FROM process_steps WHERE study_id = ? ORDER BY sort_order ASC, created_at ASC', (study_id,)
    ).fetchall()
    for idx, row in enumerate(rows):
        conn.execute('UPDATE process_steps SET sort_order = ? WHERE id = ?', (idx, row['id']))


def get_video_path_for_study(study: dict[str, Any]) -> Path | None:
    if not study.get('video_filename'):
        return None
    return ensure_study_paths(study['id']).original_dir / study['video_filename']


@app.errorhandler(VideoToolError)
def handle_video_tool_error(error: VideoToolError):
    return jsonify({'error': str(error)}), 500


@app.route('/')
def index() -> str:
    return render_template('index.html')


@app.route('/media/<study_id>/<section>/<path:filename>')
def media_file(study_id: str, section: str, filename: str):
    root = ensure_study_paths(study_id)
    folder = {'original': root.original_dir, 'clips': root.clips_dir, 'thumbs': root.thumbs_dir}.get(section)
    if folder is None:
        return 'Not found', 404
    return send_from_directory(folder, filename)


@app.get('/api/studies')
def list_studies():
    with connect_db() as conn:
        ids = [row['id'] for row in conn.execute('SELECT id FROM studies ORDER BY created_at DESC').fetchall()]
        payload = [fetch_study(conn, study_id) for study_id in ids]
    return jsonify(payload)


@app.post('/api/studies')
def create_study():
    data = request.get_json(force=True)
    study_id = str(uuid.uuid4())
    now = utc_now()
    with connect_db() as conn:
        conn.execute(
            '''
            INSERT INTO studies (
                id, title, owner, line, area, goal, status,
                duration_minutes, snapshot_interval, frames_target,
                sampling_rule, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''',
            (
                study_id,
                (data.get('title') or '').strip() or 'Untitled Study',
                (data.get('owner') or '').strip(),
                (data.get('line') or '').strip(),
                (data.get('area') or '').strip(),
                (data.get('goal') or '').strip(),
                data.get('status', 'draft'),
                int(data.get('duration_minutes') or 2),
                int(data.get('snapshot_interval') or 15),
                int(data.get('frames_target') or 0),
                data.get('sampling_rule', 'systematic'),
                now,
                now,
            ),
        )
        study = fetch_study(conn, study_id)
    ensure_study_paths(study_id)
    return jsonify(study), 201


@app.patch('/api/studies/<study_id>')
def update_study(study_id: str):
    data = request.get_json(force=True)
    fields = {
        'title': data.get('title'),
        'owner': data.get('owner'),
        'line': data.get('line'),
        'area': data.get('area'),
        'goal': data.get('goal'),
        'status': data.get('status'),
        'duration_minutes': data.get('duration_minutes'),
        'snapshot_interval': data.get('snapshot_interval'),
        'frames_target': data.get('frames_target'),
        'sampling_rule': data.get('sampling_rule'),
    }
    updates = []
    values: list[Any] = []
    for key, value in fields.items():
        if value is not None:
            updates.append(f'{key} = ?')
            values.append(value)
    if not updates:
        return jsonify({'error': 'No changes supplied'}), 400
    updates.append('updated_at = ?')
    values.append(utc_now())
    values.append(study_id)
    with connect_db() as conn:
        conn.execute(f"UPDATE studies SET {', '.join(updates)} WHERE id = ?", values)
        study = fetch_study(conn, study_id)
    if not study:
        return jsonify({'error': 'Study not found'}), 404
    return jsonify(study)


@app.delete('/api/studies/<study_id>')
def delete_study(study_id: str):
    with connect_db() as conn:
        conn.execute('DELETE FROM studies WHERE id = ?', (study_id,))
    study_dir = STUDIES_DIR / study_id
    if study_dir.exists():
        shutil.rmtree(study_dir, ignore_errors=True)
    return jsonify({'ok': True})


@app.post('/api/studies/<study_id>/video')
def upload_video(study_id: str):
    uploaded = request.files.get('video')
    if uploaded is None or uploaded.filename == '':
        return jsonify({'error': 'No video file received'}), 400
    suffix = Path(uploaded.filename).suffix.lower()
    if suffix not in ALLOWED_VIDEO:
        return jsonify({'error': f'Unsupported file type: {suffix}'}), 400
    paths = ensure_study_paths(study_id)
    safe_name = secure_filename(uploaded.filename)
    stored_name = f'video{suffix}' if safe_name else f'video{suffix or ".mp4"}'
    target = paths.original_dir / stored_name
    for old in paths.original_dir.glob('*'):
        if old.is_file():
            old.unlink(missing_ok=True)
    uploaded.save(target)
    duration = ffprobe_duration(target)
    now = utc_now()
    with connect_db() as conn:
        step_rows = conn.execute('SELECT clip_filename, thumbnail_filename FROM process_steps WHERE study_id = ?', (study_id,)).fetchall()
        for row in step_rows:
            cleanup_step_media(paths, row['clip_filename'], row['thumbnail_filename'])
        conn.execute('DELETE FROM process_steps WHERE study_id = ?', (study_id,))
        conn.execute(
            'UPDATE studies SET video_filename = ?, video_duration = ?, frames_target = 0, updated_at = ? WHERE id = ?',
            (stored_name, duration, now, study_id),
        )
        study = fetch_study(conn, study_id)
    return jsonify(study)


@app.delete('/api/studies/<study_id>/video')
def delete_video(study_id: str):
    paths = ensure_study_paths(study_id)
    with connect_db() as conn:
        study = fetch_study(conn, study_id)
        if not study:
            return jsonify({'error': 'Study not found'}), 404
        for row in conn.execute('SELECT clip_filename, thumbnail_filename FROM process_steps WHERE study_id = ?', (study_id,)).fetchall():
            cleanup_step_media(paths, row['clip_filename'], row['thumbnail_filename'])
        conn.execute('DELETE FROM process_steps WHERE study_id = ?', (study_id,))
        conn.execute('UPDATE studies SET video_filename = NULL, video_duration = 0, frames_target = 0, updated_at = ? WHERE id = ?', (utc_now(), study_id))
        for file in paths.original_dir.glob('*'):
            if file.is_file():
                file.unlink(missing_ok=True)
        study = fetch_study(conn, study_id)
    return jsonify(study)


@app.post('/api/studies/<study_id>/build_steps')
def build_steps(study_id: str):
    with connect_db() as conn:
        study = fetch_study(conn, study_id)
        if not study:
            return jsonify({'error': 'Study not found'}), 404
        if not study.get('video_filename'):
            return jsonify({'error': 'Upload a video first'}), 400

    paths = ensure_study_paths(study_id)
    video_path = paths.original_dir / study['video_filename']
    duration = ffprobe_duration(video_path)
    interval = max(1, int(study.get('snapshot_interval') or 15))

    now = utc_now()
    start = 0.0
    index = 0
    with connect_db() as conn:
        for row in conn.execute('SELECT clip_filename, thumbnail_filename FROM process_steps WHERE study_id = ?', (study_id,)).fetchall():
            cleanup_step_media(paths, row['clip_filename'], row['thumbnail_filename'])
        conn.execute('DELETE FROM process_steps WHERE study_id = ?', (study_id,))
        while start < max(duration, 0.1):
            end = min(duration, start + interval)
            if end <= start:
                break
            step_id = str(uuid.uuid4())
            clip_name, thumb_name = generate_step_media(paths, video_path, step_id, index, start, end)
            conn.execute(
                '''
                INSERT INTO process_steps (
                    id, study_id, sort_order, name, title, start_seconds, end_seconds,
                    timing_ms, classification, materials, tools, key_points, notes,
                    clip_filename, thumbnail_filename, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '', '', '', '', ?, ?, ?, ?)
                ''',
                (
                    step_id, study_id, index, f'Step {index + 1}', f'Observed action {index + 1}',
                    round(start, 3), round(end, 3), int(max(1, round((end - start) * 1000))),
                    'non-value-add', clip_name, thumb_name, now, now,
                ),
            )
            index += 1
            start = end
        conn.execute(
            'UPDATE studies SET frames_target = ?, video_duration = ?, updated_at = ? WHERE id = ?',
            (index, duration, now, study_id),
        )
        result = fetch_study(conn, study_id)
    return jsonify(result)


@app.post('/api/studies/<study_id>/steps')
def create_step(study_id: str):
    data = request.get_json(force=True)
    with connect_db() as conn:
        study = fetch_study(conn, study_id)
        if not study:
            return jsonify({'error': 'Study not found'}), 404
        sort_order = conn.execute('SELECT COUNT(*) AS c FROM process_steps WHERE study_id = ?', (study_id,)).fetchone()['c']
        start = float(data.get('start_seconds') or 0)
        end = float(data.get('end_seconds') or (start + max(1, int(study.get('snapshot_interval') or 15))))
        start, end = clamp_segment(start, end, float(study.get('video_duration') or end or 0.1))
        step_id = str(uuid.uuid4())
        clip_name = None
        thumb_name = None
        if study.get('video_filename'):
            paths = ensure_study_paths(study_id)
            clip_name, thumb_name = try_generate_step_media(
                paths,
                paths.original_dir / study['video_filename'],
                step_id,
                sort_order,
                start,
                end,
            )
        now = utc_now()
        conn.execute(
            '''
            INSERT INTO process_steps (
                id, study_id, sort_order, name, title, start_seconds, end_seconds,
                timing_ms, classification, materials, tools, key_points, notes,
                clip_filename, thumbnail_filename, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''',
            (
                step_id, study_id, sort_order,
                (data.get('name') or f'Step {sort_order + 1}').strip(),
                (data.get('title') or f'Observed action {sort_order + 1}').strip(),
                start, end, int(max(1, round((end - start) * 1000))),
                data.get('classification', 'non-value-add'),
                data.get('materials', ''), data.get('tools', ''), data.get('key_points', ''), data.get('notes', ''),
                clip_name, thumb_name, now, now,
            ),
        )
        conn.execute('UPDATE studies SET frames_target = ?, updated_at = ? WHERE id = ?', (sort_order + 1, now, study_id))
        result = fetch_study(conn, study_id)
    return jsonify(result), 201


@app.patch('/api/studies/<study_id>/steps/<step_id>')
def update_step(study_id: str, step_id: str):
    data = request.get_json(force=True)
    allowed = {
        'name': 'name', 'title': 'title', 'classification': 'classification', 'materials': 'materials',
        'tools': 'tools', 'key_points': 'key_points', 'notes': 'notes'
    }
    with connect_db() as conn:
        step = conn.execute('SELECT * FROM process_steps WHERE id = ? AND study_id = ?', (step_id, study_id)).fetchone()
        study = fetch_study(conn, study_id)
        if not step or not study:
            return jsonify({'error': 'Step not found'}), 404
        updates = []
        values: list[Any] = []
        for key, column in allowed.items():
            if key in data:
                updates.append(f'{column} = ?')
                values.append(data[key])
        start = float(data.get('start_seconds', step['start_seconds']))
        end = float(data.get('end_seconds', step['end_seconds']))
        timing_changed = 'start_seconds' in data or 'end_seconds' in data
        if timing_changed:
            start, end = clamp_segment(start, end, float(study.get('video_duration') or end or 0.1))
            updates.extend(['start_seconds = ?', 'end_seconds = ?', 'timing_ms = ?'])
            values.extend([start, end, int(max(1, round((end - start) * 1000)))])
            if study.get('video_filename'):
                paths = ensure_study_paths(study_id)
                cleanup_step_media(paths, step['clip_filename'], step['thumbnail_filename'])
                clip_name, thumb_name = try_generate_step_media(
                    paths,
                    paths.original_dir / study['video_filename'],
                    step_id,
                    step['sort_order'],
                    start,
                    end,
                )
                updates.extend(['clip_filename = ?', 'thumbnail_filename = ?'])
                values.extend([clip_name, thumb_name])
        if not updates:
            return jsonify({'error': 'No step changes supplied'}), 400
        updates.append('updated_at = ?')
        values.append(utc_now())
        values.extend([step_id, study_id])
        conn.execute(f"UPDATE process_steps SET {', '.join(updates)} WHERE id = ? AND study_id = ?", values)
        result = fetch_study(conn, study_id)
    return jsonify(result)


@app.delete('/api/studies/<study_id>/steps/<step_id>')
def delete_step(study_id: str, step_id: str):
    paths = ensure_study_paths(study_id)
    with connect_db() as conn:
        row = conn.execute('SELECT clip_filename, thumbnail_filename FROM process_steps WHERE id = ? AND study_id = ?', (step_id, study_id)).fetchone()
        if row:
            cleanup_step_media(paths, row['clip_filename'], row['thumbnail_filename'])
        conn.execute('DELETE FROM process_steps WHERE id = ? AND study_id = ?', (step_id, study_id))
        reorder_steps(conn, study_id)
        count = conn.execute('SELECT COUNT(*) AS c FROM process_steps WHERE study_id = ?', (study_id,)).fetchone()['c']
        conn.execute('UPDATE studies SET frames_target = ?, updated_at = ? WHERE id = ?', (count, utc_now(), study_id))
        result = fetch_study(conn, study_id)
    return jsonify(result)


@app.post('/api/studies/<study_id>/issues')
def create_issue(study_id: str):
    data = request.get_json(force=True)
    issue_id = str(uuid.uuid4())
    now = utc_now()
    with connect_db() as conn:
        conn.execute(
            '''INSERT INTO issues (id, study_id, title, detail, priority, status, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)''',
            (
                issue_id, study_id, (data.get('title') or '').strip() or 'New Issue',
                (data.get('detail') or '').strip(), data.get('priority', 'medium'),
                data.get('status', 'todo'), now, now,
            ),
        )
        result = fetch_study(conn, study_id)
    return jsonify(result), 201


@app.patch('/api/studies/<study_id>/issues/<issue_id>')
def update_issue(study_id: str, issue_id: str):
    data = request.get_json(force=True)
    allowed = {'title', 'detail', 'priority', 'status'}
    updates = []
    values: list[Any] = []
    for key in allowed:
        if key in data:
            updates.append(f'{key} = ?')
            values.append(data[key])
    if not updates:
        return jsonify({'error': 'No issue changes supplied'}), 400
    updates.append('updated_at = ?')
    values.append(utc_now())
    values.extend([issue_id, study_id])
    with connect_db() as conn:
        conn.execute(f"UPDATE issues SET {', '.join(updates)} WHERE id = ? AND study_id = ?", values)
        result = fetch_study(conn, study_id)
    return jsonify(result)


@app.delete('/api/studies/<study_id>/issues/<issue_id>')
def delete_issue(study_id: str, issue_id: str):
    with connect_db() as conn:
        conn.execute('DELETE FROM issues WHERE id = ? AND study_id = ?', (issue_id, study_id))
        result = fetch_study(conn, study_id)
    return jsonify(result)


@app.post('/api/studies/<study_id>/publish')
def publish_study(study_id: str):
    now = utc_now()
    with connect_db() as conn:
        conn.execute('UPDATE studies SET status = ?, published_at = ?, updated_at = ? WHERE id = ?', ('published', now, now, study_id))
        study = fetch_study(conn, study_id)
    if not study:
        return jsonify({'error': 'Study not found'}), 404
    return jsonify({'study': study, 'summary': study_summary(study)})


@app.get('/api/studies/<study_id>/publish')
def get_publish(study_id: str):
    with connect_db() as conn:
        study = fetch_study(conn, study_id)
    if not study:
        return jsonify({'error': 'Study not found'}), 404
    return jsonify({'study': study, 'summary': study_summary(study)})


@app.get('/health')
def health():
    return jsonify({'ok': True})


init_db()

if __name__ == '__main__':
    app.run(debug=True, host='127.0.0.1', port=5000)
