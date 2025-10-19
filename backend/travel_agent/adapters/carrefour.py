import asyncio
from typing import List, Dict, Any
from bs4 import BeautifulSoup
from urllib.parse import urlencode, urljoin
import re
from datetime import datetime
import logging

from .base import ProviderAdapter

logger = logging.getLogger(__name__)


class CarrefourAdapter(ProviderAdapter):
    """Adapter pour Carrefour Voyages"""

    provider_name = "carrefour"
    base_url = "https://www.carrefour-voyages.fr"

    async def search(self, query: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Recherche sur Carrefour Voyages"""
        packages = []

        search_params = self._build_search_params(query)
        search_url = f"{self.base_url}/sejour"

        try:
            response = await self.fetch_with_retry(search_url, params=search_params)
            soup = BeautifulSoup(response.text, "lxml")

            # Trouver tous les packages (structure HTML à adapter)
            package_elements = soup.find_all(
                "div", class_=re.compile("product|offer|card")
            )

            for element in package_elements[:20]:
                try:
                    package = self.parse_package(element)
                    if package:
                        packages.append(package)
                except Exception as e:
                    logger.error(f"Error parsing Carrefour package: {e}")
                    continue

        except Exception as e:
            logger.error(f"Error fetching Carrefour results: {e}")

        return packages

    def _build_search_params(self, query: Dict[str, Any]) -> Dict:
        """Construit les paramètres de recherche pour Carrefour"""
        params = {}

        if query.get("origin"):
            params["depart"] = query["origin"]

        if query.get("destinations"):
            params["destination"] = query["destinations"][0]

        date_range = query.get("date_range", {})
        if date_range.get("start"):
            params["date_debut"] = date_range["start"]
        if date_range.get("end"):
            params["date_fin"] = date_range["end"]

        durations = query.get("duration_nights", [7])
        if durations:
            params["duree"] = durations[0]

        party = query.get("party", {})
        params["adultes"] = party.get("adults", 2)
        children = party.get("children", [])
        if children:
            params["enfants"] = len(children)
            for i, age in enumerate(children):
                params[f"age_enfant_{i+1}"] = age

        budget = query.get("budget_eur", {})
        if budget.get("max"):
            params["budget_max"] = int(budget["max"])

        if query.get("board") == "all_inclusive":
            params["pension"] = "all_inclusive"

        return params

    def parse_package(self, element) -> Dict[str, Any]:
        """Parse un élément HTML Carrefour en package normalisé"""
        package = {
            "provider": self.provider_name,
            "offer_id": "",
            "title": "",
            "hotel": {
                "name": "",
                "stars": None,
                "location": {"country": "", "region": "", "city": ""},
                "rating": None,
            },
            "travel": {
                "departure": {"airport": "", "datetime": ""},
                "return": {"airport": "", "datetime": ""},
                "stops_outbound": 0,
                "stops_inbound": 0,
                "baggage": {"cabin_included": True, "checked_included": False},
            },
            "board": "all_inclusive",
            "room": "",
            "duration_nights": 7,
            "price": {"total_eur": 0, "per_person_eur": 0, "includes_fees": True},
            "cancellation": {"policy": "standard", "deadline_days": 7},
            "extras": [],
            "url": "",
        }

        # ID de l'offre
        offer_id = element.get("data-offer-id") or element.get("id", "")
        if not offer_id:
            link = element.find("a", href=True)
            if link:
                offer_id = f"carrefour-{abs(hash(link['href']))}"
        package["offer_id"] = offer_id

        # Titre et nom hôtel
        title_elem = element.find(
            ["h2", "h3", "h4"], class_=re.compile("title|name|hotel")
        )
        if title_elem:
            package["title"] = title_elem.get_text(strip=True)
            package["hotel"]["name"] = package["title"]

        # Étoiles
        stars_elem = element.find(class_=re.compile("star|etoile"))
        if stars_elem:
            stars_text = stars_elem.get_text()
            stars_match = re.search(r"(\d+)", stars_text)
            if stars_match:
                package["hotel"]["stars"] = int(stars_match.group(1))

        # Localisation
        location_elem = element.find(class_=re.compile("location|destination|place"))
        if location_elem:
            location_text = location_elem.get_text(strip=True)
            parts = [p.strip() for p in location_text.split(",")]
            if len(parts) >= 1:
                package["hotel"]["location"]["city"] = parts[0]
            if len(parts) >= 2:
                package["hotel"]["location"]["country"] = parts[-1]

        # Note client
        rating_elem = element.find(class_=re.compile("rating|note|avis"))
        if rating_elem:
            rating_text = rating_elem.get_text()
            rating_match = re.search(r"(\d+(?:[.,]\d+)?)\s*/\s*(\d+)", rating_text)
            if rating_match:
                score = float(rating_match.group(1).replace(",", "."))
                scale = int(rating_match.group(2))
                package["hotel"]["rating"] = {
                    "score": score,
                    "scale": scale,
                    "count": None,
                }

        # Prix
        price_elem = element.find(class_=re.compile("price|prix|tarif"))
        if price_elem:
            price_text = price_elem.get_text()
            price = self.normalize_price(price_text)
            package["price"]["per_person_eur"] = price
            package["price"]["total_eur"] = price * 2

        # Durée
        duration_elem = element.find(class_=re.compile("duration|duree|nuit"))
        if duration_elem:
            duration_text = duration_elem.get_text()
            nights_match = re.search(r"(\d+)\s*nuits?", duration_text, re.IGNORECASE)
            if nights_match:
                package["duration_nights"] = int(nights_match.group(1))

        # Pension
        board_elem = element.find(class_=re.compile("board|pension|formule"))
        if board_elem:
            board_text = board_elem.get_text().lower()
            if "tout compris" in board_text or "all" in board_text:
                package["board"] = "all_inclusive"
            elif "demi" in board_text:
                package["board"] = "half_board"
            elif "complète" in board_text or "complete" in board_text:
                package["board"] = "full_board"

        # Extras
        extras = []
        text_content = element.get_text().lower()

        if "club enfant" in text_content:
            extras.append("club enfants")
        if "piscine" in text_content:
            extras.append("piscine")
        if "spa" in text_content:
            extras.append("spa")
        if "plage" in text_content:
            extras.append("accès plage")
        if "wifi" in text_content:
            extras.append("wifi gratuit")
        if "parking" in text_content:
            extras.append("parking")

        package["extras"] = extras

        # URL
        link_elem = element.find("a", href=True)
        if link_elem:
            package["url"] = urljoin(self.base_url, link_elem["href"])

        # Dates (si disponibles)
        date_elem = element.find(class_=re.compile("date|depart"))
        if date_elem:
            date_text = date_elem.get_text()
            dates = re.findall(r"\d{2}/\d{2}/\d{4}", date_text)
            if len(dates) >= 2:
                package["travel"]["departure"]["datetime"] = self.parse_date(dates[0])
                package["travel"]["return"]["datetime"] = self.parse_date(dates[1])

        # Aéroport par défaut
        package["travel"]["departure"]["airport"] = "PAR"
        package["travel"]["return"]["airport"] = "PAR"

        # Vols
        flight_elem = element.find(text=re.compile("direct|escale|vol", re.IGNORECASE))
        if flight_elem:
            flight_text = str(flight_elem).lower()
            if "direct" in flight_text:
                package["travel"]["stops_outbound"] = 0
                package["travel"]["stops_inbound"] = 0
            elif "escale" in flight_text:
                package["travel"]["stops_outbound"] = 1
                package["travel"]["stops_inbound"] = 1

        # Bagages (Carrefour inclut souvent le bagage)
        package["travel"]["baggage"]["checked_included"] = True

        # Politique d'annulation
        cancel_elem = element.find(
            text=re.compile("annulation|flexible|modifiable", re.IGNORECASE)
        )
        if cancel_elem:
            cancel_text = str(cancel_elem).lower()
            if "flexible" in cancel_text or "gratuit" in cancel_text:
                package["cancellation"]["policy"] = "flexible"
            elif "modifiable" in cancel_text:
                package["cancellation"]["policy"] = "modifiable"

        return package
