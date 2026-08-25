#!/usr/bin/env python3
"""
Revisa que los scripts .sql sean T-SQL sintácticamente válido, sin necesidad
de un servidor SQL Server.

    pip install sqlglot
    python3 database/validar-tsql.py

Es una red de seguridad para cuando alguien edite el esquema: detecta errores
de sintaxis antes de que lleguen a la base. NO valida que las tablas o columnas
existan — eso solo lo dice el servidor real.
"""
import re
import sys
from pathlib import Path

try:
    import sqlglot
    from sqlglot import expressions as exp
except ImportError:
    sys.exit("Falta sqlglot. Instálalo con:  pip install sqlglot")

RAIZ = Path(__file__).resolve().parent


def lotes(ruta: Path):
    """Parte el script por GO, que es el separador de lotes de SQL Server."""
    texto = ruta.read_text(encoding="utf-8")
    return [b.strip() for b in re.split(r"^\s*GO\s*$", texto, flags=re.I | re.M) if b.strip()]


def revisar(ruta: Path) -> int:
    problemas = 0
    sentencias = lotes(ruta)

    for i, sentencia in enumerate(sentencias, start=1):
        try:
            arboles = sqlglot.parse(sentencia, dialect="tsql")
        except Exception as error:  # noqa: BLE001
            problemas += 1
            print(f"  [lote {i}] ERROR DE SINTAXIS: {str(error)[:160]}")
            continue

        for arbol in arboles:
            # sqlglot devuelve Command cuando no logró entender la estructura:
            # puede ser sintaxis muy avanzada o un error de verdad.
            if isinstance(arbol, exp.Command):
                problemas += 1
                print(f"  [lote {i}] NO RECONOCIDO: {sentencia[:100].strip()}...")

    estado = "OK" if problemas == 0 else f"{problemas} problema(s)"
    print(f"{ruta.name}: {len(sentencias)} lotes -> {estado}")
    return problemas


def main():
    total = sum(revisar(RAIZ / archivo) for archivo in ("01_schema.sql", "02_seed.sql"))
    print("\nT-SQL válido ✓" if total == 0 else f"\n{total} problema(s) por revisar ✗")
    sys.exit(0 if total == 0 else 1)


if __name__ == "__main__":
    main()
