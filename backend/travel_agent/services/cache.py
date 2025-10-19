import json
import hashlib
from typing import Any, Optional, Dict
import logging
from django.core.cache import cache
from django.conf import settings

logger = logging.getLogger(__name__)


class CacheService:
    """Service de gestion du cache Redis pour les résultats de recherche"""

    # Durées de vie du cache (en secondes)
    TTL = {
        "search_results": 300,  # 5 minutes
        "package_details": 600,  # 10 minutes
        "provider_results": 180,  # 3 minutes
        "explanations": 3600,  # 1 heure
        "hotel_info": 86400,  # 24 heures
    }

    def __init__(self):
        self.enabled = (
            getattr(settings, "CACHES", {}).get("default", {}).get("BACKEND")
            is not None
        )

    def get_search_results(self, query: Dict[str, Any]) -> Optional[list]:
        """Récupère les résultats de recherche depuis le cache"""
        if not self.enabled:
            return None

        cache_key = self._generate_search_key(query)

        try:
            cached = cache.get(cache_key)
            if cached:
                logger.info(f"Cache HIT for search: {cache_key[:30]}...")
                return json.loads(cached)
            else:
                logger.debug(f"Cache MISS for search: {cache_key[:30]}...")
                return None
        except Exception as e:
            logger.error(f"Error reading from cache: {e}")
            return None

    def set_search_results(self, query: Dict[str, Any], results: list) -> bool:
        """Stocke les résultats de recherche dans le cache"""
        if not self.enabled:
            return False

        cache_key = self._generate_search_key(query)
        ttl = self.TTL["search_results"]

        try:
            cache.set(cache_key, json.dumps(results), ttl)
            logger.info(f"Cache SET for search: {cache_key[:30]}... (TTL: {ttl}s)")
            return True
        except Exception as e:
            logger.error(f"Error writing to cache: {e}")
            return False

    def get_package(self, offer_id: str, provider: str) -> Optional[Dict]:
        """Récupère un package spécifique depuis le cache"""
        if not self.enabled:
            return None

        cache_key = f"package:{provider}:{offer_id}"

        try:
            cached = cache.get(cache_key)
            if cached:
                logger.debug(f"Cache HIT for package: {offer_id}")
                return json.loads(cached)
            return None
        except Exception as e:
            logger.error(f"Error reading package from cache: {e}")
            return None

    def set_package(self, offer_id: str, provider: str, package: Dict) -> bool:
        """Stocke un package dans le cache"""
        if not self.enabled:
            return False

        cache_key = f"package:{provider}:{offer_id}"
        ttl = self.TTL["package_details"]

        try:
            cache.set(cache_key, json.dumps(package), ttl)
            logger.debug(f"Cache SET for package: {offer_id}")
            return True
        except Exception as e:
            logger.error(f"Error writing package to cache: {e}")
            return False

    def get_provider_results(self, provider: str, query: Dict) -> Optional[list]:
        """Récupère les résultats d'un provider spécifique"""
        if not self.enabled:
            return None

        query_hash = self._hash_query(query)
        cache_key = f"provider:{provider}:{query_hash}"

        try:
            cached = cache.get(cache_key)
            if cached:
                logger.debug(f"Cache HIT for provider {provider}")
                return json.loads(cached)
            return None
        except Exception as e:
            logger.error(f"Error reading provider results from cache: {e}")
            return None

    def set_provider_results(self, provider: str, query: Dict, results: list) -> bool:
        """Stocke les résultats d'un provider"""
        if not self.enabled:
            return False

        query_hash = self._hash_query(query)
        cache_key = f"provider:{provider}:{query_hash}"
        ttl = self.TTL["provider_results"]

        try:
            cache.set(cache_key, json.dumps(results), ttl)
            logger.debug(f"Cache SET for provider {provider}")
            return True
        except Exception as e:
            logger.error(f"Error writing provider results to cache: {e}")
            return False

    def get_explanation(self, package_id: str) -> Optional[Dict]:
        """Récupère l'explication (pros/cons) depuis le cache"""
        if not self.enabled:
            return None

        cache_key = f"explanation:{package_id}"

        try:
            cached = cache.get(cache_key)
            if cached:
                return json.loads(cached)
            return None
        except Exception as e:
            logger.error(f"Error reading explanation from cache: {e}")
            return None

    def set_explanation(self, package_id: str, explanation: Dict) -> bool:
        """Stocke l'explication dans le cache"""
        if not self.enabled:
            return False

        cache_key = f"explanation:{package_id}"
        ttl = self.TTL["explanations"]

        try:
            cache.set(cache_key, json.dumps(explanation), ttl)
            return True
        except Exception as e:
            logger.error(f"Error writing explanation to cache: {e}")
            return False

    def invalidate_search(self, query: Dict) -> bool:
        """Invalide le cache d'une recherche spécifique"""
        if not self.enabled:
            return False

        cache_key = self._generate_search_key(query)

        try:
            cache.delete(cache_key)
            logger.info(f"Cache INVALIDATED for search: {cache_key[:30]}...")
            return True
        except Exception as e:
            logger.error(f"Error invalidating cache: {e}")
            return False

    def invalidate_package(self, offer_id: str, provider: str) -> bool:
        """Invalide le cache d'un package"""
        if not self.enabled:
            return False

        cache_key = f"package:{provider}:{offer_id}"

        try:
            cache.delete(cache_key)
            logger.info(f"Cache INVALIDATED for package: {offer_id}")
            return True
        except Exception as e:
            logger.error(f"Error invalidating package cache: {e}")
            return False

    def clear_all(self, pattern: str = "*") -> bool:
        """Efface tout le cache (ou selon pattern)"""
        try:
            cache.clear()
            logger.warning("Cache CLEARED completely")
            return True
        except Exception as e:
            logger.error(f"Error clearing cache: {e}")
            return False

    def _generate_search_key(self, query: Dict[str, Any]) -> str:
        """Génère une clé de cache unique pour une recherche"""
        # Normaliser la query pour la clé
        normalized = self._normalize_query_for_cache(query)
        query_hash = self._hash_query(normalized)
        return f"search:{query_hash}"

    def _normalize_query_for_cache(self, query: Dict) -> Dict:
        """Normalise la query pour générer une clé stable"""
        # Garder seulement les champs importants pour la recherche
        normalized = {
            "origin": query.get("origin", "").upper(),
            "destinations": sorted([d.lower() for d in query.get("destinations", [])]),
            "date_range": query.get("date_range", {}),
            "duration_nights": sorted(query.get("duration_nights", [])),
            "budget_max": query.get("budget_eur", {}).get("max"),
            "party": {
                "adults": query.get("party", {}).get("adults", 2),
                "children_count": len(query.get("party", {}).get("children", [])),
            },
            "board": query.get("board", "all_inclusive"),
            "preferences": query.get("preferences", {}),
        }
        return normalized

    def _hash_query(self, query: Dict) -> str:
        """Génère un hash MD5 d'une query"""
        # Convertir en string JSON stable (clés triées)
        query_str = json.dumps(query, sort_keys=True)
        return hashlib.md5(query_str.encode()).hexdigest()

    def get_cache_stats(self) -> Dict[str, Any]:
        """Retourne des statistiques sur le cache"""
        try:
            # Note: stats dépendent du backend Redis
            return {
                "enabled": self.enabled,
                "backend": getattr(settings, "CACHES", {})
                .get("default", {})
                .get("BACKEND"),
                "ttl_config": self.TTL,
            }
        except Exception as e:
            logger.error(f"Error getting cache stats: {e}")
            return {"enabled": False, "error": str(e)}
