# backend/travel_agent/adapters/base.py
from abc import ABC, abstractmethod
from typing import List, Dict, Any
import asyncio
import httpx
from datetime import datetime
import logging

logger = logging.getLogger(__name__)


class ProviderAdapter(ABC):
    """Interface pour tous les adapters de fournisseurs"""

    provider_name: str = "base"
    base_url: str = ""
    timeout: int = 30
    max_retries: int = 3

    def __init__(self):
        self.session = None

    async def __aenter__(self):
        self.session = httpx.AsyncClient(
            timeout=self.timeout,
            headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
            },
        )
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if self.session:
            await self.session.aclose()

    @abstractmethod
    async def search(self, query: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Recherche les packages selon la query"""
        pass

    @abstractmethod
    def parse_package(self, raw_data: Any) -> Dict[str, Any]:
        """Parse un package brut en format normalisé"""
        pass

    async def fetch_with_retry(self, url: str, **kwargs) -> httpx.Response:
        """Fetch avec retry automatique"""
        for attempt in range(self.max_retries):
            try:
                response = await self.session.get(url, **kwargs)
                response.raise_for_status()
                return response
            except httpx.HTTPError as e:
                logger.warning(f"Attempt {attempt + 1} failed for {url}: {e}")
                if attempt == self.max_retries - 1:
                    raise
                await asyncio.sleep(2**attempt)  # Exponential backoff

    def normalize_price(self, price_str: str) -> float:
        """Normalise un prix string en float"""
        import re

        # Enlève tout sauf chiffres et points/virgules
        clean = re.sub(r"[^\d,.]", "", price_str)
        # Remplace virgule par point
        clean = clean.replace(",", ".")
        try:
            return float(clean)
        except:
            return 0.0

    def parse_date(self, date_str: str) -> str:
        """Parse une date en ISO format"""
        from dateutil import parser

        try:
            dt = parser.parse(date_str)
            return dt.isoformat()
        except:
            return datetime.now().isoformat()
