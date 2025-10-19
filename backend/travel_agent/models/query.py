from django.db import models
from django.contrib.postgres.fields import ArrayField
import uuid


class TravelQuery(models.Model):
    """Modèle pour stocker les requêtes de recherche utilisateur"""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    session_id = models.CharField(max_length=255, db_index=True)

    # Origine et destinations
    origin = models.CharField(max_length=3, help_text="Code IATA aéroport départ")
    destinations = ArrayField(
        models.CharField(max_length=100), help_text="Liste des destinations souhaitées"
    )

    # Dates
    date_start = models.DateField(null=True, blank=True)
    date_end = models.DateField(null=True, blank=True)
    date_flexibility = models.IntegerField(default=0, help_text="Flexibilité en jours")

    # Durée
    min_nights = models.IntegerField(default=7)
    max_nights = models.IntegerField(default=7)

    # Budget
    budget_min = models.DecimalField(
        max_digits=10, decimal_places=2, null=True, blank=True
    )
    budget_max = models.DecimalField(
        max_digits=10, decimal_places=2, null=True, blank=True
    )

    # Voyageurs
    adults = models.IntegerField(default=2)
    children_ages = ArrayField(
        models.IntegerField(), default=list, blank=True, help_text="Âges des enfants"
    )

    # Préférences
    board = models.CharField(
        max_length=50,
        default="all_inclusive",
        choices=[
            ("all_inclusive", "All Inclusive"),
            ("full_board", "Pension Complète"),
            ("half_board", "Demi-Pension"),
            ("breakfast", "Petit-Déjeuner"),
            ("room_only", "Logement Seul"),
        ],
    )
    family_friendly = models.BooleanField(default=False)
    adults_only = models.BooleanField(default=False)
    direct_flight_only = models.BooleanField(default=False)

    # Métadonnées
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    search_completed = models.BooleanField(default=False)
    results_count = models.IntegerField(default=0)

    class Meta:
        db_table = "travel_queries"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["session_id", "-created_at"]),
            models.Index(fields=["origin", "date_start"]),
        ]

    def __str__(self):
        return f"{self.origin} → {', '.join(self.destinations[:2])} ({self.created_at.date()})"

    @property
    def total_travelers(self):
        return self.adults + len(self.children_ages)

    @property
    def has_children(self):
        return len(self.children_ages) > 0
