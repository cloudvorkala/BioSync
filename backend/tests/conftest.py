"""Offline by default, regardless of a developer's real-provider environment."""

import socket

import pytest


@pytest.fixture(autouse=True)
def offline_llm_environment(monkeypatch):
    monkeypatch.setenv("BIOSYNC_LLM_MODE", "mock")
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("BIOSYNC_LLM_MODEL", raising=False)

    def forbid_network(*args, **kwargs):
        raise AssertionError("Live network access is forbidden in backend tests")

    monkeypatch.setattr(socket.socket, "connect", forbid_network)
    monkeypatch.setattr(socket.socket, "connect_ex", forbid_network)
    monkeypatch.setattr(socket, "getaddrinfo", forbid_network)
