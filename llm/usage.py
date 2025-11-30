"""
Tracks HuggingFace API usage (persisted to file).

HuggingFace limits:
- Token credits: Free ~100k/month, Pro ~2M/month (resets monthly)
- Request limit: Free 1k/day, Pro 20k/day (resets daily)
"""

import json
import logging
from datetime import datetime
from pathlib import Path

logger = logging.getLogger(__name__)

# Limits
FREE_TOKENS = 100_000
PRO_TOKENS = 2_000_000
FREE_DAILY_REQUESTS = 1_000
PRO_DAILY_REQUESTS = 20_000


class UsageTracker:
    """Tracks and persists API usage stats."""
    
    def __init__(self, storage_path: Path | None = None):
        self.storage_path = storage_path or Path(__file__).parent / ".usage_stats.json"
        self._stats = self._load()
    
    def _default_stats(self) -> dict:
        return {
            "month": datetime.now().strftime("%Y-%m"),
            "monthly_requests": 0,
            "estimated_input_tokens": 0,
            "estimated_output_tokens": 0,
            "date": datetime.now().strftime("%Y-%m-%d"),
            "daily_requests": 0,
            "first_request": None,
            "last_request": None,
        }
    
    def _load(self) -> dict:
        """Load stats from file, resetting if month/day changed."""
        current_month = datetime.now().strftime("%Y-%m")
        current_date = datetime.now().strftime("%Y-%m-%d")
        
        if not self.storage_path.exists():
            return self._default_stats()
        
        try:
            stats = json.loads(self.storage_path.read_text())
            
            # Reset monthly stats if new month
            if stats.get("month") != current_month:
                logger.info(f"📅 New month, resetting token stats")
                stats = self._default_stats()
            # Reset daily stats if new day
            elif stats.get("date") != current_date:
                logger.info(f"📅 New day, resetting daily request count")
                stats["date"] = current_date
                stats["daily_requests"] = 0
            
            return stats
        except Exception as e:
            logger.warning(f"Failed to load usage stats: {e}")
            return self._default_stats()
    
    def _save(self):
        """Persist stats to file."""
        try:
            self.storage_path.write_text(json.dumps(self._stats, indent=2))
        except Exception as e:
            logger.warning(f"Failed to save usage stats: {e}")
    
    def record(self, input_tokens: int, output_tokens: int):
        """Record a request with estimated token counts."""
        now = datetime.now()
        current_date = now.strftime("%Y-%m-%d")
        
        # Check if day rolled over
        if self._stats.get("date") != current_date:
            self._stats["date"] = current_date
            self._stats["daily_requests"] = 0
        
        self._stats["monthly_requests"] += 1
        self._stats["daily_requests"] += 1
        self._stats["estimated_input_tokens"] += input_tokens
        self._stats["estimated_output_tokens"] += output_tokens
        self._stats["last_request"] = now.isoformat()
        if not self._stats.get("first_request"):
            self._stats["first_request"] = now.isoformat()
        
        self._save()
    
    def reset(self):
        """Manually reset all stats."""
        self._stats = self._default_stats()
        self._save()
    
    def get_summary(self) -> dict:
        """Get usage summary with remaining limits."""
        total_tokens = self._stats["estimated_input_tokens"] + self._stats["estimated_output_tokens"]
        daily_requests = self._stats.get("daily_requests", 0)
        
        return {
            **self._stats,
            "estimated_total_tokens": total_tokens,
            "limits": {
                "free": {
                    "tokens_remaining": max(0, FREE_TOKENS - total_tokens),
                    "tokens_used_pct": round(total_tokens / FREE_TOKENS * 100, 1),
                    "daily_requests_remaining": max(0, FREE_DAILY_REQUESTS - daily_requests),
                    "daily_requests_used_pct": round(daily_requests / FREE_DAILY_REQUESTS * 100, 1),
                },
                "pro": {
                    "tokens_remaining": max(0, PRO_TOKENS - total_tokens),
                    "tokens_used_pct": round(total_tokens / PRO_TOKENS * 100, 2),
                    "daily_requests_remaining": max(0, PRO_DAILY_REQUESTS - daily_requests),
                    "daily_requests_used_pct": round(daily_requests / PRO_DAILY_REQUESTS * 100, 2),
                },
            },
            "note": "Local tracking only. Token credits reset monthly, request limits reset daily.",
        }
    
    @property
    def daily_requests(self) -> int:
        return self._stats.get("daily_requests", 0)
    
    @property
    def monthly_requests(self) -> int:
        return self._stats.get("monthly_requests", 0)


# Singleton instance
tracker = UsageTracker()

