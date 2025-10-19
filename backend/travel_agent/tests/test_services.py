import pytest
from django.test import TestCase
from travel_agent.services.normalizer import NormalizerService
from travel_agent.services.scoring import ScoringService
from travel_agent.services.explain import ExplainService


class TestNormalizerService(TestCase):
    """Tests pour le service de normalisation"""
    
    def setUp(self):
        self.normalizer = NormalizerService()
    
    def test_normalize_price(self):
        """Test de normalisation des prix"""
        raw = {
            "offer_id": "test-123",
            "title": "Test Hotel",
            "hotel": {"name": "Test Hotel"},
            "travel": {
                "departure": {"airport": "PAR", "datetime": "2025-07-15"},
                "return": {"airport": "PAR", "datetime": "2025-07-22"}
            },
            "price": {"per_person_eur": 500, "total_eur": 0},
        }
        
        normalized = self.normalizer.normalize_package(raw, "test")
        
        assert normalized is not None
        assert normalized["price"]["per_person_eur"] == 500
        assert normalized["price"]["total_eur"] == 1000  # 500 * 2
    
    def test_normalize_board(self):
        """Test de normalisation des types de pension"""
        test_cases = [
            ("Tout compris", "all_inclusive"),
            ("tout inclus", "all_inclusive"),
            ("Pension complète", "full_board"),
            ("Demi-pension", "half_board"),
        ]
        
        for input_board, expected in test_cases:
            result = self.normalizer._normalize_board(input_board)
            assert result == expected, f"{input_board} → {result} (expected {expected})"
    
    def test_normalize_airport(self):
        """Test de normalisation des codes aéroport"""
        test_cases = [
            ("PAR", "PAR"),
            ("CDG", "CDG"),
            ("paris", "PAR"),
            ("orly", "ORY"),
        ]
        
        for input_airport, expected in test_cases:
            result = self.normalizer._normalize_airport(input_airport)
            assert result == expected
    
    def test_parse_stars(self):
        """Test de parsing des étoiles"""
        test_cases = [
            (4, 4),
            ("4", 4),
            ("4 étoiles", 4),
            ("5 stars", 5),
            (None, None),
            (6, 5),  # Max 5 étoiles
        ]
        
        for input_stars, expected in test_cases:
            result = self.normalizer._parse_stars(input_stars)
            assert result == expected


class TestScoringService(TestCase):
    """Tests pour le service de scoring"""
    
    def setUp(self):
        self.scorer = ScoringService()
        self.query = {
            "origin": "PAR",
            "destinations": ["Canaries"],
            "budget_eur": {"max": 1500},
            "party": {"adults": 2},
            "board": "all_inclusive",
            "preferences": {"family_friendly": True},
        }
    
    def test_score_price_within_budget(self):
        """Test scoring prix dans le budget"""
        package = {
            "price": {"per_person_eur": 1000},
        }
        
        score = self.scorer._score_price(package, self.query)
        assert score >= 0.8  # Dans le budget
    
    def test_score_price_above_budget(self):
        """Test scoring prix au-dessus du budget"""
        package = {
            "price": {"per_person_eur": 2000},
        }
        
        score = self.scorer._score_price(package, self.query)
        assert score < 0.5  # Trop cher
    
    def test_score_quality_with_stars(self):
        """Test scoring qualité avec étoiles"""
        package = {
            "hotel": {
                "stars": 4,
                "rating": {"score": 8.5, "scale": 10},
            }
        }
        
        score = self.scorer._score_quality(package)
        assert score > 0.7  # Bonne qualité
    
    def test_score_convenience_direct_flights(self):
        """Test scoring commodité avec vols directs"""
        package = {
            "travel": {
                "stops_outbound": 0,
                "stops_inbound": 0,
                "baggage": {"checked_included": True},
            },
            "cancellation": {"policy": "flexible"},
            "duration_nights": 7,
        }
        
        score = self.scorer._score_convenience(package, self.query)
        assert score >= 0.8  # Très pratique
    
    def test_score_preferences_family(self):
        """Test scoring préférences familiales"""
        package = {
            "extras": ["club enfants", "piscine"],
            "board": "all_inclusive",
        }
        
        score = self.scorer._score_preferences(package, self.query)
        assert score > 0.3  # Bonus pour extras famille
    
    def test_full_scoring(self):
        """Test scoring complet"""
        package = {
            "offer_id": "test-123",
            "hotel": {
                "name": "Hotel Paradise",
                "stars": 4,
                "rating": {"score": 8.5, "scale": 10},
            },
            "travel": {
                "stops_outbound": 0,
                "stops_inbound": 0,
                "baggage": {"checked_included": True},
            },
            "price": {"per_person_eur": 1200},
            "board": "all_inclusive",
            "duration_nights": 7,
        }
        
        summary = self.explainer.generate_summary(package)
        
        assert "Hotel Paradise" in summary
        assert "Héraklion" in summary
        assert "7 nuits" in summary
        assert "tout compris" in summary
        assert "1200" in summary


@pytest.mark.asyncio
class TestAggregatorService:
    """Tests pour le service d'agrégation (async)"""
    
    @pytest.fixture
    def query(self):
        return {
            "origin": "PAR",
            "destinations": ["Canaries"],
            "date_range": {"start": "2025-07-15", "end": "2025-08-15"},
            "duration_nights": [7],
            "budget_eur": {"max": 1500},
            "party": {"adults": 2},
            "board": "all_inclusive",
        }
    
    def test_dedup_key_generation(self):
        """Test génération des clés de déduplication"""
        from travel_agent.services.aggregator import AggregatorService
        
        aggregator = AggregatorService()
        
        package1 = {
            "hotel": {"name": "Hotel Paradise"},
            "travel": {
                "departure": {"airport": "PAR", "datetime": "2025-07-15T10:00:00"},
                "return": {"datetime": "2025-07-22T18:00:00"},
            },
            "duration_nights": 7,
            "board": "all_inclusive",
        }
        
        package2 = {
            "hotel": {"name": "Hôtel Paradise"},  # Accent différent
            "travel": {
                "departure": {"airport": "PAR", "datetime": "2025-07-15T11:00:00"},
                "return": {"datetime": "2025-07-22T19:00:00"},
            },
            "duration_nights": 7,
            "board": "all_inclusive",
        }
        
        key1 = aggregator._dedup_key(package1)
        key2 = aggregator._dedup_key(package2)
        
        # Les clés devraient être identiques (même hôtel, même dates)
        assert key1 == key2
    
    def test_normalize_hotel_name(self):
        """Test normalisation des noms d'hôtels"""
        from travel_agent.services.aggregator import AggregatorService
        
        aggregator = AggregatorService()
        
        test_cases = [
            ("Hôtel Paradise Resort & Spa", "paradise"),
            ("Club Framissima Paradise", "framissima paradise"),
            ("Hotel Beach Paradise", "paradise"),
        ]
        
        for input_name, expected in test_cases:
            result = aggregator._normalize_hotel_name(input_name)
            assert expected in result.lower()
",
            "duration_nights": 7,
            "cancellation": {"policy": "flexible"},
            "extras": ["club enfants"],
        }
        
        score = self.scorer.score_package(package, self.query)
        
        assert 0 <= score <= 1
        assert score > 0.6  # Devrait scorer bien avec ces caractéristiques


class TestExplainService(TestCase):
    """Tests pour le service d'explication"""
    
    def setUp(self):
        self.explainer = ExplainService()
        self.query = {
            "origin": "PAR",
            "destinations": ["Crète"],
            "budget_eur": {"max": 1500},
            "party": {"adults": 2},
            "preferences": {"family_friendly": True},
        }
    
    def test_generate_pros_cons_good_package(self):
        """Test génération pros/cons pour un bon package"""
        package = {
            "offer_id": "test-123",
            "hotel": {
                "name": "Hotel Paradise",
                "stars": 4,
                "rating": {"score": 9.0, "scale": 10},
            },
            "travel": {
                "stops_outbound": 0,
                "stops_inbound": 0,
                "baggage": {"checked_included": True},
            },
            "price": {"per_person_eur": 1000, "total_eur": 2000},
            "duration_nights": 7,
            "cancellation": {"policy": "flexible", "deadline_days": 15},
            "extras": ["club enfants", "spa"],
        }
        
        pros, cons = self.explainer.generate_pros_cons(package, self.query)
        
        assert len(pros) > 0
        assert len(cons) >= 0
        assert any("direct" in p.lower() for p in pros)
        assert any("bagage" in p.lower() for p in pros)
    
    def test_generate_pros_cons_mediocre_package(self):
        """Test génération pros/cons pour un package moyen"""
        package = {
            "hotel": {
                "name": "Hotel Basic",
                "stars": 2,
                "rating": None,
            },
            "travel": {
                "stops_outbound": 2,
                "stops_inbound": 1,
                "baggage": {"checked_included": False},
            },
            "price": {"per_person_eur": 1800, "total_eur": 3600},
            "duration_nights": 7,
            "cancellation": {"policy": "non_refundable"},
            "extras": [],
        }
        
        pros, cons = self.explainer.generate_pros_cons(package, self.query)
        
        assert len(cons) > 0
        assert any("escale" in c.lower() for c in cons)
        assert any("bagage" in c.lower() for c in cons)
    
    def test_generate_summary(self):
        """Test génération de résumé"""
        package = {
            "hotel": {
                "name": "Hotel Paradise",
                "location": {"city": "Héraklion", "country": "Grèce"},
            },
            "travel": {
                "stops_outbound": 0,
                "stops_inbound": 0,
            },
            "price": {"per_person_eur": 1200},
            "board": "all_inclusive