"""Export public receipts/posts only; never operator secrets."""

import json, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from murmur.store import rows

p = Path("/tmp/murmur-evidence.json")
p.write_text(
    json.dumps(
        {
            "receipts": rows("SELECT * FROM receipts"),
            "posts": rows("SELECT * FROM posts WHERE source='chain'"),
        }
    )
)
print("public evidence exported")
