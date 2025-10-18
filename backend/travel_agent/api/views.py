# backend/travel_agent/api/views.py
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from rest_framework.throttling import AnonRateThrottle, UserRateThrottle
from rest_framework.permissions import AllowAny
import asyncio
import logging
from datetime import datetime

from .serializers import TravelQuerySerializer, SearchResponseSerializer
from ..services.aggregator import AggregatorService
from ..services.explain import ExplainService
from ..models.query import TravelQuery

logger = logging.getLogger(__name__)


class SearchPackagesView(APIView):
    """Endpoint principal de recherche de packages"""

    permission_classes = [AllowAny]
    throttle_classes = [AnonRateThrottle, UserRateThrottle]

    def post(self, request):
        """Recherche de packages de voyage"""
        # Valider la requête
        serializer = TravelQuerySerializer(data=request.data)
        if not serializer.is_valid():
            return Response(
                {"error": "Invalid query", "details": serializer.errors},
                status=status.HTTP_400_BAD_REQUEST,
            )

        query = serializer.validated_data

        # Récupérer les paramètres de pagination
        page = int(request.query_params.get("page", 1))
        page_size = int(request.query_params.get("page_size", 20))

        # Sauvegarder la requête en base
        session_id = request.session.session_key or "anonymous"
        travel_query = self._save_query(query, session_id)

        try:
            # Lancer la recherche agrégée
            aggregator = AggregatorService()
            results = asyncio.run(aggregator.search(query))

            # Générer les explications (pros/cons)
            explain_service = ExplainService()
            for package in results:
                pros, cons = explain_service.generate_pros_cons(package, query)
                package["pros"] = pros
                package["cons"] = cons

            # Paginer les résultats
            start_idx = (page - 1) * page_size
            end_idx = start_idx + page_size
            paginated = results[start_idx:end_idx]

            # Mettre à jour le nombre de résultats
            travel_query.results_count = len(results)
            travel_query.search_completed = True
            travel_query.save()

            # Préparer la réponse
            response_data = {
                "query": query,
                "packages": paginated,
                "paging": {
                    "page": page,
                    "page_size": page_size,
                    "total_results": len(results),
                    "total_pages": (len(results) + page_size - 1) // page_size,
                    "has_more": end_idx < len(results),
                },
                "metadata": {
                    "search_id": str(travel_query.id),
                    "timestamp": datetime.now().isoformat(),
                    "providers_queried": ["fram", "carrefour", "leclerc"],
                },
            }

            # Valider et retourner la réponse
            response_serializer = SearchResponseSerializer(data=response_data)
            if response_serializer.is_valid():
                return Response(
                    response_serializer.validated_data, status=status.HTTP_200_OK
                )
            else:
                # En cas d'erreur de sérialisation, retourner quand même les données
                return Response(response_data, status=status.HTTP_200_OK)

        except Exception as e:
            logger.error(f"Error in search: {e}", exc_info=True)
            return Response(
                {"error": "Search failed", "message": str(e)},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

    def _save_query(self, query: Dict, session_id: str) -> TravelQuery:
        """Sauvegarde la requête en base de données"""
        try:
            travel_query = TravelQuery.objects.create(
                session_id=session_id,
                origin=query.get("origin"),
                destinations=query.get("destinations", []),
                date_start=query.get("date_range", {}).get("start"),
                date_end=query.get("date_range", {}).get("end"),
                date_flexibility=query.get("flex", {}).get("days", 0),
                min_nights=min(query.get("duration_nights", [7])),
                max_nights=max(query.get("duration_nights", [7])),
                budget_min=query.get("budget_eur", {}).get("min"),
                budget_max=query.get("budget_eur", {}).get("max"),
                adults=query.get("party", {}).get("adults", 2),
                children_ages=query.get("party", {}).get("children", []),
                board=query.get("board", "all_inclusive"),
                family_friendly=query.get("preferences", {}).get(
                    "family_friendly", False
                ),
                adults_only=query.get("preferences", {}).get("adults_only", False),
                direct_flight_only=query.get("preferences", {}).get(
                    "direct_flight", False
                ),
            )
            return travel_query
        except Exception as e:
            logger.error(f"Error saving query: {e}")
            # Créer un objet minimal si erreur
            return TravelQuery()


class PackageDetailView(APIView):
    """Endpoint pour obtenir les détails d'un package"""

    permission_classes = [AllowAny]

    def get(self, request, offer_id):
        """Récupère les détails d'un package spécifique"""
        try:
            # Chercher le package en cache ou en base
            from ..models.package import Package

            package = Package.objects.filter(offer_id=offer_id).first()

            if not package:
                return Response(
                    {"error": "Package not found"}, status=status.HTTP_404_NOT_FOUND
                )

            # Retourner les détails
            return Response(package.to_api_response(), status=status.HTTP_200_OK)

        except Exception as e:
            logger.error(f"Error getting package details: {e}")
            return Response(
                {"error": "Failed to retrieve package"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )


class CheckAvailabilityView(APIView):
    """Endpoint pour vérifier la disponibilité d'un package"""

    permission_classes = [AllowAny]
    throttle_classes = [AnonRateThrottle]

    def post(self, request, offer_id):
        """Vérifie la disponibilité et le prix actuel d'un package"""
        try:
            # Pour l'instant, retourner une réponse mockée
            # À implémenter : re-scraper le provider pour avoir le prix en temps réel

            return Response(
                {
                    "offer_id": offer_id,
                    "available": True,
                    "price_changed": False,
                    "current_price": request.data.get("original_price"),
                    "checked_at": datetime.now().isoformat(),
                },
                status=status.HTTP_200_OK,
            )

        except Exception as e:
            logger.error(f"Error checking availability: {e}")
            return Response(
                {"error": "Availability check failed"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )
