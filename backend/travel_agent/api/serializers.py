# backend/travel_agent/api/serializers.py
from rest_framework import serializers
from typing import Dict, List


class TravelQuerySerializer(serializers.Serializer):
    """Serializer pour les requêtes de recherche"""

    origin = serializers.CharField(max_length=3)
    destinations = serializers.ListField(
        child=serializers.CharField(max_length=100), allow_empty=False
    )
    date_range = serializers.DictField(child=serializers.CharField())
    duration_nights = serializers.ListField(
        child=serializers.IntegerField(min_value=1, max_value=30), default=[7]
    )
    budget_eur = serializers.DictField(required=False, default={})
    party = serializers.DictField(default={"adults": 2, "children": []})
    board = serializers.CharField(default="all_inclusive")
    flex = serializers.DictField(default={"days": 0})
    preferences = serializers.DictField(default={})


class PackageSerializer(serializers.Serializer):
    """Serializer pour les packages"""

    provider = serializers.CharField()
    offer_id = serializers.CharField()
    title = serializers.CharField()
    hotel = serializers.DictField()
    travel = serializers.DictField()
    board = serializers.CharField()
    room = serializers.CharField()
    duration_nights = serializers.IntegerField()
    price = serializers.DictField()
    cancellation = serializers.DictField()
    extras = serializers.ListField(child=serializers.CharField())
    url = serializers.URLField()
    score = serializers.FloatField()
    pros = serializers.ListField(child=serializers.CharField())
    cons = serializers.ListField(child=serializers.CharField())


class SearchResponseSerializer(serializers.Serializer):
    """Serializer pour la réponse de recherche"""

    query = TravelQuerySerializer()
    packages = PackageSerializer(many=True)
    paging = serializers.DictField()
    metadata = serializers.DictField(required=False)
