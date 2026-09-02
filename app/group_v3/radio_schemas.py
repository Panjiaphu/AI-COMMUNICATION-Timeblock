from __future__ import annotations

from typing import Literal

from pydantic import Field, field_validator

from app.group_v3.schemas import StrictModel
from app.group_v3.translation_schemas import LANGUAGES


class RadioSessionCreate(StrictModel):
    title: str = Field(default="", max_length=120)
    participant_membership_ids: list[str] = Field(min_length=1, max_length=49)

    @field_validator("participant_membership_ids")
    @classmethod
    def validate_participants(cls, value):
        if len(value) != len(set(value)) or any(not 1 <= len(item) <= 36 for item in value):
            raise ValueError("invalid_participant_membership_ids")
        return value


class RadioFloorAcquire(StrictModel):
    source_language: str
    target_languages: list[str] = Field(default_factory=list, max_length=3)

    @field_validator("source_language")
    @classmethod
    def validate_source(cls, value):
        if value not in LANGUAGES:
            raise ValueError("invalid_language")
        return value

    @field_validator("target_languages")
    @classmethod
    def validate_targets(cls, value):
        if len(value) != len(set(value)) or any(item not in LANGUAGES for item in value):
            raise ValueError("invalid_target_languages")
        return value


class RadioFloorToken(StrictModel):
    floor_token: str = Field(min_length=32, max_length=256)


class RadioMediaGrant(StrictModel):
    mode: Literal["listen", "talk"] = "listen"
    floor_token: str = Field(default="", max_length=256)
