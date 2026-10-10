import os
from pathlib import Path
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[2]
load_dotenv(ROOT / ".env.local")
DATA = Path(os.getenv("MURMUR_DATA") or str(ROOT / ".secrets"))
DATA.mkdir(mode=0o700, parents=True, exist_ok=True)
DB = DATA / "murmur.db"
RPC = os.getenv("BNB_RPC", "https://bsc-dataseed.bnbchain.org")
PRIVY_ID = os.getenv("PRIVY_APP_ID", "")
PRIVY_SECRET = os.getenv("PRIVY_APP_SECRET", "")
MODEL = os.getenv("MURMUR_MODEL", "anthropic/claude-haiku-5.5")
DAILY_INFERENCE = float(os.getenv("DAILY_INFERENCE_USD", "3"))
AGENT_DAILY_CALLS = int(os.getenv("AGENT_DAILY_CALLS", "64"))
