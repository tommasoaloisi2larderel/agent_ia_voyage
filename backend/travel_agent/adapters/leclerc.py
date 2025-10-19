import asyncio
from typing import List, Dict, Any
from bs4 import BeautifulSoup
from urllib.parse import urlencode, urljoin
import re
from datetime import datetime
import logging

from .base import ProviderAdapter

logger = logging.getLogger(__name__)


class LeclercAdapter(ProviderAdapter):
    """Adapter pour E.Leclerc Voyages"""

    provider_name = "leclerc"
    base_url = "https://www.e-leclerc-voyages.com"

    async def search(self, query: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Recherche sur E.Leclerc Voyages"""
        packages = []

        search_params = self._build_search_params(query)
        search_url = f"{self.base_url}/voyage"

        try:
            response = await self.fetch_with_retry(search_url, params=search_params)
            soup = BeautifulSoup(response.text, "lxml")

            # Parser les packages
            package_elements = soup.find_all(
                "div", class_=re.compile("product|offer|sejour|voyage")
            )

            for element in package_elements[:20]:
                try:
                    package = self.parse_package(element)
                    if package:
                        packages.append(package)
                except Exception as e:
                    logger.error(f"Error parsing Leclerc package: {e}")
                    continue

        except Exception as e:
            logger.error(f"Error fetching Leclerc results: {e}")

        return packages

    def _build_search_params(self, query: Dict[str, Any]) -> Dict:
        """Construit les paramètres de recherche pour Leclerc"""
        params = {}

        if query.get("origin"):
            params["ville_depart"] = query["origin"]

        if query.get("destinations"):
            params["destination"] = query["destinations"][0]

        date_range = query.get("date_range", {})
        if date_range.get("start"):
            params["date_depart"] = date_range["start"]
        if date_range.get("end"):
            params["date_retour"] = date_range["end"]

        durations = query.get("duration_nights", [7])
        if durations:
            params["duree_sejour"] = durations[0]

        party = query.get("party", {})
        params["nb_adultes"] = party.get("adults", 2)
        children = party.get("children", [])
        if children:
            params["nb_enfants"] = len(children)

        budget = query.get("budget_eur", {})
        if budget.get("max"):
            params["prix_max"] = int(budget["max"])

        if query.get("board") == "all_inclusive":
            params["formule"] = "tout_compris"

        return params

    def parse_package(self, element) -> Dict[str, Any]:
        """Parse un élément HTML Leclerc en package normalisé"""
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
                "baggage": {"cabin_included": True, "checked_included": True},
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
        offer_id = element.get("data-product-id") or element.get("data-offer", "")
        if not offer_id:
            link = element.find("a", href=True)
            if link:
                offer_id = f"leclerc-{abs(hash(link['href']))}"
        package["offer_id"] = offer_id

        # Titre et nom hôtel
        title_elem = element.find(
            ["h2", "h3", "h4"], class_=re.compile("title|name|hotel")
        )
        if title_elem:
            package["title"] = title_elem.get_text(strip=True)
            # Extraire le nom de l'hôtel (souvent avant un "-" ou "à")
            title_parts = package["title"].split("-")
            package["hotel"]["name"] = title_parts[0].strip()

        # Étoiles
        stars_elem = element.find(class_=re.compile("star|etoile|categorie"))
        if stars_elem:
            stars_text = stars_elem.get_text()
            stars_match = re.search(r"(\d+)\s*étoiles?", stars_text, re.IGNORECASE)
            if stars_match:
                package["hotel"]["stars"] = int(stars_match.group(1))

        # Localisation
        location_elem = element.find(
            class_=re.compile("location|destination|lieu|ville")
        )
        if location_elem:
            location_text = location_elem.get_text(strip=True)
            # Format typique: "Ville, Région, Pays" ou "Ville - Pays"
            parts = re.split(r"[,\-]", location_text)
            parts = [p.strip() for p in parts if p.strip()]

            if len(parts) >= 1:
                package["hotel"]["location"]["city"] = parts[0]
            if len(parts) >= 2:
                package["hotel"]["location"]["region"] = (
                    parts[1] if len(parts) > 2 else ""
                )
            if len(parts) >= 2:
                package["hotel"]["location"]["country"] = parts[-1]

        # Note client
        rating_elem = element.find(class_=re.compile("rating|note|avis|evaluation"))
        if rating_elem:
            rating_text = rating_elem.get_text()
            # Formats possibles: "8.5/10", "4/5", "8,5/10"
            rating_match = re.search(r"(\d+(?:[.,]\d+)?)\s*/\s*(\d+)", rating_text)
            if rating_match:
                score = float(rating_match.group(1).replace(",", "."))
                scale = int(rating_match.group(2))

                # Compter le nombre d'avis si disponible
                count_match = re.search(r"(\d+)\s*avis", rating_text, re.IGNORECASE)
                count = int(count_match.group(1)) if count_match else None

                package["hotel"]["rating"] = {
                    "score": score,
                    "scale": scale,
                    "count": count,
                }

        # Prix
        price_elem = element.find(class_=re.compile("price|prix|tarif|montant"))
        if price_elem:
            price_text = price_elem.get_text()
            price = self.normalize_price(price_text)

            # Déterminer si c'est un prix par personne ou total
            if "pers" in price_text.lower() or "/pers" in price_text.lower():
                package["price"]["per_person_eur"] = price
                package["price"]["total_eur"] = price * 2  # Assume 2 personnes
            else:
                package["price"]["total_eur"] = price
                package["price"]["per_person_eur"] = price / 2

        # Durée
        duration_elem = element.find(class_=re.compile("duration|duree|nuit|jour"))
        if duration_elem:
            duration_text = duration_elem.get_text()
            nights_match = re.search(r"(\d+)\s*nuits?", duration_text, re.IGNORECASE)
            if nights_match:
                package["duration_nights"] = int(nights_match.group(1))
            else:
                # Parfois format "8 jours / 7 nuits"
                days_match = re.search(r"(\d+)\s*jours?", duration_text, re.IGNORECASE)
                if days_match:
                    package["duration_nights"] = int(days_match.group(1)) - 1

        # Type de chambre
        room_elem = element.find(class_=re.compile("room|chambre|hebergement"))
        if room_elem:
            package["room"] = room_elem.get_text(strip=True)

        # Pension
        board_elem = element.find(
            class_=re.compile("board|pension|formule|restauration")
        )
        if board_elem:
            board_text = board_elem.get_text().lower()
            if "tout compris" in board_text or "all inclusive" in board_text:
                package["board"] = "all_inclusive"
            elif "pension complète" in board_text or "complete" in board_text:
                package["board"] = "full_board"
            elif "demi-pension" in board_text or "demi pension" in board_text:
                package["board"] = "half_board"
            elif "petit déjeuner" in board_text or "breakfast" in board_text:
                package["board"] = "breakfast"

        # Extras et services
        extras = []
        text_content = element.get_text().lower()

        extras_keywords = {
            "club enfant": "club enfants",
            "kids club": "club enfants",
            "piscine": "piscine",
            "spa": "spa",
            "thalasso": "thalassothérapie",
            "plage": "accès plage",
            "plage privée": "plage privée",
            "wifi": "wifi gratuit",
            "parking": "parking gratuit",
            "navette": "navette aéroport",
            "animation": "animations",
            "golf": "golf",
            "tennis": "tennis",
            "fitness": "salle de sport",
        }

        for keyword, label in extras_keywords.items():
            if keyword in text_content:
                if label not in extras:  # Éviter doublons
                    extras.append(label)

        package["extras"] = extras

        # URL de l'offre
        link_elem = element.find("a", href=True)
        if link_elem:
            href = link_elem["href"]
            package["url"] = (
                urljoin(self.base_url, href) if not href.startswith("http") else href
            )

        # Dates de voyage
        date_elem = element.find(class_=re.compile("date|depart|periode"))
        if date_elem:
            date_text = date_elem.get_text()
            # Formats: "15/07/2025 - 22/07/2025" ou "du 15/07 au 22/07"
            dates = re.findall(r"(\d{2}/\d{2}/\d{4})", date_text)
            if len(dates) >= 2:
                package["travel"]["departure"]["datetime"] = self.parse_date(dates[0])
                package["travel"]["return"]["datetime"] = self.parse_date(dates[1])
            elif len(dates) == 1:
                # Une seule date = départ, calculer retour avec duration
                package["travel"]["departure"]["datetime"] = self.parse_date(dates[0])

        # Aéroport de départ (souvent Paris pour Leclerc)
        airport_elem = element.find(class_=re.compile("airport|aeroport|depart"))
        if airport_elem:
            airport_text = airport_elem.get_text().upper()
            # Extraire code IATA si présent
            iata_match = re.search(r"\b([A-Z]{3})\b", airport_text)
            if iata_match:
                airport_code = iata_match.group(1)
                package["travel"]["departure"]["airport"] = airport_code
                package["travel"]["return"]["airport"] = airport_code
        else:
            # Par défaut
            package["travel"]["departure"]["airport"] = "PAR"
            package["travel"]["return"]["airport"] = "PAR"

        # Informations sur les vols
        flight_elem = element.find(
            text=re.compile("vol|direct|escale|stop", re.IGNORECASE)
        )
        if flight_elem:
            flight_text = str(flight_elem).lower()
            if "direct" in flight_text and "sans escale" in flight_text:
                package["travel"]["stops_outbound"] = 0
                package["travel"]["stops_inbound"] = 0
            elif "1 escale" in flight_text or "une escale" in flight_text:
                package["travel"]["stops_outbound"] = 1
                package["travel"]["stops_inbound"] = 1
            elif "escale" in flight_text:
                # Au moins une escale
                package["travel"]["stops_outbound"] = 1
                package["travel"]["stops_inbound"] = 1

        # Bagages (Leclerc inclut généralement les bagages)
        baggage_elem = element.find(
            text=re.compile("bagage|baggage|soute", re.IGNORECASE)
        )
        if baggage_elem:
            baggage_text = str(baggage_elem).lower()
            if "inclus" in baggage_text or "compris" in baggage_text:
                package["travel"]["baggage"]["checked_included"] = True
        else:
            # Par défaut, Leclerc inclut souvent les bagages
            package["travel"]["baggage"]["checked_included"] = True

        # Politique d'annulation
        cancel_elem = element.find(
            text=re.compile("annulation|remboursement|flexible", re.IGNORECASE)
        )
        if cancel_elem:
            cancel_text = str(cancel_elem).lower()
            if "gratuit" in cancel_text or "sans frais" in cancel_text:
                package["cancellation"]["policy"] = "flexible"
                # Extraire le délai
                days_match = re.search(r"(\d+)\s*jours?", cancel_text)
                if days_match:
                    package["cancellation"]["deadline_days"] = int(days_match.group(1))
            elif "flexible" in cancel_text or "modifiable" in cancel_text:
                package["cancellation"]["policy"] = "modifiable"
            elif "non remboursable" in cancel_text:
                package["cancellation"]["policy"] = "non_refundable"

        # Promotions ou offres spéciales
        promo_elem = element.find(class_=re.compile("promo|reduction|offre|deal"))
        if promo_elem:
            promo_text = promo_elem.get_text(strip=True)
            if promo_text and "extras" in package:
                package["extras"].append(f"promo: {promo_text[:50]}")

        return package
