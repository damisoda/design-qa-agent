"""VLM 실패 진단 시험 1단계: 학습된 정책을 여러 시드로 돌려 실패 2개·성공 1개를 찾고,
시점별 장면 6장(한 장으로 묶음)과 시뮬레이터 수치 기록(채점용 정답)을 저장한다.
모델에게는 이미지와 작업 설명만 주고, 수치 기록은 채점에만 쓴다."""
import json
import os
import sys

ROOT = os.path.expanduser("~/robot-kernel")
sys.path.insert(0, os.path.join(ROOT, "shims"))
OUT = os.path.join(ROOT, "experiments", "vlm_probe", "episodes")
os.makedirs(OUT, exist_ok=True)

import numpy as np
import torch
from PIL import Image, ImageDraw

import robomimic.utils.file_utils as FU
import robomimic.utils.torch_utils as TU

CKPT = os.path.join(ROOT, "runs/lift_ph_lowdim_bc_e50_s1/20260929181133/models/model_epoch_50_low_dim_v15_success_0.88.pth")
HORIZON, SIZE, CAM = 400, 320, "agentview"

policy, ckpt_dict = FU.policy_from_checkpoint(ckpt_path=CKPT, device=TU.get_torch_device(False), verbose=False)
env, _ = FU.env_from_checkpoint(ckpt_dict=ckpt_dict, render=False, render_offscreen=True, verbose=False)


def run(seed):
    np.random.seed(seed); torch.manual_seed(seed)
    policy.start_episode()
    obs = env.reset(); obs = env.reset_to(env.get_state())
    rec, frames = [], []
    for t in range(HORIZON):
        obs, _, done, _ = env.step(policy(ob=obs))
        cube = obs["object"][:3].tolist()
        eef = obs["robot0_eef_pos"].tolist()
        g = obs["robot0_gripper_qpos"].tolist()
        rec.append({"t": t + 1, "cube": cube, "eef": eef, "grip_open": round(g[0] - g[1], 4)})
        frames.append(env.render(mode="rgb_array", height=SIZE, width=SIZE, camera_name=CAM))
        if env.is_success()["task"]:
            return True, rec, frames
    return False, rec, frames


def facts(rec):
    """채점용 정답: 시뮬레이터 수치로 확인한 사실만."""
    z0 = rec[0]["cube"][2]
    dist = [float(np.linalg.norm(np.array(r["eef"]) - np.array(r["cube"]))) for r in rec]
    grip = [r["grip_open"] for r in rec]
    tmin = int(np.argmin(dist))
    closed = [i for i in range(1, len(grip)) if grip[i] < 0.5 * max(grip[: i + 1])]
    t_close = closed[0] if closed else None
    zmax = max(r["cube"][2] for r in rec)
    xy_shift = float(np.linalg.norm(np.array(rec[-1]["cube"][:2]) - np.array(rec[0]["cube"][:2])))
    return {
        "steps": len(rec),
        "cube_start_xyz": [round(v, 3) for v in rec[0]["cube"]],
        "min_hand_cube_dist_m": round(min(dist), 3), "t_min_dist": tmin + 1,
        "gripper_closed": t_close is not None, "t_gripper_close": (t_close + 1) if t_close is not None else None,
        "cube_max_lift_m": round(zmax - z0, 3),
        "cube_final_lift_m": round(rec[-1]["cube"][2] - z0, 3),
        "cube_pushed_xy_m": round(xy_shift, 3),
        "hand_cube_dist_at_close_m": round(dist[t_close], 3) if t_close is not None else None,
    }, tmin, t_close


def sheet(frames, rec, tmin, t_close, path):
    n = len(frames)
    picks = [0, max(0, tmin - 8), tmin]
    if t_close is not None:
        picks += [t_close, min(n - 1, t_close + 25)]
    else:
        picks += [min(n - 1, tmin + 25), n // 2]
    picks.append(n - 1)
    picks = sorted(set(picks))[:6]
    while len(picks) < 6:
        picks = sorted(set(picks + [int(n * len(picks) / 6)]))
    tiles = []
    for k, i in enumerate(picks):
        im = Image.fromarray(frames[i]).copy()
        d = ImageDraw.Draw(im)
        d.rectangle([0, 0, 118, 26], fill=(0, 0, 0))
        d.text((6, 7), f"{k + 1}. step {i + 1}", fill=(255, 255, 255))
        tiles.append(im)
    W = Image.new("RGB", (SIZE * 3, SIZE * 2))
    for k, im in enumerate(tiles):
        W.paste(im, ((k % 3) * SIZE, (k // 3) * SIZE))
    W.save(path, quality=90)
    return [p + 1 for p in picks]


found = {"fail": [], "success": []}
tried = []
for seed in range(0, 60):
    ok, rec, frames = run(seed)
    tried.append({"seed": seed, "success": ok, "steps": len(rec)})
    kind = "success" if ok else "fail"
    if (kind == "fail" and len(found["fail"]) < 2) or (kind == "success" and len(found["success"]) < 1):
        f, tmin, t_close = facts(rec)
        name = f"seed{seed:02d}_{kind}"
        steps_shown = sheet(frames, rec, tmin, t_close, os.path.join(OUT, name + ".jpg"))
        json.dump({"seed": seed, "success": ok, "facts": f, "frames_shown_steps": steps_shown},
                  open(os.path.join(OUT, name + ".json"), "w"), indent=2)
        found[kind].append(name)
        print(name, json.dumps(f), flush=True)
    if len(found["fail"]) >= 2 and len(found["success"]) >= 1:
        break
json.dump(tried, open(os.path.join(OUT, "seeds_tried.json"), "w"), indent=2)
print("tried", len(tried), "fails", sum(not x["success"] for x in tried), "->", found)
