from __future__ import annotations
import csv, math, wave
from pathlib import Path
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
MUSIC = ROOT / "public" / "assets" / "music"
TARGET_LUFS = -20.0

def read_wav(path: Path):
    with wave.open(str(path), "rb") as h:
        channels, rate, width, frames = h.getnchannels(), h.getframerate(), h.getsampwidth(), h.readframes(h.getnframes())
    if width == 1: samples = (np.frombuffer(frames, dtype=np.uint8).astype(np.float64) - 128) / 128
    elif width == 2: samples = np.frombuffer(frames, dtype="<i2").astype(np.float64) / 32768
    elif width == 3:
        raw = np.frombuffer(frames, dtype=np.uint8).reshape(-1, 3)
        values = raw[:, 0].astype(np.int32) | raw[:, 1].astype(np.int32) << 8 | raw[:, 2].astype(np.int32) << 16
        values = np.where(values & 0x800000, values - 0x1000000, values); samples = values.astype(np.float64) / 8388608
    elif width == 4: samples = np.frombuffer(frames, dtype="<i4").astype(np.float64) / 2147483648
    else: raise ValueError(f"unsupported PCM width: {width}")
    return samples.reshape(-1, channels), rate

def biquad(samples, b, a):
    output = np.empty_like(samples)
    for channel in range(samples.shape[1]):
        x1 = x2 = y1 = y2 = 0.0
        for index, x0 in enumerate(samples[:, channel]):
            y0 = b[0] * x0 + b[1] * x1 + b[2] * x2 - a[0] * y1 - a[1] * y2
            output[index, channel] = y0; x2, x1, y2, y1 = x1, x0, y1, y0
    return output

def high_shelf(rate, frequency=1500.0, gain_db=4.0, q=1 / math.sqrt(2)):
    amplitude = 10 ** (gain_db / 40); omega = 2 * math.pi * frequency / rate; alpha = math.sin(omega) / (2 * q); cosine = math.cos(omega); root = 2 * math.sqrt(amplitude) * alpha
    b0 = amplitude * ((amplitude + 1) + (amplitude - 1) * cosine + root); b1 = -2 * amplitude * ((amplitude - 1) + (amplitude + 1) * cosine); b2 = amplitude * ((amplitude + 1) + (amplitude - 1) * cosine - root)
    a0 = (amplitude + 1) - (amplitude - 1) * cosine + root; a1 = 2 * ((amplitude - 1) - (amplitude + 1) * cosine); a2 = (amplitude + 1) - (amplitude - 1) * cosine - root
    return (b0/a0, b1/a0, b2/a0), (a1/a0, a2/a0)

def high_pass(rate, frequency=38.0, q=.5):
    omega = 2 * math.pi * frequency / rate; alpha = math.sin(omega) / (2*q); cosine = math.cos(omega)
    b0, b1, b2 = (1+cosine)/2, -(1+cosine), (1+cosine)/2; a0, a1, a2 = 1+alpha, -2*cosine, 1-alpha
    return (b0/a0, b1/a0, b2/a0), (a1/a0, a2/a0)

def integrated_lufs(samples, rate):
    weighted = biquad(biquad(samples, *high_shelf(rate)), *high_pass(rate)); block = max(1, round(rate*.4)); step = max(1, round(block*.25))
    if len(weighted) < block: weighted = np.pad(weighted, ((0, block-len(weighted)), (0, 0)))
    energies = np.asarray([float(np.sum(np.mean(weighted[start:start+block]**2, axis=0))) for start in range(0, len(weighted)-block+1, step)])
    loudness = -.691 + 10*np.log10(np.maximum(energies, 1e-15)); absolute = energies[loudness > -70]
    if not len(absolute): return float("-inf")
    relative = -.691 + 10*math.log10(float(np.mean(absolute))) - 10; gated = energies[(loudness > -70) & (loudness > relative)]
    return -.691 + 10*math.log10(float(np.mean(gated))) if len(gated) else float("-inf")

def main():
    rows = []
    for path in sorted(MUSIC.glob("*.wav")):
        samples, rate = read_wav(path); lufs = integrated_lufs(samples, rate); peak = 20*math.log10(max(float(np.max(np.abs(samples))), 1e-12)); gain = min(TARGET_LUFS-lufs, -1-peak)
        rows.append({"file":path.name,"duration_s":round(len(samples)/rate,3),"sample_rate":rate,"channels":samples.shape[1],"integrated_lufs":round(lufs,2),"sample_peak_dbfs":round(peak,2),"target_lufs":TARGET_LUFS,"suggested_gain_db":round(gain,2),"action":"保持" if abs(gain)<1 else ("降低" if gain<0 else "提高")})
    with (MUSIC/"audio-loudness-report.csv").open("w",newline="",encoding="utf-8-sig") as h:
        writer=csv.DictWriter(h,fieldnames=rows[0].keys()); writer.writeheader(); writer.writerows(rows)
    lines=["# 游戏音效响度分析","",f"统一比较目标：{TARGET_LUFS:.0f} LUFS；峰值上限：-1 dBFS。当前文件未被覆盖或归一化。","","| 文件 | 时长(s) | LUFS | 峰值 dBFS | 建议增益 dB | 操作 |","|---|---:|---:|---:|---:|---|"]
    lines += [f"| {r['file']} | {r['duration_s']} | {r['integrated_lufs']} | {r['sample_peak_dbfs']} | {r['suggested_gain_db']} | {r['action']} |" for r in rows]
    (MUSIC/"audio-loudness-report.md").write_text("\n".join(lines)+"\n",encoding="utf-8")

if __name__ == "__main__": main()
