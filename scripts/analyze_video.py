#!/usr/bin/env python3
"""
One-shot analysis for the beat-synced edit pipeline: given a source video,
detects kick/snare-ish beats from its audio and hard-cut clip boundaries
from its picture, then assigns each beat a weighted-random effect
(horizontal stretch dominant, everything else occasional/rare) scaled by a
per-video intensity multiplier.

This is meant to be run once per new input video. Output is a single JSON
blob consumed by build-props.js to produce the final Remotion props file.

Usage:
  python3 scripts/analyze_video.py <input.mp4> <out.json> [--intensity-multiplier X] [--seed N]

If --intensity-multiplier is omitted, one is drawn uniformly from
[1.4, 1.6] (tuned after reviewing test renders at 1.2x and 1.5x) and
reported in the output JSON so it's logged per video.
"""
import argparse
import glob
import json
import os
import random
import shutil
import subprocess
import sys
import tempfile

import numpy as np

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _works(exe_path):
    try:
        subprocess.run([exe_path, "-version"], capture_output=True, timeout=10)
        return True
    except (OSError, subprocess.SubprocessError):
        # e.g. a musl-linked binary's dynamic loader missing on a glibc host,
        # or an unrelated platform's compositor package present on disk
        return False


def _find_ffmpeg():
    """Locate an ffmpeg binary: prefer one bundled with whichever
    @remotion/compositor-* package(s) npm installed (no separate download
    needed), falling back to a system ffmpeg on PATH. npm can end up with
    more than one platform variant on disk (e.g. both the gnu and musl
    linux builds) so each candidate is actually exec'd, not just checked
    for existence, before it's trusted."""
    compositor_glob = os.path.join(REPO_ROOT, "node_modules", "@remotion", "compositor-*")
    exe_name = "ffmpeg.exe" if os.name == "nt" else "ffmpeg"
    for compositor_dir in sorted(glob.glob(compositor_glob)):
        candidate = os.path.join(compositor_dir, exe_name)
        if os.path.isfile(candidate) and _works(candidate):
            return candidate

    system_ffmpeg = shutil.which("ffmpeg")
    if system_ffmpeg and _works(system_ffmpeg):
        return system_ffmpeg

    raise RuntimeError(
        "No working ffmpeg found: expected a node_modules/@remotion/compositor-*/ffmpeg "
        "(run `npm install` first) or a system ffmpeg on PATH."
    )


FFMPEG = _find_ffmpeg()
FPS = 30


def probe_duration_and_frames(video_path):
    out = subprocess.run(
        [FFMPEG, "-i", video_path, "-map", "0:v:0", "-c", "copy", "-f", "null", "-"],
        capture_output=True,
        text=True,
    ).stderr
    frame_count = None
    for line in out.splitlines():
        if line.strip().startswith("frame="):
            try:
                frame_count = int(line.split("frame=")[1].split()[0])
            except (IndexError, ValueError):
                pass
    if frame_count is None:
        raise RuntimeError(f"Could not determine frame count for {video_path}")
    return frame_count


def extract_audio(video_path, out_wav):
    subprocess.run(
        [
            FFMPEG, "-y", "-i", video_path, "-vn", "-ac", "1", "-ar", "22050",
            "-f", "wav", out_wav,
        ],
        check=True,
        capture_output=True,
    )


def detect_beats(wav_path):
    import wave

    wf = wave.open(wav_path, "rb")
    sr = wf.getframerate()
    n = wf.getnframes()
    raw = wf.readframes(n)
    wf.close()

    audio = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0

    n_fft = 1024
    hop = 256
    window = np.hanning(n_fft)
    n_frames = 1 + (len(audio) - n_fft) // hop
    if n_frames <= 0:
        return []
    spec = np.zeros((n_frames, n_fft // 2 + 1), dtype=np.float32)
    for i in range(n_frames):
        start = i * hop
        frame = audio[start:start + n_fft] * window
        spec[i] = np.abs(np.fft.rfft(frame))

    freqs = np.fft.rfftfreq(n_fft, 1.0 / sr)
    low_band = (freqs >= 40) & (freqs <= 150)
    snare_band = (freqs >= 150) & (freqs <= 6000)
    low_energy = spec[:, low_band].sum(axis=1)
    snare_energy = spec[:, snare_band].sum(axis=1)

    def spectral_flux(env):
        diff = np.diff(env, prepend=env[0])
        diff[diff < 0] = 0
        return diff

    def normalize(x):
        x = x - x.min()
        m = x.max()
        return x / m if m > 0 else x

    low_flux_n = normalize(spectral_flux(low_energy))
    snare_flux_n = normalize(spectral_flux(snare_energy))
    combined = 0.55 * low_flux_n + 0.45 * snare_flux_n
    frame_times = np.arange(n_frames) * hop / sr

    mean, std = combined.mean(), combined.std()
    thresh = max(mean + 0.8 * std, combined.max() * 0.28)
    min_gap_s = 0.14

    peaks = []
    last_t = -10
    for i in range(1, len(combined) - 1):
        if (
            combined[i] > thresh
            and combined[i] >= combined[i - 1]
            and combined[i] >= combined[i + 1]
        ):
            t = frame_times[i]
            if t - last_t >= min_gap_s:
                peaks.append((t, float(combined[i])))
                last_t = t

    seen = set()
    beats = []
    for t, strength in peaks:
        f = round(t * FPS)
        if f not in seen:
            seen.add(f)
            beats.append({"frame": int(f), "time": round(float(t), 3), "strength": round(strength, 3)})
    beats.sort(key=lambda x: x["frame"])
    return beats


def assign_effects(beats, intensity_multiplier, rng):
    if not beats:
        return []
    strengths = [b["strength"] for b in beats]
    smin, smax = min(strengths), max(strengths)

    def norm_strength(s):
        return 0.5 if smax == smin else (s - smin) / (smax - smin)

    # Horizontal stretch dominant, vertical stretch secondary, everything
    # else occasional-to-rare.
    pool = [
        ("horizontalStretch", 58),
        ("verticalStretch", 10),
        ("zoom", 14),
        ("shake", 7),
        ("glitchSlice", 6),
        ("colorGlitch", 3),
        ("warp", 2),
    ]
    names = [p[0] for p in pool]
    weights = [p[1] for p in pool]

    def pick(prev, prev2):
        for _ in range(8):
            choice = rng.choices(names, weights=weights, k=1)[0]
            if choice == prev and choice not in ("horizontalStretch", "verticalStretch"):
                continue
            if choice == prev == prev2:
                continue
            return choice
        return "horizontalStretch"

    events = []
    prev = prev2 = None
    for i, b in enumerate(beats):
        ns = norm_strength(b["strength"])
        effect = pick(prev, prev2)
        prev2, prev = prev, effect

        gap_frames = beats[i + 1]["frame"] - b["frame"] if i + 1 < len(beats) else 10
        decay_frames = max(4, min(gap_frames, 14))

        base_intensity = 0.45 + 0.55 * ns  # 0.45..1.0, "what we have now"
        intensity = round(base_intensity * intensity_multiplier, 3)

        events.append({
            "frame": b["frame"],
            "time": b["time"],
            "type": effect,
            "intensity": intensity,
            "decayFrames": decay_frames,
        })
    return events


def detect_cuts(video_path, total_frames):
    from PIL import Image

    with tempfile.TemporaryDirectory() as tmp:
        pattern = os.path.join(tmp, "f%04d.png")
        subprocess.run(
            [FFMPEG, "-y", "-i", video_path, "-vf", "scale=120:213", "-pix_fmt", "rgb24", "-f", "image2", pattern],
            check=True,
            capture_output=True,
        )
        files = sorted(f for f in os.listdir(tmp) if f.endswith(".png"))
        imgs = [np.asarray(Image.open(os.path.join(tmp, f)).convert("RGB"), dtype=np.float32) for f in files]

    if len(imgs) < 2:
        return [0]

    diffs = np.array([np.abs(imgs[i] - imgs[i - 1]).mean() for i in range(1, len(imgs))])
    thresh = diffs.mean() + 2.2 * diffs.std()

    cuts = [0]
    min_gap = 12
    for i, d in enumerate(diffs):
        frame_idx = i + 1
        if d > thresh and frame_idx - cuts[-1] >= min_gap:
            cuts.append(frame_idx)
    return cuts


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("input_video")
    parser.add_argument("out_json")
    parser.add_argument("--intensity-multiplier", type=float, default=None)
    parser.add_argument("--seed", type=int, default=None)
    args = parser.parse_args()

    seed = args.seed if args.seed is not None else random.randint(0, 2**31 - 1)
    rng = random.Random(seed)

    intensity_multiplier = args.intensity_multiplier
    if intensity_multiplier is None:
        intensity_multiplier = round(rng.uniform(1.4, 1.6), 3)
    if not (1.4 <= intensity_multiplier <= 1.6):
        print(f"warning: intensity multiplier {intensity_multiplier} outside the agreed [1.4, 1.6] range", file=sys.stderr)

    total_frames = probe_duration_and_frames(args.input_video)

    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp_wav:
        wav_path = tmp_wav.name
    try:
        extract_audio(args.input_video, wav_path)
        beats = detect_beats(wav_path)
    finally:
        os.unlink(wav_path)

    effects = assign_effects(beats, intensity_multiplier, rng)
    cuts = detect_cuts(args.input_video, total_frames)

    result = {
        "totalFrames": total_frames,
        "fps": FPS,
        "intensityMultiplier": intensity_multiplier,
        "seed": seed,
        "beats": effects,
        "cuts": cuts,
    }
    with open(args.out_json, "w") as f:
        json.dump(result, f, indent=2)

    print(
        f"analyzed {args.input_video}: {total_frames} frames, {len(effects)} beats, "
        f"{len(cuts)} clips, intensity x{intensity_multiplier}"
    )


if __name__ == "__main__":
    main()
