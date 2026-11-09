"""Andares (floors): each floor is one room of the office, with its own agents.

Where the floors come from, in this order:
  1. ~/.my3dlobby/andares.json — what you created or changed in My3DLobby itself
     (the "+ Novo andar" button, moving an agent to another floor). Only My3DLobby writes it.
  2. [[floor]] blocks in ~/.my3dlobby.toml — name and profiles (wildcards allowed: "win-*").
  3. default: one floor named after the office; profiles "win-*" (the Mesa WIN trading desk)
     get the 2nd floor when they exist.

Each agent sits on the first floor that names it exactly; otherwise on the first floor whose
wildcard matches (other than "*"); otherwise on the floor with "*"; otherwise on the 1st floor.
Desks are numbered inside each floor, in the order of the agents.
"""
from __future__ import annotations

import fnmatch
import json
import re
import threading
from pathlib import Path

ARQUIVO = Path("~/.my3dlobby/andares.json")
MAX_ANDARES = 12
MAX_NOME = 40
PADRAO_MESA_WIN = ("Mesa WIN", "win-*")


def _nome(texto) -> str:
    nome = re.sub(r"[\x00-\x1f\x7f]", "", " ".join(str(texto or "").split()))
    return nome[:MAX_NOME].strip()


def _curinga(p: str) -> bool:
    return p != "*" and any(c in p for c in "*?[")


class Andares:
    def __init__(self, cfg, arquivo: Path | str | None = None):
        self.cfg = cfg
        self.arquivo = Path(arquivo or ARQUIVO).expanduser()
        self.lock = threading.Lock()
        self._salvos = self._ler()

    # ------------------------------------------------------------ reading
    def _ler(self) -> list[dict] | None:
        try:
            dado = json.loads(self.arquivo.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None
        andares = dado.get("andares") if isinstance(dado, dict) else None
        if not isinstance(andares, list):
            return None
        out, vistos = [], set()
        for i, a in enumerate(andares):
            if not isinstance(a, dict):
                continue
            ident = str(a.get("id") or f"a{i + 1}")
            if ident in vistos:
                continue
            vistos.add(ident)
            perfis = [str(p).strip() for p in (a.get("perfis") or []) if str(p).strip()]
            out.append({"id": ident, "nome": _nome(a.get("nome")) or f"Andar {len(out) + 1}", "perfis": perfis})
        return out or None

    def _base(self, perfis_vistos) -> list[dict]:
        if self._salvos is not None:
            return [dict(a, perfis=list(a["perfis"])) for a in self._salvos]
        floors = getattr(self.cfg, "floors", None) or []
        if floors:
            return [{"id": f"a{i + 1}", "nome": _nome(f.get("name")) or f"Andar {i + 1}",
                     "perfis": [str(p) for p in f.get("profiles", [])]} for i, f in enumerate(floors)]
        base = [{"id": "a1", "nome": _nome(self.cfg.office_name) or "Escritório", "perfis": ["*"]}]
        nome, curinga = PADRAO_MESA_WIN
        if any(fnmatch.fnmatchcase(p, curinga) for p in perfis_vistos):
            base.append({"id": "a2", "nome": nome, "perfis": [curinga]})
        return base

    @staticmethod
    def andar_de(andares: list[dict], perfil: str) -> str:
        for a in andares:
            if perfil in a["perfis"]:
                return a["id"]
        for a in andares:
            if any(_curinga(p) and fnmatch.fnmatchcase(perfil, p) for p in a["perfis"]):
                return a["id"]
        for a in andares:
            if "*" in a["perfis"]:
                return a["id"]
        return andares[0]["id"]

    def lista(self, perfis_vistos) -> list[dict]:
        with self.lock:
            return self._base(list(perfis_vistos))

    def aplicar(self, agents: list[dict]) -> list[dict]:
        """Puts the floor ("andar") and the desk inside that floor on every agent of /api/state and
        returns the floors (number, name, agents, how many are working)."""
        andares = self.lista([a["id"] for a in agents])
        por_andar: dict[str, list[dict]] = {a["id"]: [] for a in andares}
        for ag in agents:
            ag["andar"] = self.andar_de(andares, ag["id"])
            por_andar[ag["andar"]].append(ag)
        for lista in por_andar.values():
            fixas = {ag["desk"] for ag in lista if ag.get("desk_fixa") and isinstance(ag.get("desk"), int)}
            livres = (i for i in range(10_000) if i not in fixas)
            for ag in lista:
                if not ag.get("desk_fixa"):
                    ag["desk"] = next(livres)
                ag.pop("desk_fixa", None)
        return [{"id": a["id"], "nome": a["nome"], "numero": i + 1,
                 "agentes": [ag["id"] for ag in por_andar[a["id"]]],
                 "trabalhando": sum(1 for ag in por_andar[a["id"]] if ag.get("status") == "working")}
                for i, a in enumerate(andares)]

    # ------------------------------------------------------------ changes (POST /api/andares)
    def _gravar(self, andares: list[dict]) -> None:
        self.arquivo.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.arquivo.with_suffix(".tmp")
        tmp.write_text(json.dumps({"andares": andares}, ensure_ascii=False, indent=1), encoding="utf-8")
        tmp.replace(self.arquivo)
        self._salvos = [dict(a, perfis=list(a["perfis"])) for a in andares]

    def _mover(self, andares: list[dict], perfil: str, destino: str) -> None:
        for a in andares:
            if perfil in a["perfis"]:
                a["perfis"].remove(perfil)
        if self.andar_de(andares, perfil) != destino:
            next(a for a in andares if a["id"] == destino)["perfis"].append(perfil)

    def executar(self, pedido: dict, perfis_vistos) -> dict:
        """acao = criar {nome, agentes} | mover {agente, andar} | editar {andar, nome?, agentes?} | remover {andar}."""
        perfis_vistos = list(perfis_vistos)
        acao = str(pedido.get("acao") or "")
        with self.lock:
            andares = self._base(perfis_vistos)
            ids = [a["id"] for a in andares]
            agentes = [p for p in (pedido.get("agentes") or []) if p in perfis_vistos]
            if acao == "criar":
                nome = _nome(pedido.get("nome"))
                if not nome:
                    return {"ok": False, "erro": "dê um nome ao andar"}
                if len(andares) >= MAX_ANDARES:
                    return {"ok": False, "erro": f"no máximo {MAX_ANDARES} andares"}
                novo = next(f"a{n}" for n in range(1, 10_000) if f"a{n}" not in ids)
                andares.append({"id": novo, "nome": nome, "perfis": []})
                for p in agentes:
                    self._mover(andares, p, novo)
                self._gravar(andares)
                return {"ok": True, "andar": novo}
            andar = str(pedido.get("andar") or "")
            if andar not in ids:
                return {"ok": False, "erro": "andar desconhecido"}
            if acao == "mover":
                agente = str(pedido.get("agente") or "")
                if agente not in perfis_vistos:
                    return {"ok": False, "erro": "agente desconhecido"}
                self._mover(andares, agente, andar)
                self._gravar(andares)
                return {"ok": True, "andar": andar}
            if acao == "editar":
                alvo = next(a for a in andares if a["id"] == andar)
                if "nome" in pedido:
                    nome = _nome(pedido.get("nome"))
                    if not nome:
                        return {"ok": False, "erro": "dê um nome ao andar"}
                    alvo["nome"] = nome
                if "agentes" in pedido:
                    primeiro = ids[0]
                    for p in perfis_vistos:
                        if p in agentes:
                            self._mover(andares, p, andar)
                        elif andar != primeiro and self.andar_de(andares, p) == andar:
                            self._mover(andares, p, primeiro)  # tirou deste andar: volta para o 1º
                self._gravar(andares)
                return {"ok": True, "andar": andar}
            if acao == "remover":
                if andar == ids[0]:
                    return {"ok": False, "erro": "o 1º andar não pode ser removido"}
                andares = [a for a in andares if a["id"] != andar]
                self._gravar(andares)
                return {"ok": True, "andar": ids[0]}
        return {"ok": False, "erro": "ação desconhecida"}
