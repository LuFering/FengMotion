import json, os, subprocess, wave
import numpy as np

BASE = "/home/lufering/remotion/electron/public/city-night"
SR = 48000
timing = json.load(open(os.path.join(BASE, "timing.json")))
total = timing["totalSeconds"]
N = int(round(total * SR)) + SR // 2
track = np.zeros(N, dtype=np.float64)

def decode(path):
    raw = subprocess.check_output([
        "ffmpeg", "-v", "error", "-i", path, "-ar", str(SR), "-ac", "1",
        "-f", "s16le", "-"
    ])
    return np.frombuffer(raw, dtype=np.int16).astype(np.float64) / 32768.0

for line in timing["lines"]:
    key = line["key"]
    path = os.path.join(BASE, f"vo-{key}.mp3")
    sig = decode(path)
    start = int(round(line["start"] * SR))
    end = min(N, start + len(sig))
    sig = sig[: end - start]
    # 6ms de-click
    f = int(0.006 * SR)
    if len(sig) > 2 * f:
        sig[:f] *= np.linspace(0, 1, f)
        sig[-f:] *= np.linspace(1, 0, f)
    track[start:end] += sig
    print(f"{key:6s} placed {line['start']:6.2f}s  len {len(sig)/SR:5.2f}s")

peak = np.max(np.abs(track))
track = track / peak * 0.72
pcm = np.repeat((np.clip(track, -1, 1) * 32767).astype(np.int16)[:, None], 2, axis=1)
with wave.open(os.path.join(BASE, "vo.wav"), "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(pcm.tobytes())

# verify per line
a = pcm[:, 0].astype(np.float64) / 32768
for line in timing["lines"]:
    s, e = line["start"], line["end"]
    def rms(x, y):
        seg = a[int(x * SR):int(y * SR)]
        return 20 * np.log10(max(1e-9, np.sqrt((seg ** 2).mean())))
    print(f"{line['key']:6s} start {rms(s+0.1,s+1):6.1f}  mid {rms((s+e)/2-0.5,(s+e)/2+0.5):6.1f}  end {rms(e-1,e-0.1):6.1f}")
print("vo.wav", round(len(pcm) / SR, 2), "s, peak", round(float(peak), 3))
