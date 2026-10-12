#!/usr/bin/env python3
"""Generate one brand image through OpenRouter. Usage: gen.py prompt.txt out.png [aspect] [size] [ref.png ...]"""
import base64, json, os, sys, urllib.request, urllib.error
prompt, out = open(sys.argv[1]).read(), sys.argv[2]
aspect = sys.argv[3] if len(sys.argv) > 3 else "16:9"
size = sys.argv[4] if len(sys.argv) > 4 else "2K"
content = [{"type": "text", "text": prompt}]
for ref in sys.argv[5:]:
    content.append({"type": "image_url", "image_url": {"url": "data:image/png;base64," + base64.b64encode(open(ref, "rb").read()).decode()}})
body = {"model": os.environ.get("MODEL", "google/gemini-3-pro-image"), "modalities": ["image", "text"],
        "messages": [{"role": "user", "content": content}], "image_config": {"aspect_ratio": aspect, "image_size": size}}
req = urllib.request.Request("https://openrouter.ai/api/v1/chat/completions", data=json.dumps(body).encode(),
                             headers={"Content-Type": "application/json", "Authorization": "Bearer " + os.environ["OPENROUTER_API_KEY"]})
try:
    r = json.load(urllib.request.urlopen(req, timeout=400))
except urllib.error.HTTPError as e:
    sys.exit(f"HTTP {e.code}: {e.read().decode()[:800]}")
imgs = r["choices"][0]["message"].get("images") or []
if not imgs: sys.exit("no image: " + json.dumps(r)[:600])
url = imgs[0]["image_url"]["url"]
open(out, "wb").write(base64.b64decode(url.split(",", 1)[1]))
print("saved", out, os.path.getsize(out), r.get("usage", {}).get("cost"))
