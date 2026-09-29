"""채점용 정답 보강: 같은 시드를 다시 돌려 스텝별 집게 명령(action[-1]>0 = 닫기), 집게 벌어짐, 큐브 높이, 손-큐브 거리를 기록하고 사건을 요약한다."""
import json, os, sys
ROOT = os.path.expanduser("~/robot-kernel"); sys.path.insert(0, os.path.join(ROOT, "shims"))
import numpy as np, torch
import robomimic.utils.file_utils as FU, robomimic.utils.torch_utils as TU
CKPT = os.path.join(ROOT, "runs/lift_ph_lowdim_bc_e50_s1/20260929181133/models/model_epoch_50_low_dim_v15_success_0.88.pth")
policy, cd = FU.policy_from_checkpoint(ckpt_path=CKPT, device=TU.get_torch_device(False), verbose=False)
env, _ = FU.env_from_checkpoint(ckpt_dict=cd, render=False, render_offscreen=False, verbose=False)
OUT = os.path.join(ROOT, "experiments/vlm_probe/episodes")
for seed in [0, 18, 1]:
    np.random.seed(seed); torch.manual_seed(seed); policy.start_episode()
    obs = env.reset(); obs = env.reset_to(env.get_state()); z0 = None; rows = []
    for t in range(400):
        a = policy(ob=obs); obs, _, _, _ = env.step(a)
        cube, eef, g = obs["object"][:3], obs["robot0_eef_pos"], obs["robot0_gripper_qpos"]
        z0 = cube[2] if z0 is None else z0
        rows.append({"t": t + 1, "close_cmd": bool(a[-1] > 0), "open_w": round(float(g[0] - g[1]), 4),
                     "lift_cm": round(float(cube[2] - z0) * 100, 2), "dist_cm": round(float(np.linalg.norm(eef - cube)) * 100, 1)})
        if env.is_success()["task"]: break
    # 사건 요약: 닫기 명령 구간, 최대 들림 시점
    segs, cur = [], None
    for r in rows:
        if r["close_cmd"] and cur is None: cur = [r["t"], r["t"]]
        elif r["close_cmd"]: cur[1] = r["t"]
        elif cur is not None: segs.append(cur); cur = None
    if cur: segs.append(cur)
    tz = max(rows, key=lambda r: r["lift_cm"])
    summ = {"seed": seed, "success": bool(env.is_success()["task"]), "steps": len(rows),
            "close_segments": [{"from": s[0], "to": s[1], "dist_cm_at_start": rows[s[0]-1]["dist_cm"]} for s in segs[:8]],
            "n_close_segments": len(segs), "max_lift_cm": tz["lift_cm"], "t_max_lift": tz["t"],
            "final_lift_cm": rows[-1]["lift_cm"], "min_open_w_while_closed": min([r["open_w"] for r in rows if r["close_cmd"]] or [None])}
    json.dump({"summary": summ, "trace": rows}, open(os.path.join(OUT, f"gt_seed{seed:02d}.json"), "w"), indent=1)
    print(json.dumps(summ, ensure_ascii=False))
