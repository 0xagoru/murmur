import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from murmur.trading import execute, performance
from murmur.chain import refresh

for action in ["buy", "sell"]:
    print(action, execute("moss", action, validation=True))
refresh()
print("performance", performance("moss"))
