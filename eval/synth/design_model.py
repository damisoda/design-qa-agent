"""시안을 먼저 쓰는 도구(10-12, 블라인드 6묶음용): Figma 오토 레이아웃처럼 프레임·글자·그림을 쌓아 design.json을 만든다.
구현(HTML·CSS)을 재서 만들지 않는다. 글자 폭만 Figma처럼 실제 글꼴로 잰다(헤드리스 크롬의 canvas measureText).
좌표는 프레임 왼쪽 위 기준, 크기 방식은 FILL·HUG·FIXED, 오토 레이아웃은 방향·간격·안쪽 여백·정렬.
"""
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FONT = "Apple SD Gothic Neo"


def T(content, size=14, weight=400, lh=None, color="#111111", token=None, w="HUG", lines=1, name=None, align="LEFT"):
    return {"kind": "text", "content": content, "size": size, "weight": weight, "lh": lh or round(size * 1.4), "color": color, "token": token, "w": w, "lines": lines, "name": name or content[:12], "align": align}


def F(name, children=(), dir="V", gap=0, pad=(0, 0, 0, 0), align="MIN", justify="MIN", w="FILL", h="HUG", fill=None, ftoken=None, stroke=None, stoken=None, radius=0, opacity=None, reactions=None):
    return {"kind": "frame", "name": name, "children": list(children), "dir": dir, "gap": gap, "pad": pad, "align": align, "justify": justify, "w": w, "h": h, "fill": fill, "ftoken": ftoken, "stroke": stroke, "stoken": stoken, "radius": radius, "opacity": opacity, "reactions": reactions}


def I(name, w="FILL", h=100, radius=0, fit="FILL"):
    return {"kind": "image", "name": name, "w": w, "h": h, "radius": radius, "fit": fit}


def V(name, w=24, h=24):
    return {"kind": "vector", "name": name, "w": w, "h": h}


def measure(texts):
    """글자 폭: [(내용, 크기, 굵기)] → [폭]. 헤드리스 크롬의 canvas로 실제 글꼴 폭을 잰다"""
    script = """
const { launch } = require(process.argv[1] + '/dqa/measure/browser');
(async () => { const items = JSON.parse(require('fs').readFileSync(0, 'utf8')); const b = await launch(); const p = await (await b.newContext()).newPage();
  const out = await p.evaluate((items) => { const c = document.createElement('canvas').getContext('2d'); return items.map(([t, s, w, f]) => { c.font = `${w} ${s}px "${f}"`; return Math.ceil(c.measureText(t).width) }) }, items);
  console.log(JSON.stringify(out)); await b.close() })()
"""
    r = subprocess.run(["node", "-e", script, str(ROOT)], input=json.dumps([[t, s, w, FONT] for t, s, w in texts]), capture_output=True, text=True, check=True)
    return json.loads(r.stdout.strip().splitlines()[-1])


def _collect(n, acc):
    if n["kind"] == "text" and n["w"] == "HUG":
        acc.append((n["content"], n["size"], n["weight"]))
    for c in n.get("children", []):
        _collect(c, acc)


def _hug(n, widths):
    """HUG 크기(폭, 높이) 계산(자식부터)"""
    k = n["kind"]
    if k == "text":
        w = widths[(n["content"], n["size"], n["weight"])] if n["w"] == "HUG" else (n["w"] if isinstance(n["w"], (int, float)) else 0)
        return w, n["lh"] * n["lines"]
    if k in ("image", "vector"):
        return (n["w"] if isinstance(n["w"], (int, float)) else 0), n["h"]
    t, r, b, l = n["pad"]
    kids = [_hug(c, widths) for c in n["children"]]
    if n["dir"] == "H":
        w = sum(x for x, _ in kids) + n["gap"] * max(0, len(kids) - 1) + l + r
        h = max([y for _, y in kids] or [0]) + t + b
    else:
        w = max([x for x, _ in kids] or [0]) + l + r
        h = sum(y for _, y in kids) + n["gap"] * max(0, len(kids) - 1) + t + b
    # 고정 크기면 그 값
    if isinstance(n.get("w"), (int, float)): w = n["w"]
    if isinstance(n.get("h"), (int, float)): h = n["h"]
    return w, h


def _place(n, x, y, w, h, widths, out, idc):
    """노드 하나를 (x, y, w, h)에 두고 자식을 오토 레이아웃으로 배치해 design.json 노드로"""
    idc[0] += 1
    nid = f"6:{idc[0]}"
    k = n["kind"]
    d = {"id": nid, "name": n["name"], "type": {"text": "TEXT", "image": "IMAGE", "vector": "VECTOR", "frame": "FRAME"}[k], "x": round(x), "y": round(y), "w": round(w), "h": round(h)}
    sz = lambda v: "FILL" if v == "FILL" else "HUG" if v == "HUG" else "FIXED"
    d["sizing"] = {"h": sz(n.get("w")), "v": sz(n.get("h", "FIXED"))}
    if k == "text":
        d["text"] = {"content": n["content"], "fontFamily": FONT, "fontSize": n["size"], "fontWeight": n["weight"], "lineHeight": n["lh"], "letterSpacing": 0,
                     "color": {"hex": n["color"], "opacity": 1, "token": n["token"]}, "align": n["align"], "wrap": "NONE" if n["lines"] == 1 and n["w"] == "HUG" else "WRAP"}
        d["sizing"]["v"] = "HUG"
    if k == "image":
        d["image"] = {"fit": n["fit"]}
        if n["radius"]: d["radius"] = n["radius"]
    if k == "frame":
        if n["fill"]: d["fill"] = {"hex": n["fill"], "opacity": n["opacity"] if n["opacity"] is not None else 1, "token": n["ftoken"]}
        if n["stroke"]: d["stroke"] = {"width": 1, "hex": n["stroke"], "opacity": 1, "token": n["stoken"]}
        if n["radius"]: d["radius"] = n["radius"]
        if n["reactions"]: d["reactions"] = n["reactions"]
        d["layout"] = {"mode": "HORIZONTAL" if n["dir"] == "H" else "VERTICAL", "gap": n["gap"], "padding": list(n["pad"]), "align": n["align"], "justify": n["justify"], "wrap": False}
        t, r, b, l = n["pad"]
        iw, ih = w - l - r, h - t - b
        kids = n["children"]
        hug = [_hug(c, widths) for c in kids]
        main_fixed = lambda c, hw: (c.get("w") if n["dir"] == "H" else c.get("h"))
        if n["dir"] == "H":
            fills = [c for c in kids if c.get("w") == "FILL"]
            used = sum(hw for c, (hw, _) in zip(kids, hug) if c.get("w") != "FILL") + n["gap"] * max(0, len(kids) - 1)
            fw = (iw - used) / len(fills) if fills else 0
            sizes = [((fw if c.get("w") == "FILL" else hw), (ih if c.get("h") == "FILL" else hh)) for c, (hw, hh) in zip(kids, hug)]
            total = sum(s[0] for s in sizes) + n["gap"] * max(0, len(kids) - 1)
            gap = n["gap"]
            if n["justify"] == "SPACE_BETWEEN" and len(kids) > 1: gap = (iw - sum(s[0] for s in sizes)) / (len(kids) - 1); cx = x + l
            else: cx = x + l + (0 if n["justify"] == "MIN" else (iw - total) / 2 if n["justify"] == "CENTER" else iw - total)
            children = []
            for c, (cw, ch) in zip(kids, sizes):
                cy = y + t + (0 if n["align"] == "MIN" else (ih - ch) / 2 if n["align"] == "CENTER" else ih - ch)
                children.append(_place(c, cx, cy, cw, ch, widths, out, idc)); cx += cw + gap
        else:
            fills = [c for c in kids if c.get("h") == "FILL"]
            used = sum(hh for c, (_, hh) in zip(kids, hug) if c.get("h") != "FILL") + n["gap"] * max(0, len(kids) - 1)
            fh = (ih - used) / len(fills) if fills else 0
            sizes = [((iw if c.get("w") == "FILL" else hw), (fh if c.get("h") == "FILL" else hh)) for c, (hw, hh) in zip(kids, hug)]
            total = sum(s[1] for s in sizes) + n["gap"] * max(0, len(kids) - 1)
            gap = n["gap"]
            if n["justify"] == "SPACE_BETWEEN" and len(kids) > 1: gap = (ih - sum(s[1] for s in sizes)) / (len(kids) - 1); cy = y + t
            else: cy = y + t + (0 if n["justify"] == "MIN" else (ih - total) / 2 if n["justify"] == "CENTER" else ih - total)
            children = []
            for c, (cw, ch) in zip(kids, sizes):
                cx = x + l + (0 if n["align"] == "MIN" else (iw - cw) / 2 if n["align"] == "CENTER" else iw - cw)
                children.append(_place(c, cx, cy, cw, ch, widths, out, idc)); cy += ch + gap
        if children: d["children"] = children
    return d


def build(frame_name, root, W=375, H=812, fill="#FFFFFF", tokens=None, status_bar=44, bottom=None):
    """root: 세로 프레임(화면 본문). status_bar 높이만큼 위에 상태 표시줄 노드를 둔다. bottom: 화면 아래에 붙는 프레임(하단 바)"""
    acc = []; _collect(root, acc)
    if bottom: _collect(bottom, acc)
    uniq = list(dict.fromkeys(acc))
    widths = dict(zip(uniq, measure(uniq))) if uniq else {}
    idc = [1]; out = []
    nodes = [{"id": "6:1", "name": "Status Bar", "type": "FRAME", "x": 0, "y": 0, "w": W, "h": status_bar}]
    _, rh = _hug(root, widths)
    nodes.append(_place(root, 0, status_bar, W, rh if root.get("h") == "HUG" else root["h"], widths, out, idc))
    if bottom:
        _, bh = _hug(bottom, widths)
        bh = bottom["h"] if isinstance(bottom.get("h"), (int, float)) else bh
        nodes.append(_place(bottom, 0, H - bh, W, bh, widths, out, idc))
    return {"source": "design-first spec (eval/synth/design_model.py, 2026-10-12). 시안을 먼저 쓰고 구현은 따로 만들었다.", "file": "블라인드 6", "frame": {"id": "6:0", "name": frame_name, "width": W, "height": H, "fill": {"hex": fill, "opacity": 1, "token": "color/bg"}}, "base": f"{W}x{H}", "tokens": tokens or {}, "nodes": nodes}
