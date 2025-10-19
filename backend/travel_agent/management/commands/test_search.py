from django.core.management.base import BaseCommand
import asyncio
import json
from travel_agent.services.aggregator import AggregatorService
from travel_agent.services.explain import ExplainService


class Command(BaseCommand):
    help = "Test the travel search system with a sample query"

    def add_arguments(self, parser):
        parser.add_argument(
            "--destination",
            type=str,
            default="Canaries",
            help="Destination to search for",
        )
        parser.add_argument(
            "--budget", type=int, default=1500, help="Maximum budget per person in EUR"
        )
        parser.add_argument(
            "--verbose", action="store_true", help="Show detailed output"
        )

    def handle(self, *args, **options):
        destination = options["destination"]
        budget = options["budget"]
        verbose = options["verbose"]

        self.stdout.write(self.style.SUCCESS("=== Travel Agent Search Test ===\n"))

        # Créer une query de test
        query = {
            "origin": "PAR",
            "destinations": [destination],
            "date_range": {"start": "2025-07-15", "end": "2025-08-15"},
            "duration_nights": [7],
            "budget_eur": {"max": budget},
            "party": {"adults": 2, "children": []},
            "board": "all_inclusive",
            "flex": {"days": 3},
            "preferences": {"family_friendly": False, "direct_flight": False},
        }

        self.stdout.write(f"Query: {json.dumps(query, indent=2)}\n")
        self.stdout.write("Searching...\n")

        # Lancer la recherche
        aggregator = AggregatorService()

        try:
            results = asyncio.run(aggregator.search(query))

            self.stdout.write(
                self.style.SUCCESS(f"\n✓ Found {len(results)} packages\n")
            )

            if not results:
                self.stdout.write(
                    self.style.WARNING("No packages found. This might be normal if:")
                )
                self.stdout.write("  - Adapters are not fully implemented")
                self.stdout.write("  - Network issues")
                self.stdout.write("  - Provider websites changed structure\n")
                return

            # Statistiques
            stats = aggregator.get_stats(results)
            self.stdout.write("\n=== Statistics ===")
            self.stdout.write(f"Total packages: {stats['total']}")
            self.stdout.write(
                f"By provider: {json.dumps(stats['by_provider'], indent=2)}"
            )
            self.stdout.write(
                f"Price range: {stats['price_range']['min']:.0f}€ - {stats['price_range']['max']:.0f}€"
            )
            self.stdout.write(f"Average price: {stats['price_range']['avg']:.0f}€")
            self.stdout.write(f"Average score: {stats['avg_score']:.3f}\n")

            # Afficher les top 5
            self.stdout.write("\n=== Top 5 Packages ===\n")

            explain_service = ExplainService()

            for i, package in enumerate(results[:5], 1):
                self._display_package(i, package, explain_service, query, verbose)

            self.stdout.write(
                self.style.SUCCESS("\n✓ Search test completed successfully!")
            )

        except Exception as e:
            self.stdout.write(self.style.ERROR(f"\n✗ Error during search: {str(e)}"))
            if verbose:
                import traceback

                self.stdout.write(traceback.format_exc())

    def _display_package(self, rank, package, explain_service, query, verbose):
        """Affiche un package de manière formatée"""

        # Header
        self.stdout.write(
            self.style.SUCCESS(f'\n#{rank} - Score: {package.get("score", 0):.3f}')
        )
        self.stdout.write("─" * 70)

        # Titre
        title = package.get("title", "N/A")
        self.stdout.write(f"📍 {title}")

        # Hôtel
        hotel = package.get("hotel", {})
        location = hotel.get("location", {})
        stars = "⭐" * hotel.get("stars", 0) if hotel.get("stars") else "N/A"
        city = location.get("city", "N/A")
        country = location.get("country", "N/A")

        self.stdout.write(f"🏨 {hotel.get('name', 'N/A')} - {stars}")
        self.stdout.write(f"📍 {city}, {country}")

        # Note
        rating = hotel.get("rating")
        if rating and rating.get("score"):
            self.stdout.write(f"⭐ Note: {rating['score']}/{rating.get('scale', 10)}")

        # Prix
        price = package.get("price", {})
        per_person = price.get("per_person_eur", 0)
        total = price.get("total_eur", 0)
        self.stdout.write(f"💰 {per_person:.0f}€/pers (Total: {total:.0f}€)")

        # Durée et pension
        duration = package.get("duration_nights", 0)
        board = package.get("board", "N/A")
        board_labels = {
            "all_inclusive": "Tout Compris",
            "full_board": "Pension Complète",
            "half_board": "Demi-Pension",
            "breakfast": "Petit-Déjeuner",
        }
        board_display = board_labels.get(board, board)
        self.stdout.write(f"📅 {duration} nuits - {board_display}")

        # Vols
        travel = package.get("travel", {})
        stops_out = travel.get("stops_outbound", 0)
        stops_in = travel.get("stops_inbound", 0)

        if stops_out == 0 and stops_in == 0:
            flight_info = "✈️  Vols directs"
        else:
            flight_info = f"✈️  Vols avec {stops_out + stops_in} escale(s)"

        self.stdout.write(flight_info)

        # Bagages
        baggage = travel.get("baggage", {})
        if baggage.get("checked_included"):
            self.stdout.write("🧳 Bagage soute inclus")

        # Pros/Cons
        pros = package.get("pros", [])
        cons = package.get("cons", [])

        if pros:
            self.stdout.write("\n✅ Avantages:")
            for pro in pros:
                self.stdout.write(f"   • {pro}")

        if cons:
            self.stdout.write("\n❌ Inconvénients:")
            for con in cons:
                self.stdout.write(f"   • {con}")

        # Extras
        extras = package.get("extras", [])
        if extras and verbose:
            self.stdout.write(f"\n🎁 Services: {', '.join(extras[:5])}")

        # Provider et URL
        provider = package.get("provider", "N/A").upper()
        url = package.get("url", "N/A")
        self.stdout.write(f"\n🔗 Provider: {provider}")

        if verbose:
            self.stdout.write(f"   URL: {url}")

            # Score détaillé
            from travel_agent.services.scoring import ScoringService

            scorer = ScoringService()
            score_details = scorer.get_score_explanation(package, query)
            self.stdout.write(f"\n📊 Score breakdown:")
            for key, value in score_details.items():
                self.stdout.write(f"   {key}: {value:.3f}")
