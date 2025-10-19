import asyncio
from typing import Dict, Any, List
import logging
from datetime import datetime

from .normalizer import NormalizerService
from .scoring import ScoringService
from ..adapters.fram import FramAdapter

# from ..adapters.carrefour import CarrefourAdapter
# from ..adapters.leclerc import LeclercAdapter

logger = logging.getLogger(__name__)


class AggregatorService:
    """Service d'agrégation et orchestration des recherches multi-providers"""

    def __init__(self):
        self.normalizer = NormalizerService()
        self.scorer = ScoringService()

        # Liste des adapters disponibles
        self.adapters = [
            FramAdapter(),
            # CarrefourAdapter(),  # À implémenter
            # LeclercAdapter(),     # À implémenter
        ]

    async def search(self, query: Dict[str, Any]) -> List[Dict[str, Any]]:
        """
        Recherche agrégée sur tous les providers
        1. Parallélisation des recherches
        2. Normalisation
        3. Déduplication
        4. Scoring
        5. Tri
        """
        logger.info(
            f"Starting aggregated search for query: {query.get('destinations')}"
        )

        # 1. Lancer les recherches en parallèle
        raw_results = await self._fetch_all_providers(query)
        logger.info(
            f"Fetched {len(raw_results)} raw results from {len(self.adapters)} providers"
        )

        # 2. Normaliser tous les résultats
        normalized = self._normalize_results(raw_results)
        logger.info(f"Normalized to {len(normalized)} valid packages")

        # 3. Dédupliquer
        unique = self._deduplicate(normalized)
        logger.info(f"After deduplication: {len(unique)} unique packages")

        # 4. Scorer
        scored = self.scorer.score_batch(unique, query)
        logger.info(f"Scored {len(scored)} packages")

        return scored

    async def _fetch_all_providers(self, query: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Fetch en parallèle sur tous les providers"""

        async def fetch_provider(adapter):
            """Wrapper pour gérer les erreurs par provider"""
            try:
                async with adapter:
                    results = await adapter.search(query)
                    logger.info(f"{adapter.provider_name}: {len(results)} results")
                    return results
            except Exception as e:
                logger.error(
                    f"Error fetching from {adapter.provider_name}: {e}", exc_info=True
                )
                return []

        # Lancer tous les adapters en parallèle
        tasks = [fetch_provider(adapter) for adapter in self.adapters]
        results_per_provider = await asyncio.gather(*tasks, return_exceptions=True)

        # Flatten les résultats
        all_results = []
        for results in results_per_provider:
            if isinstance(results, list):
                all_results.extend(results)
            elif isinstance(results, Exception):
                logger.error(f"Provider raised exception: {results}")

        return all_results

    def _normalize_results(
        self, raw_results: List[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        """Normalise tous les résultats bruts"""
        normalized = []

        for raw in raw_results:
            try:
                provider = raw.get("provider", "unknown")
                normalized_pkg = self.normalizer.normalize_package(raw, provider)

                if normalized_pkg:
                    normalized.append(normalized_pkg)
            except Exception as e:
                logger.error(f"Error normalizing package: {e}", exc_info=True)
                continue

        return normalized

    def _deduplicate(self, packages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        Déduplique les packages similaires
        Clé: hotel name + dates + origin + duration
        Garde le moins cher en cas de doublon
        """
        unique = {}

        for pkg in packages:
            key = self._dedup_key(pkg)

            if key not in unique:
                unique[key] = pkg
            else:
                # Garder le moins cher
                existing_price = (
                    unique[key].get("price", {}).get("total_eur", float("inf"))
                )
                new_price = pkg.get("price", {}).get("total_eur", float("inf"))

                if new_price < existing_price:
                    logger.debug(
                        f"Replacing duplicate: {existing_price}€ → {new_price}€"
                    )
                    unique[key] = pkg

        return list(unique.values())

    def _dedup_key(self, package: Dict[str, Any]) -> str:
        """Génère une clé de déduplication"""
        hotel_name = self._normalize_hotel_name(
            package.get("hotel", {}).get("name", "")
        )

        travel = package.get("travel", {})
        departure_date = travel.get("departure", {}).get("datetime", "")[:10]
        return_date = travel.get("return", {}).get("datetime", "")[:10]
        origin = travel.get("departure", {}).get("airport", "")

        duration = package.get("duration_nights", 0)
        board = package.get("board", "")

        key = f"{hotel_name}|{origin}|{departure_date}|{return_date}|{duration}|{board}"
        return key.lower()

    def _normalize_hotel_name(self, name: str) -> str:
        """Normalise le nom d'hôtel pour comparaison"""
        import re
        from unicodedata import normalize

        # Enlever accents
        name = normalize("NFKD", name).encode("ASCII", "ignore").decode("ASCII")

        # Minuscules et enlever caractères spéciaux
        name = re.sub(r"[^\w\s]", "", name.lower())

        # Enlever mots communs
        common_words = ["hotel", "club", "resort", "spa", "beach", "plage"]
        words = name.split()
        words = [w for w in words if w not in common_words]

        return " ".join(words).strip()

    def get_stats(self, packages: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Génère des statistiques sur les résultats"""
        if not packages:
            return {
                "total": 0,
                "by_provider": {},
                "price_range": {},
                "avg_score": 0,
            }

        prices = [
            p.get("price", {}).get("per_person_eur", 0)
            for p in packages
            if p.get("price")
        ]
        scores = [p.get("score", 0) for p in packages]

        by_provider = {}
        for pkg in packages:
            provider = pkg.get("provider", "unknown")
            by_provider[provider] = by_provider.get(provider, 0) + 1

        return {
            "total": len(packages),
            "by_provider": by_provider,
            "price_range": {
                "min": min(prices) if prices else 0,
                "max": max(prices) if prices else 0,
                "avg": sum(prices) / len(prices) if prices else 0,
            },
            "avg_score": sum(scores) / len(scores) if scores else 0,
        }
