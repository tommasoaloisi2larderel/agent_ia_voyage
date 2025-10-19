from typing import Dict, Any, Tuple, List
import logging

logger = logging.getLogger(__name__)


class ExplainService:
    """Service de génération d'explications (pros/cons) pour les packages"""

    def generate_pros_cons(
        self, package: Dict[str, Any], query: Dict[str, Any]
    ) -> Tuple[List[str], List[str]]:
        """
        Génère les avantages et inconvénients d'un package
        Retourne (pros, cons)
        """
        pros = []
        cons = []

        # Prix
        pros_price, cons_price = self._analyze_price(package, query)
        pros.extend(pros_price)
        cons.extend(cons_price)

        # Qualité hôtel
        pros_quality = self._analyze_quality(package)
        pros.extend(pros_quality)

        # Vols et transport
        pros_travel, cons_travel = self._analyze_travel(package)
        pros.extend(pros_travel)
        cons.extend(cons_travel)

        # Extras et services
        pros_extras = self._analyze_extras(package, query)
        pros.extend(pros_extras)

        # Politique d'annulation
        pros_cancel, cons_cancel = self._analyze_cancellation(package)
        pros.extend(pros_cancel)
        cons.extend(cons_cancel)

        # Limiter à 4-5 items chacun pour clarté
        return pros[:5], cons[:4]

    def _analyze_price(self, package: Dict, query: Dict) -> Tuple[List[str], List[str]]:
        """Analyse le prix du package"""
        pros = []
        cons = []

        price = package.get("price", {}).get("per_person_eur", 0)
        budget = query.get("budget_eur", {})
        max_budget = budget.get("max")

        if not price:
            return pros, cons

        if max_budget:
            if price <= 0.7 * max_budget:
                pros.append("Excellent rapport qualité-prix")
            elif price <= 0.85 * max_budget:
                pros.append("Bon rapport qualité-prix")
            elif price > 1.2 * max_budget:
                cons.append(
                    f"Prix supérieur au budget ({int(price)}€ vs {int(max_budget)}€)"
                )

        # Prix par nuit
        duration = package.get("duration_nights", 7)
        price_per_night = price / duration if duration > 0 else 0

        if price_per_night < 100:
            pros.append("Tarif très économique")
        elif price_per_night < 150:
            pros.append("Tarif attractif")

        return pros, cons

    def _analyze_quality(self, package: Dict) -> List[str]:
        """Analyse la qualité de l'hôtel"""
        pros = []

        hotel = package.get("hotel", {})
        stars = hotel.get("stars")
        rating = hotel.get("rating")

        if stars and stars >= 4:
            pros.append(f"Hôtel {stars} étoiles")

        if rating and rating.get("score"):
            score = rating["score"]
            scale = rating.get("scale", 10)
            normalized = score / scale * 10

            if normalized >= 9.0:
                pros.append(f"Excellentes notes clients ({score}/{scale})")
            elif normalized >= 8.0:
                pros.append(f"Très bien noté ({score}/{scale})")
            elif normalized >= 7.0:
                pros.append(f"Bien noté ({score}/{scale})")

        return pros

    def _analyze_travel(self, package: Dict) -> Tuple[List[str], List[str]]:
        """Analyse les conditions de voyage"""
        pros = []
        cons = []

        travel = package.get("travel", {})
        stops_out = travel.get("stops_outbound", 0)
        stops_in = travel.get("stops_inbound", 0)
        baggage = travel.get("baggage", {})

        # Vols directs
        if stops_out == 0 and stops_in == 0:
            pros.append("Vols directs aller-retour")
        elif stops_out == 0 or stops_in == 0:
            pros.append("Vol direct à l'aller ou au retour")
            if stops_out > 0:
                cons.append(f"Vol aller avec {stops_out} escale(s)")
            else:
                cons.append(f"Vol retour avec {stops_in} escale(s)")
        else:
            total_stops = stops_out + stops_in
            cons.append(f"Vols avec escales ({total_stops} au total)")

        # Bagages
        if baggage.get("checked_included"):
            pros.append("Bagage en soute inclus")
        else:
            cons.append("Bagage en soute non inclus")

        return pros, cons

    def _analyze_extras(self, package: Dict, query: Dict) -> List[str]:
        """Analyse les services et extras"""
        pros = []

        extras = package.get("extras", [])
        prefs = query.get("preferences", {})

        # Famille
        if prefs.get("family_friendly"):
            family_extras = [
                "club enfants",
                "club enfant",
                "aire de jeux",
                "parc aquatique",
            ]
            if any(f in " ".join(extras).lower() for f in family_extras):
                pros.append("Idéal pour les familles (club enfants)")

        # Services premium
        premium_keywords = {
            "spa": "Accès spa",
            "thalasso": "Centre de thalassothérapie",
            "plage privée": "Plage privée",
            "piscine": "Piscine sur place",
            "golf": "Parcours de golf",
            "plongée": "Centre de plongée",
        }

        extras_text = " ".join(extras).lower()
        for keyword, label in premium_keywords.items():
            if keyword in extras_text:
                pros.append(label)
                if len(pros) >= 3:  # Limite les extras pour ne pas surcharger
                    break

        return pros

    def _analyze_cancellation(self, package: Dict) -> Tuple[List[str], List[str]]:
        """Analyse la politique d'annulation"""
        pros = []
        cons = []

        cancellation = package.get("cancellation", {})
        policy = cancellation.get("policy", "standard")
        deadline = cancellation.get("deadline_days", 7)

        if policy in ["flexible", "cancellable"]:
            pros.append(f"Annulation flexible (jusqu'à {deadline} jours avant)")
        elif policy == "modifiable":
            pros.append("Modification possible")
        elif policy in ["non_refundable", "strict"]:
            cons.append("Annulation non remboursable")

        return pros, cons

    def generate_summary(self, package: Dict) -> str:
        """Génère un résumé textuel du package"""
        hotel = package.get("hotel", {})
        travel = package.get("travel", {})
        price = package.get("price", {})

        hotel_name = hotel.get("name", "Hôtel")
        location = hotel.get("location", {})
        city = location.get("city", location.get("country", ""))

        duration = package.get("duration_nights", 7)
        board = self._format_board(package.get("board", "all_inclusive"))

        per_person = price.get("per_person_eur", 0)

        stops_out = travel.get("stops_outbound", 0)
        stops_in = travel.get("stops_inbound", 0)
        flight_info = (
            "vols directs"
            if stops_out == 0 and stops_in == 0
            else "vols avec escale(s)"
        )

        summary = (
            f"{hotel_name} à {city}, séjour de {duration} nuits en {board}, "
            f"{flight_info}, à partir de {int(per_person)}€/personne"
        )

        return summary

    def _format_board(self, board: str) -> str:
        """Formate le type de pension pour affichage"""
        board_labels = {
            "all_inclusive": "tout compris",
            "full_board": "pension complète",
            "half_board": "demi-pension",
            "breakfast": "petit-déjeuner",
            "room_only": "logement seul",
        }
        return board_labels.get(board, board)
