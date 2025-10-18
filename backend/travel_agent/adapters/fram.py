# backend/travel_agent/adapters/fram.py
import asyncio
from typing import List, Dict, Any
from bs4 import BeautifulSoup
from urllib.parse import urlencode, urljoin
import re
from datetime import datetime, timedelta
import logging

from .base import ProviderAdapter

logger = logging.getLogger(__name__)


class FramAdapter(ProviderAdapter):
    """Adapter pour FRAM"""

    provider_name = "fram"
    base_url = "https://www.fram.fr"

    async def search(self, query: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Recherche sur FRAM"""
        packages = []

        # Construire l'URL de recherche FRAM
        # Note: Les paramètres exacts dépendent de l'API/structure du site FRAM
        search_params = self._build_search_params(query)
        search_url = f"{self.base_url}/recherche"

        try:
            # Fetch la page de résultats
            response = await self.fetch_with_retry(search_url, params=search_params)

            # Parser les résultats
            soup = BeautifulSoup(response.text, "lxml")

            # Trouver tous les packages (adapter selon structure HTML réelle)
            package_elements = soup.find_all("div", class_="product-item")

            for element in package_elements[:20]:  # Limite à 20 résultats
                try:
                    package = self.parse_package(element)
                    if package:
                        packages.append(package)
                except Exception as e:
                    logger.error(f"Error parsing FRAM package: {e}")
                    continue

        except Exception as e:
            logger.error(f"Error fetching FRAM results: {e}")

        return packages

    def _build_search_params(self, query: Dict[str, Any]) -> Dict:
        """Construit les paramètres de recherche pour FRAM"""
        params = {}

        # Origine
        if query.get("origin"):
            params["departure"] = query["origin"]

        # Destinations
        if query.get("destinations"):
            params["destination"] = query["destinations"][
                0
            ]  # FRAM prend 1 dest à la fois

        # Dates
        date_range = query.get("date_range", {})
        if date_range.get("start"):
            params["date_depart"] = date_range["start"]
        if date_range.get("end"):
            params["date_retour"] = date_range["end"]

        # Durée
        durations = query.get("duration_nights", [7])
        if durations:
            params["duree"] = durations[0]

        # Voyageurs
        party = query.get("party", {})
        params["nb_adultes"] = party.get("adults", 2)
        children = party.get("children", [])
        params["nb_enfants"] = len(children)

        # Budget
        budget = query.get("budget_eur", {})
        if budget.get("max"):
            params["prix_max"] = int(budget["max"])

        # Pension
        if query.get("board") == "all_inclusive":
            params["formule"] = "tout_compris"

        return params

    def parse_package(self, element) -> Dict[str, Any]:
        """Parse un élément HTML en package normalisé"""
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

        # Extraire l'ID
        offer_id = element.get("data-product-id", "")
        if not offer_id:
            # Fallback: générer un ID depuis l'URL ou autre attribut
            link = element.find("a", href=True)
            if link:
                offer_id = f"fram-{hash(link['href'])}"
        package["offer_id"] = offer_id

        # Titre et nom de l'hôtel
        title_elem = element.find(["h3", "h4"], class_=re.compile("title|name"))
        if title_elem:
            package["title"] = title_elem.get_text(strip=True)
            package["hotel"]["name"] = package["title"].split("-")[0].strip()

        # Étoiles
        stars_elem = element.find(class_=re.compile("stars|rating"))
        if stars_elem:
            stars_text = stars_elem.get_text()
            stars_match = re.search(r"(\d+)\s*étoiles?", stars_text, re.IGNORECASE)
            if stars_match:
                package["hotel"]["stars"] = int(stars_match.group(1))

        # Localisation
        location_elem = element.find(class_=re.compile("location|destination"))
        if location_elem:
            location_text = location_elem.get_text(strip=True)
            parts = location_text.split(",")
            if len(parts) >= 1:
                package["hotel"]["location"]["city"] = parts[0].strip()
            if len(parts) >= 2:
                package["hotel"]["location"]["country"] = parts[-1].strip()

        # Prix
        price_elem = element.find(class_=re.compile("price|tarif"))
        if price_elem:
            price_text = price_elem.get_text()
            price = self.normalize_price(price_text)
            package["price"]["per_person_eur"] = price
            # Estimer le prix total (à ajuster selon le contexte)
            package["price"]["total_eur"] = price * 2  # Par défaut pour 2 personnes

        # Dates de voyage
        date_elem = element.find(class_=re.compile("date|depart"))
        if date_elem:
            date_text = date_elem.get_text(strip=True)
            # Parser les dates (format à adapter selon FRAM)
            dates = re.findall(r"\d{2}/\d{2}/\d{4}", date_text)
            if len(dates) >= 2:
                package["travel"]["departure"]["datetime"] = self.parse_date(dates[0])
                package["travel"]["return"]["datetime"] = self.parse_date(dates[1])

        # Aéroport (souvent Paris par défaut pour FRAM)
        package["travel"]["departure"]["airport"] = "PAR"
        package["travel"]["return"]["airport"] = "PAR"

        # Durée
        duration_elem = element.find(class_=re.compile("duration|duree"))
        if duration_elem:
            duration_text = duration_elem.get_text()
            nights_match = re.search(r"(\d+)\s*nuits?", duration_text, re.IGNORECASE)
            if nights_match:
                package["duration_nights"] = int(nights_match.group(1))

        # Pension
        board_elem = element.find(class_=re.compile("board|pension|formule"))
        if board_elem:
            board_text = board_elem.get_text().lower()
            if "tout compris" in board_text or "all inclusive" in board_text:
                package["board"] = "all_inclusive"
            elif "demi-pension" in board_text:
                package["board"] = "half_board"
            elif "pension complète" in board_text:
                package["board"] = "full_board"

        # Extras (clubs enfants, etc.)
        extras = []
        if element.find(text=re.compile("club enfants?", re.IGNORECASE)):
            extras.append("club enfants")
        if element.find(text=re.compile("piscine", re.IGNORECASE)):
            extras.append("piscine")
        if element.find(text=re.compile("spa|thalasso", re.IGNORECASE)):
            extras.append("spa")
        if element.find(text=re.compile("plage", re.IGNORECASE)):
            extras.append("accès plage")
        package["extras"] = extras

        # URL de l'offre
        link_elem = element.find("a", href=True)
        if link_elem:
            package["url"] = urljoin(self.base_url, link_elem["href"])

        # Vols (à enrichir avec plus de détails si disponibles)
        flight_info = element.find(class_=re.compile("flight|vol"))
        if flight_info:
            flight_text = flight_info.get_text().lower()
            if "direct" in flight_text:
                package["travel"]["stops_outbound"] = 0
                package["travel"]["stops_inbound"] = 0
            elif "escale" in flight_text:
                package["travel"]["stops_outbound"] = 1
                package["travel"]["stops_inbound"] = 1

        # Bagages (FRAM inclut souvent le bagage en soute)
        package["travel"]["baggage"]["checked_included"] = True

        # Politique d'annulation (par défaut pour FRAM)
        package["cancellation"] = {"policy": "modifiable", "deadline_days": 15}

        return package
